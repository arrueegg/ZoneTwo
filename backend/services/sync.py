import time
from datetime import datetime, timezone, date as date_type, timedelta

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from integrations import strava
from integrations.garmin_unofficial import (
    fetch_athlete_profile, fetch_daily_wellness, fetch_daily_extras,
    fetch_hrv, fetch_activities, normalize_garmin_activity, extract_daily_metrics,
)
from models.activity import Activity
from models.athlete import Athlete
from models.metrics import DailyMetrics
from services.analytics import compute_readiness_score, compute_baseline
from services.crypto import decrypt
from services.metrics import calculate_tss_from_hr, calculate_training_load


async def sync_athlete_strava(athlete: Athlete, db: AsyncSession) -> int:
    """
    Incremental Strava sync for one athlete.
    Returns the number of new activities upserted.
    """
    access_token = athlete.strava_access_token
    if athlete.strava_token_expires_at and athlete.strava_token_expires_at < int(time.time()):
        token_data = await strava.refresh_access_token(athlete.strava_refresh_token)
        access_token = token_data["access_token"]
        athlete.strava_access_token = access_token
        athlete.strava_refresh_token = token_data["refresh_token"]
        athlete.strava_token_expires_at = token_data["expires_at"]

    after_ts: int | None = None
    if athlete.last_strava_sync:
        after_ts = int(athlete.last_strava_sync.timestamp())

    raw_activities = await strava.fetch_activities(access_token, after=after_ts)

    upserted = 0
    for raw in raw_activities:
        normalized = strava.normalize_activity(raw, athlete.id)

        if normalized["duration_sec"] and normalized["avg_hr"] and athlete.threshold_hr:
            normalized["tss"] = calculate_tss_from_hr(
                normalized["duration_sec"],
                normalized["avg_hr"],
                float(athlete.threshold_hr),
            )

        existing = await db.get(Activity, normalized["id"])
        if existing:
            for key, value in normalized.items():
                setattr(existing, key, value)
        else:
            db.add(Activity(**normalized))
        upserted += 1

    athlete.last_strava_sync = datetime.now(timezone.utc)
    await db.commit()
    return upserted


async def sync_garmin_activities(
    athlete: Athlete,
    db: AsyncSession,
    days: int = 90,
    client=None,
) -> int:
    """Pull Garmin activities, normalize them, and upsert into the activities table."""
    if not athlete.garmin_email or not athlete.garmin_password_encrypted:
        return 0

    password = decrypt(athlete.garmin_password_encrypted)
    end = date_type.today()
    start = end - timedelta(days=days)

    # Create one shared client for the entire sync if not provided
    if client is None:
        from integrations.garmin_unofficial import get_client
        client = await get_client(athlete.garmin_email, password)

    # Sync profile metrics from Garmin (always overwrite with Garmin's measured values)
    garmin_profile = await fetch_athlete_profile(athlete.garmin_email, password, client=client)
    for field in ("threshold_hr", "max_hr", "vo2max", "fitness_age", "race_predictions"):
        value = garmin_profile.get(field)
        if value is not None:
            setattr(athlete, field, value)
    if garmin_profile:
        keys = [k for k in garmin_profile if garmin_profile[k] is not None]
        print(f"[garmin] profile synced: {', '.join(keys)}")

    await db.commit()  # persist threshold/max HR before processing activities

    print(f"[garmin] Fetching activities for {athlete.id} ({start} → {end})")
    raw_activities = await fetch_activities(athlete.garmin_email, password, start, end, client=client)

    upserted = 0
    tss_from_hr = 0
    for raw in raw_activities:
        normalized = normalize_garmin_activity(raw, athlete.id)
        if not normalized["start_time"]:
            continue

        # Fall back to HR-based TSS when Garmin's activityTrainingLoad is absent
        if normalized["tss"] is None and normalized.get("avg_hr") and normalized.get("duration_sec"):
            # Use threshold HR if set; otherwise estimate from max HR (85%) or a typical default
            thr = (
                float(athlete.threshold_hr)
                if athlete.threshold_hr
                else float(athlete.max_hr) * 0.85
                if athlete.max_hr
                else None
            )
            if thr:
                normalized["tss"] = calculate_tss_from_hr(
                    normalized["duration_sec"],
                    normalized["avg_hr"],
                    thr,
                )
                tss_from_hr += 1

        existing = await db.get(Activity, normalized["id"])
        if existing:
            for key, value in normalized.items():
                setattr(existing, key, value)
        else:
            db.add(Activity(**normalized))
        upserted += 1

    await db.commit()
    print(f"[garmin] {athlete.id}: {upserted} activities upserted")
    return upserted


