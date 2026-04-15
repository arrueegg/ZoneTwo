from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.activity import Activity
from models.athlete import Athlete
from models.track import ActivityTrack

router = APIRouter(prefix="/activities", tags=["activities"])


@router.get("/")
async def list_activities(
    athlete_id: str = Query(...),
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    sport_type: str | None = Query(None),
    limit: int = Query(50, le=500),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """Return a list of activities for an athlete, newest first."""
    filters = [Activity.athlete_id == athlete_id]
    if start:
        filters.append(Activity.start_time >= start)
    if end:
        filters.append(Activity.start_time <= end)
    if sport_type:
        filters.append(Activity.sport_type == sport_type.lower())

    result = await db.execute(
        select(Activity)
        .where(and_(*filters))
        .order_by(Activity.start_time.desc())
        .limit(limit)
    )
    activities = result.scalars().all()
    return [_serialize(a) for a in activities]


@router.get("/{activity_id}")
async def get_activity(
    activity_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    activity = await db.get(Activity, activity_id)
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    return _serialize(activity)


@router.get("/{activity_id}/track")
async def get_activity_track(
    activity_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """
    Return GPS track + splits for one activity.
    Downloads and caches on first request; subsequent requests are instant.
    Only works for Garmin activities (id starts with 'garmin_').
    """
    # Return cached track if available
    track = await db.get(ActivityTrack, activity_id)
    if track:
        return {"points": track.points, "splits": track.splits or []}

    # Must be a Garmin activity to download
    if not activity_id.startswith("garmin_"):
        raise HTTPException(status_code=404, detail="Track data only available for Garmin activities")

    activity = await db.get(Activity, activity_id)
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    # Look up athlete credentials
    athlete = await db.get(Athlete, activity.athlete_id)
    if not athlete or not athlete.garmin_email or not athlete.garmin_password_encrypted:
        raise HTTPException(status_code=404, detail="Garmin credentials not available")

    # Download and parse
    from services.crypto import decrypt
    from integrations.garmin_unofficial import get_client, fetch_activity_track

    client = await get_client(athlete.garmin_email, decrypt(athlete.garmin_password_encrypted))
    result = await fetch_activity_track(
        athlete.garmin_email,
        decrypt(athlete.garmin_password_encrypted),
        activity_id,
        client=client,
    )
    if not result or not result.get("points"):
        raise HTTPException(status_code=404, detail="No track data available for this activity")

    # Cache it
    track = ActivityTrack(
        activity_id=activity_id,
        downloaded_at=datetime.now(timezone.utc),
        points=result["points"],
        splits=result.get("splits"),
    )
    db.add(track)
    await db.commit()

    return {"points": track.points, "splits": track.splits or []}


def _serialize(a: Activity) -> dict[str, Any]:
    return {
        "id": a.id,
        "athlete_id": a.athlete_id,
        "source": a.source,
        "sport_type": a.sport_type,
        "start_time": a.start_time.isoformat() if a.start_time else None,
        "duration_sec": a.duration_sec,
        "distance_m": a.distance_m,
        "elevation_m": a.elevation_m,
        "avg_hr": a.avg_hr,
        "max_hr": a.max_hr,
        "hr_zones": a.hr_zones,
        "avg_pace_sec_km": a.avg_pace_sec_km,
        "normalized_power": a.normalized_power,
        "tss": a.tss,
        "aerobic_effect": a.aerobic_effect,
        "anaerobic_effect": a.anaerobic_effect,
        "training_effect_label": a.training_effect_label,
        "avg_cadence": a.avg_cadence,
        "vo2max_estimated": a.vo2max_estimated,
        "hrv_rmssd": a.hrv_rmssd,
        "sleep_score": a.sleep_score,
        "body_battery": a.body_battery,
    }
