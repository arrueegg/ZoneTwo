from typing import Any

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.athlete import Athlete
from models.metrics import DailyMetrics
from services.recommendations import generate_rule_based_insights, generate_weekly_ai_summary
from sqlalchemy import select

router = APIRouter(prefix="/recommendations", tags=["recommendations"])


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


@router.post("/weekly-summary")
async def weekly_summary(
    athlete_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """
    Generate an AI-powered weekly coaching summary.
    Call this at most once per week per athlete — it consumes Claude API credits.
    """
    athlete = await db.get(Athlete, athlete_id)
    if not athlete:
        raise HTTPException(status_code=404, detail="Athlete not found")

    result = await db.execute(
        select(DailyMetrics)
        .where(DailyMetrics.athlete_id == athlete_id)
        .order_by(DailyMetrics.date.desc())
        .limit(7)
    )
    rows = result.scalars().all()
    if not rows:
        raise HTTPException(status_code=400, detail="No metrics data available yet")

    latest = rows[0]
    total_tss = sum(r.daily_tss or 0 for r in rows)

    week_data = {
        "distance_km": 0,    # would be computed from activities table in production
        "duration_hours": 0,
        "zone_distribution": "not available",
        "atl": latest.atl or 0,
        "ctl": latest.ctl or 0,
        "tsb": latest.tsb or 0,
        "hrv_trend": latest.hrv_rmssd or "not available",
        "avg_sleep_score": latest.sleep_score or "not available",
    }

    summary = await generate_weekly_ai_summary(
        goal=athlete.goal or "unspecified goal",
        target_race=athlete.target_race or "unspecified race",
        week_data=week_data,
    )
    return {"summary": summary}
