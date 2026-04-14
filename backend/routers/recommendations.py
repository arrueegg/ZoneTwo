from datetime import datetime, timezone, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from database import get_db
from models.activity import Activity
from models.athlete import Athlete
from models.metrics import DailyMetrics
from services.recommendations import generate_rule_based_insights, generate_weekly_ai_summary

router = APIRouter(prefix="/recommendations", tags=["recommendations"])

_AI_SUMMARY_TTL = timedelta(days=7)


@router.get("/insights")
async def get_insights(
    athlete_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """Return rule-based coaching insights based on the latest metrics."""
    result = await db.execute(
        select(DailyMetrics)
        .where(DailyMetrics.athlete_id == athlete_id)
        .order_by(DailyMetrics.date.desc())
        .limit(8)
    )
    rows = result.scalars().all()
    if len(rows) < 2:
        return []

    today_metrics = {"tsb": rows[0].tsb or 0, "atl": rows[0].atl or 0, "ctl": rows[0].ctl or 0}
    week_ago_metrics = {"tsb": rows[-1].tsb or 0, "atl": rows[-1].atl or 0, "ctl": rows[-1].ctl or 0}

    return generate_rule_based_insights(today_metrics, week_ago_metrics)


@router.get("/weekly-summary")
async def get_weekly_summary(
    athlete_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Return the cached AI weekly summary, or indicate that none is available yet."""
    athlete = await db.get(Athlete, athlete_id)
    if not athlete:
        raise HTTPException(status_code=404, detail="Athlete not found")
    if not athlete.ai_summary:
        return {"summary": None, "generated_at": None, "stale": True}
    age = datetime.now(timezone.utc) - athlete.ai_summary_generated_at.replace(tzinfo=timezone.utc)
    return {
        "summary": athlete.ai_summary,
        "generated_at": athlete.ai_summary_generated_at.isoformat(),
        "stale": age > _AI_SUMMARY_TTL,
    }


@router.post("/weekly-summary")
async def generate_weekly_summary(
    athlete_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """
    Generate (or refresh) the AI weekly coaching summary and cache it.
    Refuse if the cached version is less than 7 days old to avoid burning credits.
    """
    athlete = await db.get(Athlete, athlete_id)
    if not athlete:
        raise HTTPException(status_code=404, detail="Athlete not found")

    # Serve cache if fresh
    if athlete.ai_summary and athlete.ai_summary_generated_at:
        age = datetime.now(timezone.utc) - athlete.ai_summary_generated_at.replace(tzinfo=timezone.utc)
        if age < _AI_SUMMARY_TTL:
            return {
                "summary": athlete.ai_summary,
                "generated_at": athlete.ai_summary_generated_at.isoformat(),
                "stale": False,
            }

    # Pull last 7 days of metrics
    metrics_result = await db.execute(
        select(DailyMetrics)
        .where(DailyMetrics.athlete_id == athlete_id)
        .order_by(DailyMetrics.date.desc())
        .limit(7)
    )
    rows = metrics_result.scalars().all()
    if not rows:
        raise HTTPException(status_code=400, detail="No metrics data available yet")

    latest = rows[0]

    # Pull last 7 days of activities for volume stats
    week_start = datetime.now(timezone.utc) - timedelta(days=7)
    acts_result = await db.execute(
        select(Activity).where(
            and_(
                Activity.athlete_id == athlete_id,
                Activity.start_time >= week_start,
            )
        )
    )
    week_acts = acts_result.scalars().all()

    total_dist_km = sum((a.distance_m or 0) for a in week_acts) / 1000
    total_hours = sum((a.duration_sec or 0) for a in week_acts) / 3600

    # Aggregate HR zone totals across all activities
    zone_totals = {f"z{i}": 0 for i in range(1, 6)}
    for act in week_acts:
        if act.hr_zones:
            for k in zone_totals:
                zone_totals[k] += act.hr_zones.get(k, 0)
    zone_total_sec = sum(zone_totals.values())
    if zone_total_sec > 0:
        zone_pcts = {k: round(v / zone_total_sec * 100) for k, v in zone_totals.items()}
        zone_str = ", ".join(f"Z{k[1]}: {v}%" for k, v in zone_pcts.items() if v > 0)
    else:
        zone_str = "not available"

    avg_hrv = (
        sum(r.hrv_rmssd for r in rows if r.hrv_rmssd) / sum(1 for r in rows if r.hrv_rmssd)
        if any(r.hrv_rmssd for r in rows)
        else None
    )
    avg_sleep = (
        sum(r.sleep_hours for r in rows if r.sleep_hours) / sum(1 for r in rows if r.sleep_hours)
        if any(r.sleep_hours for r in rows)
        else None
    )

    week_data = {
        "distance_km": total_dist_km,
        "duration_hours": total_hours,
        "zone_distribution": zone_str,
        "atl": latest.atl or 0,
        "ctl": latest.ctl or 0,
        "tsb": latest.tsb or 0,
        "hrv_trend": round(avg_hrv, 1) if avg_hrv else "not available",
        "avg_sleep_score": f"{avg_sleep:.1f}h" if avg_sleep else "not available",
    }

    summary_text = await generate_weekly_ai_summary(
        goal=athlete.goal or "unspecified goal",
        target_race=athlete.target_race or "unspecified race",
        week_data=week_data,
    )

    now = datetime.now(timezone.utc)
    athlete.ai_summary = summary_text
    athlete.ai_summary_generated_at = now
    await db.commit()

    return {
        "summary": summary_text,
        "generated_at": now.isoformat(),
        "stale": False,
    }
