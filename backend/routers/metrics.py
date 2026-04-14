from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.metrics import DailyMetrics
from services.analytics import detect_anomalies, compute_weekly_summary, compute_correlations

router = APIRouter(prefix="/metrics", tags=["metrics"])


@router.get("/training-load")
async def training_load(
    athlete_id: str = Query(...),
    start: date = Query(...),
    end: date = Query(...),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """Return daily CTL/ATL/TSB for a date range."""
    result = await db.execute(
        select(DailyMetrics)
        .where(and_(
            DailyMetrics.athlete_id == athlete_id,
            DailyMetrics.date >= start,
            DailyMetrics.date <= end,
        ))
        .order_by(DailyMetrics.date)
    )
    rows = result.scalars().all()
    return [
        {
            "date": r.date.isoformat(),
            "ctl": r.ctl,
            "atl": r.atl,
            "tsb": r.tsb,
            "daily_tss": r.daily_tss,
        }
        for r in rows
    ]


@router.get("/wellness")
async def wellness(
    athlete_id: str = Query(...),
    start: date = Query(...),
    end: date = Query(...),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """Return daily wellness metrics (HRV, sleep, body battery, steps, stress) for a date range."""
    result = await db.execute(
        select(DailyMetrics)
        .where(and_(
            DailyMetrics.athlete_id == athlete_id,
            DailyMetrics.date >= start,
            DailyMetrics.date <= end,
        ))
        .order_by(DailyMetrics.date)
    )
    rows = result.scalars().all()
    return [
        {
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
            "respiration_avg": r.respiration_avg,
            "readiness_score": r.readiness_score,
        }
        for r in rows
    ]


@router.get("/analysis")
async def analysis(
    athlete_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """
    Return anomalies for today, weekly summaries, and metric correlations.
    Computed on-the-fly from the full history.
    """
    result = await db.execute(
        select(DailyMetrics)
        .where(DailyMetrics.athlete_id == athlete_id)
        .order_by(DailyMetrics.date)
    )
    rows = result.scalars().all()
    if not rows:
        return {"anomalies": [], "weekly_summary": [], "correlations": []}

    history = [_row_to_dict(r) for r in rows]
    today = history[-1]
    past = history[:-1]

    return {
        "anomalies": detect_anomalies(today, past),
        "weekly_summary": compute_weekly_summary(history),
        "correlations": compute_correlations(history),
    }


def _row_to_dict(r: DailyMetrics) -> dict[str, Any]:
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
        "ctl": r.ctl,
        "atl": r.atl,
        "tsb": r.tsb,
    }


@router.get("/summary")
async def metrics_summary(
    athlete_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Return the most recent metrics snapshot for an athlete."""
    result = await db.execute(
        select(DailyMetrics)
        .where(DailyMetrics.athlete_id == athlete_id)
        .order_by(DailyMetrics.date.desc())
        .limit(1)
    )
    today = result.scalar_one_or_none()
    if not today:
        return {}

    return {
        "date": today.date.isoformat(),
        "ctl": today.ctl,
        "atl": today.atl,
        "tsb": today.tsb,
        "daily_tss": today.daily_tss,
        "hrv_rmssd": today.hrv_rmssd,
        "resting_hr": today.resting_hr,
        "sleep_hours": today.sleep_hours,
        "body_battery_high": today.body_battery_high,
        "body_battery_low": today.body_battery_low,
        "body_battery_wake": today.body_battery_wake,
        "steps": today.steps,
        "stress_avg": today.stress_avg,
        "spo2_avg": today.spo2_avg,
        "respiration_avg": today.respiration_avg,
        "readiness_score": today.readiness_score,
    }
