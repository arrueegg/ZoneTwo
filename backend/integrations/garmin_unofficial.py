"""
Garmin Connect integration via the unofficial garminconnect library.
Uses email/password session auth — no API approval required.

Session tokens are cached on disk (.garmin_tokens/<email>/) so re-syncing
doesn't trigger a full login each time, which avoids Garmin's IP rate limits.
"""

import asyncio
import hashlib
import time
from datetime import date
from pathlib import Path
from typing import Any

from garminconnect import Garmin, GarminConnectAuthenticationError

# Tokens are stored next to this file's package root
_TOKEN_DIR = Path(__file__).parent.parent / ".garmin_tokens"


def _token_path(email: str) -> str:
    """Return a per-account token directory (uses email hash to avoid storing PII in filenames)."""
    slug = hashlib.sha256(email.encode()).hexdigest()[:16]
    path = _TOKEN_DIR / slug
    path.mkdir(parents=True, exist_ok=True)
    return str(path)


def _login_with_cache(email: str, password: str) -> Garmin:
    """
    Create and authenticate a Garmin client, loading cached tokens when available.
    Only performs a full login (which hits Garmin's auth servers) when the cached
    token is missing or expired.
    """
    token_path = _token_path(email)
    client = Garmin(email=email, password=password)
    client.login(tokenstore=token_path)
    return client


async def get_client(email: str, password: str) -> Garmin:
    """Async wrapper — returns an authenticated Garmin client (uses cached token if available)."""
    return await asyncio.to_thread(_login_with_cache, email, password)


def _with_retry(fn, *args, retries: int = 3, base_delay: float = 30.0, **kwargs) -> Any:
    """
    Call a blocking Garmin API function, retrying on 429 with exponential backoff.
    Delays: 30s, 60s, 120s.
    """
    for attempt in range(retries):
        try:
            return fn(*args, **kwargs)
        except Exception as exc:
            msg = str(exc)
            if "429" in msg and attempt < retries - 1:
                delay = base_delay * (2 ** attempt)
                print(f"[garmin] 429 rate limit — waiting {int(delay)}s before retry {attempt + 2}/{retries}")
                time.sleep(delay)
            else:
                raise


async def fetch_athlete_profile(email: str, password: str, client: Garmin | None = None) -> dict[str, Any]:
    """
    Fetch profile metrics from Garmin: threshold HR, max HR, VO2max, fitness age, race predictions.
    Pass an existing `client` to avoid a redundant login.
    """
    if client is None:
        client = await get_client(email, password)

    today_str = date.today().isoformat()
    profile: dict[str, Any] = {}

    # Lactate threshold HR
    try:
        lt = await asyncio.to_thread(_with_retry, client.get_lactate_threshold)
        print(f"[garmin] raw lactate threshold: {lt}")
        hr = lt.get("speed_and_heart_rate", {}).get("heartRate")
        if hr:
            profile["threshold_hr"] = int(hr)
            print(f"[garmin] threshold HR: {hr}")
        else:
            print(f"[garmin] threshold HR not available (heartRate={hr})")
    except Exception as exc:
        print(f"[garmin] Could not fetch lactate threshold: {exc}")

    # Max HR + VO2max from max metrics
    try:
        metrics = await asyncio.to_thread(_with_retry, client.get_max_metrics, today_str)
        print(f"[garmin] raw max metrics: {metrics}")
        if isinstance(metrics, list) and metrics:
            generic = metrics[0].get("generic", {})
            if generic.get("maxHeartRate"):
                profile["max_hr"] = int(generic["maxHeartRate"])
            if generic.get("vo2MaxPreciseValue"):
                profile["vo2max"] = round(float(generic["vo2MaxPreciseValue"]), 1)
            elif generic.get("vo2MaxValue"):
                profile["vo2max"] = round(float(generic["vo2MaxValue"]), 1)
            print(f"[garmin] max HR: {profile.get('max_hr')}, VO2max: {profile.get('vo2max')}")
    except Exception as exc:
        print(f"[garmin] Could not fetch max metrics: {exc}")

    # Fitness age
    try:
        fa = await asyncio.to_thread(_with_retry, client.get_fitnessage_data, today_str)
        age = fa.get("fitnessAge") or fa.get("biologicalAge") if fa else None
        if age is not None:
            profile["fitness_age"] = int(age)
            print(f"[garmin] fitness age: {profile['fitness_age']}")
        else:
            print("[garmin] fitness age not available")
    except Exception as exc:
        print(f"[garmin] Could not fetch fitness age: {exc}")

    # Race predictions — Garmin returns a flat dict with time5K/time10K/timeHalfMarathon/timeMarathon
    _RACE_KEY_MAP = {
        "time5K": "5k",
        "time10K": "10k",
        "timeHalfMarathon": "half_marathon",
        "timeMarathon": "marathon",
    }
    try:
        preds = await asyncio.to_thread(_with_retry, client.get_race_predictions)
        races = {}
        if isinstance(preds, dict):
            for garmin_key, our_key in _RACE_KEY_MAP.items():
                secs = preds.get(garmin_key)
                if secs:
                    races[our_key] = int(secs)
        elif isinstance(preds, list):
            for p in preds:
                t = p.get("raceType") or p.get("type", "")
                secs = p.get("timeInSeconds") or p.get("predictedTimeInSeconds")
                if t and secs:
                    races[t.lower()] = int(secs)
        if races:
            profile["race_predictions"] = races
            print(f"[garmin] race predictions: {races}")
        else:
            print("[garmin] race predictions: none extracted")
    except Exception as exc:
        print(f"[garmin] Could not fetch race predictions: {exc}")

    return profile


