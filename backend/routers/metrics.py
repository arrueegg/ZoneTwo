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
    """
    Return the most recent wellness snapshot merged with the most recent CTL/ATL/TSB.
    Wellness (HRV, sleep, etc.) and training load often land on different rows —
    the last training day may not be today, and today may have no activity.
    """
    # Most recent wellness data (today or yesterday)
    wellness_result = await db.execute(
        select(DailyMetrics)
        .where(DailyMetrics.athlete_id == athlete_id)
        .order_by(DailyMetrics.date.desc())
        .limit(1)
    )
    latest = wellness_result.scalar_one_or_none()
    if not latest:
        return {}

    # Most recent row that has CTL (may differ from the wellness row)
    load_result = await db.execute(
        select(DailyMetrics)
        .where(
            DailyMetrics.athlete_id == athlete_id,
            DailyMetrics.ctl.is_not(None),
        )
        .order_by(DailyMetrics.date.desc())
        .limit(1)
    )
    latest_load = load_result.scalar_one_or_none()

    return {
        "date": latest.date.isoformat(),
        "ctl": latest_load.ctl if latest_load else None,
        "atl": latest_load.atl if latest_load else None,
        "tsb": latest_load.tsb if latest_load else None,
        "daily_tss": latest_load.daily_tss if latest_load else None,
        "hrv_rmssd": latest.hrv_rmssd,
        "resting_hr": latest.resting_hr,
        "sleep_hours": latest.sleep_hours,
        "body_battery_high": latest.body_battery_high,
        "body_battery_low": latest.body_battery_low,
        "body_battery_wake": latest.body_battery_wake,
        "steps": latest.steps,
        "stress_avg": latest.stress_avg,
        "spo2_avg": latest.spo2_avg,
        "respiration_avg": latest.respiration_avg,
        "readiness_score": latest.readiness_score,
        "training_status": latest.training_status,
        "endurance_score": latest.endurance_score,
    }