async def sync_athlete_garmin(
    athlete: Athlete,
    db: AsyncSession,
    days: int = 30,
    client=None,
) -> int:
    """
    Pull Garmin wellness + HRV data for the last `days` days and merge into daily_metrics.
    Returns the number of days updated.
    """
    if not athlete.garmin_email or not athlete.garmin_password_encrypted:
        return 0

    password = decrypt(athlete.garmin_password_encrypted)
    end = date_type.today()
    start = end - timedelta(days=days)

    if client is None:
        from integrations.garmin_unofficial import get_client
        client = await get_client(athlete.garmin_email, password)

    print(f"[garmin] Fetching wellness + HRV for {athlete.id} ({start} → {end})")

    wellness_list = await fetch_daily_wellness(athlete.garmin_email, password, start, end, client=client)
    hrv_list = await fetch_hrv(athlete.garmin_email, password, start, end, client=client)
    extras_list = await fetch_daily_extras(athlete.garmin_email, password, start, end, client=client)

    hrv_by_date = {item["date"]: item["data"] for item in hrv_list}
    extras_by_date = {item["date"]: item for item in extras_list}

    updated = 0
    for item in wellness_list:
        day_str = item["date"]
        metrics = extract_daily_metrics(item["data"], hrv_by_date.get(day_str))
        if not any(metrics.values()):
            continue

        record_id = f"{athlete.id}_{day_str}"
        record = await db.get(DailyMetrics, record_id)
        if not record:
            record = DailyMetrics(
                id=record_id,
                athlete_id=athlete.id,
                date=datetime.fromisoformat(day_str).date(),
                daily_tss=0.0,
            )
            db.add(record)

        for field, value in metrics.items():
            if value is not None:
                setattr(record, field, value)

        # Merge extras: training status, endurance score, sleep stages, training readiness
        extras = extras_by_date.get(day_str, {})
        for field in (
            "training_status",
            "training_readiness_description",
        ):
            if extras.get(field):
                setattr(record, field, extras[field])
        for field in (
            "endurance_score",
            "sleep_score",
            "sleep_deep_seconds",
            "sleep_light_seconds",
            "sleep_rem_seconds",
            "sleep_awake_seconds",
            "training_readiness_score",
        ):
            if extras.get(field) is not None:
                setattr(record, field, float(extras[field]))

        updated += 1

    await db.commit()

    # Compute readiness scores using the full history as baseline
    all_result = await db.execute(
        select(DailyMetrics)
        .where(DailyMetrics.athlete_id == athlete.id)
        .order_by(DailyMetrics.date)
    )
    all_rows = all_result.scalars().all()
    history = [_row_to_dict(r) for r in all_rows]
    baseline = compute_baseline(history)

    for i, row in enumerate(all_rows):
        today_dict = history[i]
        row.readiness_score = compute_readiness_score(today_dict, baseline)

    await db.commit()
    print(f"[garmin] Updated {updated} days of wellness data for {athlete.id}")
    return updated


def _row_to_dict(r: DailyMetrics) -> dict:
    return {
        "date": r.date.isoformat(),
        "hrv_rmssd": r.hrv_rmssd,
        "resting_hr": r.resting_hr,
        "sleep_hours": r.sleep_hours,
        "body_battery_high": r.body_battery_high,
        "body_battery_low": r.body_battery_low,
        "body_battery_wake": r.body_battery_wake,
        "steps": r.steps,
        "stress_avg": r.stress_avg,
        "spo2_avg": r.spo2_avg,
        "daily_tss": r.daily_tss,
        "readiness_score": r.readiness_score,
    }


async def recalculate_training_load(athlete_id: str, db: AsyncSession) -> None:
    """
    Recompute CTL/ATL/TSB for all dates with activity data and persist to daily_metrics.
    """
    result = await db.execute(
        text(
            "SELECT date(start_time) AS day, COALESCE(SUM(tss), 0) AS daily_tss "
            "FROM activities "
            "WHERE athlete_id = :athlete_id AND tss IS NOT NULL "
            "GROUP BY date(start_time) "
            "ORDER BY day"
        ),
        {"athlete_id": athlete_id},
    )
    rows = result.fetchall()
    if not rows:
        return

    daily_tss = {date_type.fromisoformat(row.day): float(row.daily_tss) for row in rows}
    load_by_date = calculate_training_load(daily_tss)

    for d, metrics in load_by_date.items():
        record_id = f"{athlete_id}_{d.isoformat()}"
        existing = await db.get(DailyMetrics, record_id)
        if existing:
            existing.ctl = metrics["ctl"]
            existing.atl = metrics["atl"]
            existing.tsb = metrics["tsb"]
            existing.daily_tss = metrics["daily_tss"]
        else:
            db.add(
                DailyMetrics(
                    id=record_id,
                    athlete_id=athlete_id,
                    date=d,
                    daily_tss=metrics["daily_tss"],
                    ctl=metrics["ctl"],
                    atl=metrics["atl"],
                    tsb=metrics["tsb"],
                )
            )

    await db.commit()