async def fetch_daily_extras(
    email: str, password: str, start: date, end: date, client: Garmin | None = None,
) -> list[dict[str, Any]]:
    """
    Fetch daily training status and endurance score for each day in the range.
    Pass an existing `client` to avoid a redundant login.
    """
    if client is None:
        client = await get_client(email, password)

    results = []
    current = start
    from datetime import timedelta

    while current <= end:
        day_str = current.isoformat()
        entry: dict[str, Any] = {"date": day_str}

        try:
            ts = await asyncio.to_thread(_with_retry, client.get_training_status, day_str)
            if ts:
                entry["training_status"] = (
                    ts.get("trainingStatus")
                    or ts.get("latestTrainingStatusRecord", {}).get("trainingStatus")
                )
                entry["training_load_balance"] = ts.get("trainingLoadBalance")
        except Exception:
            pass

        try:
            es = await asyncio.to_thread(_with_retry, client.get_endurance_score, day_str)
            if isinstance(es, list) and es:
                entry["endurance_score"] = es[0].get("value") or es[0].get("enduranceScoreValue")
            elif isinstance(es, dict):
                entry["endurance_score"] = es.get("value") or es.get("enduranceScoreValue")
        except Exception:
            pass

        if len(entry) > 1:
            results.append(entry)
        current += timedelta(days=1)

    return results


async def fetch_daily_wellness(
    email: str, password: str, start: date, end: date, client: Garmin | None = None,
) -> list[dict[str, Any]]:
    """
    Fetch daily wellness summary for each day in the range.
    Pass an existing `client` to avoid a redundant login.
    """
    if client is None:
        client = await get_client(email, password)

    results = []
    current = start
    from datetime import timedelta

    while current <= end:
        day_str = current.isoformat()
        try:
            data = await asyncio.to_thread(_with_retry, client.get_stats, day_str)
            results.append({"date": day_str, "data": data})
        except Exception as exc:
            print(f"[garmin] No wellness data for {day_str}: {exc}")
        current += timedelta(days=1)

    return results


async def fetch_hrv(
    email: str, password: str, start: date, end: date, client: Garmin | None = None,
) -> list[dict[str, Any]]:
    """
    Fetch HRV summary for each day in the range.
    Pass an existing `client` to avoid a redundant login.
    """
    if client is None:
        client = await get_client(email, password)

    results = []
    current = start
    from datetime import timedelta

    while current <= end:
        day_str = current.isoformat()
        try:
            data = await asyncio.to_thread(_with_retry, client.get_hrv_data, day_str)
            results.append({"date": day_str, "data": data})
        except Exception as exc:
            print(f"[garmin] No HRV data for {day_str}: {exc}")
        current += timedelta(days=1)

    return results


