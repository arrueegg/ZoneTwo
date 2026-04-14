from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.activity import Activity

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
        "hrv_rmssd": a.hrv_rmssd,
        "sleep_score": a.sleep_score,
        "body_battery": a.body_battery,
    }