async def fetch_activities(
    email: str, password: str, start: date, end: date, client: Garmin | None = None,
) -> list[dict[str, Any]]:
    """
    Fetch all activities in the date range from Garmin Connect.
    Pass an existing `client` to avoid a redundant login.
    """
    if client is None:
        client = await get_client(email, password)

    all_activities = []
    offset = 0
    limit = 100

    while True:
        batch = await asyncio.to_thread(_with_retry, client.get_activities, offset, limit)
        if not batch:
            break
        for activity in batch:
            act_date_str = activity.get("startTimeLocal", "")[:10]
            try:
                act_date = date.fromisoformat(act_date_str)
            except ValueError:
                continue
            if act_date < start:
                return all_activities
            if act_date <= end:
                all_activities.append(activity)
        offset += limit

    return all_activities


SPORT_TYPE_MAP: dict[int, str] = {
    1: "run",
    2: "ride",
    3: "swim",
    4: "multi_sport",
    5: "hiking",
    13: "strength",
    26: "yoga",
    29: "walk",
    63: "virtual_ride",
    89: "trail_run",
}


def normalize_garmin_activity(raw: dict[str, Any], athlete_id: str) -> dict[str, Any]:
    """Map a raw Garmin activity summary to our unified Activity schema."""
    from datetime import datetime

    start_str = raw.get("startTimeGMT", raw.get("startTimeLocal", ""))
    try:
        start_time = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
    except ValueError:
        start_time = None

    sport_type = SPORT_TYPE_MAP.get(raw.get("sportTypeId", 0), "other")

    hr_zones = {
        "z1": raw.get("hrTimeInZone_1"),
        "z2": raw.get("hrTimeInZone_2"),
        "z3": raw.get("hrTimeInZone_3"),
        "z4": raw.get("hrTimeInZone_4"),
        "z5": raw.get("hrTimeInZone_5"),
    }
    if not any(v for v in hr_zones.values()):
        hr_zones = None

    tss = raw.get("activityTrainingLoad")

    avg_speed = raw.get("averageSpeed")
    avg_pace = (1000 / avg_speed) if avg_speed and avg_speed > 0 else None

    return {
        "id": f"garmin_{raw['activityId']}",
        "athlete_id": athlete_id,
        "source": "garmin",
        "sport_type": sport_type,
        "start_time": start_time,
        "duration_sec": int(raw["duration"]) if raw.get("duration") else None,
        "distance_m": raw.get("distance"),
        "elevation_m": raw.get("elevationGain"),
        "avg_hr": raw.get("averageHR"),
        "max_hr": raw.get("maxHR"),
        "hr_zones": hr_zones,
        "avg_pace_sec_km": avg_pace,
        "normalized_power": raw.get("normPower") or raw.get("avgPower"),
        "tss": round(tss, 1) if tss else None,
        "raw_data": {k: v for k, v in raw.items() if not isinstance(v, (dict, list))},
    }


def extract_daily_metrics(wellness: dict[str, Any], hrv: dict[str, Any] | None) -> dict[str, Any]:
    """
    Pull the fields we care about from raw Garmin wellness + HRV responses.
    Returns a flat dict ready to merge into DailyMetrics.
    """
    result: dict[str, Any] = {}

    if wellness:
        result["resting_hr"] = wellness.get("restingHeartRate")

        sleep_secs = wellness.get("sleepingSeconds")
        result["sleep_hours"] = round(sleep_secs / 3600, 2) if sleep_secs else None

        result["body_battery_high"] = wellness.get("bodyBatteryHighestValue")
        result["body_battery_low"] = wellness.get("bodyBatteryLowestValue")
        result["body_battery_wake"] = wellness.get("bodyBatteryAtWakeTime")

        result["steps"] = wellness.get("totalSteps")
        result["stress_avg"] = wellness.get("averageStressLevel")
        result["spo2_avg"] = wellness.get("averageSpo2")
        result["respiration_avg"] = wellness.get("avgWakingRespirationValue")

    if hrv:
        hrv_summary = hrv.get("hrvSummary", {})
        result["hrv_rmssd"] = (
            hrv_summary.get("lastNightAvg")
            or hrv_summary.get("rmssd")
            or hrv_summary.get("lastNight5MinHigh")
        )

    return result
