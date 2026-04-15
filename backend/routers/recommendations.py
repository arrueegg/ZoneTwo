from datetime import datetime, timezone, timedelta
from typing import Any
import json

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from database import get_db
from models.activity import Activity
from models.athlete import Athlete
from models.metrics import DailyMetrics
from models.preparation import PlannedWorkout, TrainingEvent
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


def _parse_cached_summary(raw: str | None) -> dict[str, str] | None:
    """Parse a cached summary string — handles both old plain-text and new JSON format."""
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    # Legacy plain-text — wrap it so the frontend still gets something
    return {"week_summary": raw, "training_recommendation": "", "recovery_insight": ""}


@router.get("/weekly-summary")
async def get_weekly_summary(
    athlete_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Return the cached AI weekly summary, or indicate that none is available yet."""
    athlete = await db.get(Athlete, athlete_id)
    if not athlete:
        raise HTTPException(status_code=404, detail="Athlete not found")
    parsed = _parse_cached_summary(athlete.ai_summary)
    if not parsed:
        return {"sections": None, "generated_at": None, "stale": True}
    age = datetime.now(timezone.utc) - athlete.ai_summary_generated_at.replace(tzinfo=timezone.utc)
    return {
        "sections": parsed,
        "generated_at": athlete.ai_summary_generated_at.isoformat(),
        "stale": age > _AI_SUMMARY_TTL,
    }


@router.post("/weekly-summary")
async def generate_weekly_summary(
    athlete_id: str = Query(...),
    force: bool = Query(False),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """
    Generate (or refresh) the AI weekly coaching summary and cache it.
    Pass force=true to regenerate even if a fresh cached version exists.
    """
    athlete = await db.get(Athlete, athlete_id)
    if not athlete:
        raise HTTPException(status_code=404, detail="Athlete not found")

    # Serve cache if fresh and not forced
    if not force and athlete.ai_summary and athlete.ai_summary_generated_at:
        age = datetime.now(timezone.utc) - athlete.ai_summary_generated_at.replace(tzinfo=timezone.utc)
        if age < _AI_SUMMARY_TTL:
            return {
                "sections": _parse_cached_summary(athlete.ai_summary),
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

    # Use most recent wellness row, but find CTL/ATL/TSB from the last row that has it
    latest = rows[0]
    latest_load = next((r for r in rows if r.ctl is not None), None)

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

    today = datetime.now(timezone.utc).date()
    upcoming_events = await _upcoming_events(athlete_id, db, today)
    current_planned = await _planned_workouts(athlete_id, db, week_start.date(), today)
    next_planned = await _planned_workouts(athlete_id, db, today, today + timedelta(days=14))
    planned_km = sum(workout.distance_km or 0 for workout in current_planned)

    week_data = {
        "distance_km": total_dist_km,
        "duration_hours": total_hours,
        "zone_distribution": zone_str,
        "atl": (latest_load.atl if latest_load else None) or 0,
        "ctl": (latest_load.ctl if latest_load else None) or 0,
        "tsb": (latest_load.tsb if latest_load else None) or 0,
        "hrv_trend": round(avg_hrv, 1) if avg_hrv else "not available",
        "avg_sleep_score": f"{avg_sleep:.1f}h" if avg_sleep else "not available",
        "target_context": _target_context(upcoming_events, today),
        "phase_context": _phase_context(upcoming_events, today),
        "plan_context": _plan_context(current_planned, next_planned),
        "on_track_context": _on_track_context(total_dist_km, planned_km, current_planned),
    }

    sections = await generate_weekly_ai_summary(
        goal=athlete.goal or "unspecified goal",
        target_race=athlete.target_race or "unspecified race",
        week_data=week_data,
    )

    now = datetime.now(timezone.utc)
    athlete.ai_summary = json.dumps(sections)
    athlete.ai_summary_generated_at = now
    await db.commit()

    return {
        "sections": sections,
        "generated_at": now.isoformat(),
        "stale": False,
    }


async def _upcoming_events(
    athlete_id: str,
    db: AsyncSession,
    today,
) -> list[TrainingEvent]:
    result = await db.execute(
        select(TrainingEvent)
        .where(
            TrainingEvent.athlete_id == athlete_id,
            TrainingEvent.event_date >= today,
        )
        .order_by(TrainingEvent.event_date)
        .limit(5)
    )
    return list(result.scalars().all())


async def _planned_workouts(
    athlete_id: str,
    db: AsyncSession,
    start_date,
    end_date,
) -> list[PlannedWorkout]:
    result = await db.execute(
        select(PlannedWorkout)
        .where(
            PlannedWorkout.athlete_id == athlete_id,
            PlannedWorkout.planned_date >= start_date,
            PlannedWorkout.planned_date <= end_date,
        )
        .order_by(PlannedWorkout.planned_date, PlannedWorkout.sort_order)
    )
    return list(result.scalars().all())


def _target_context(events: list[TrainingEvent], today) -> str:
    if not events:
        return "no upcoming preparation targets saved"
    parts = []
    for event in events[:3]:
        days = max(0, (event.event_date - today).days)
        distance = f"{event.target_distance_km:g} km" if event.target_distance_km else event.event_type
        parts.append(f"{event.name} in {days} days ({distance}, priority {event.priority})")
    return "; ".join(parts)


def _phase_context(events: list[TrainingEvent], today) -> str:
    if not events:
        return "general training phase because no upcoming target is saved"
    main = sorted(events, key=lambda event: (event.priority != "A", event.event_date))[0]
    days = max(0, (main.event_date - today).days)
    if days <= 7:
        phase = "race-week/taper"
    elif days <= 21:
        phase = "sharpening phase"
    elif days <= 56:
        phase = "specific build phase"
    elif days <= 98:
        phase = "base-to-build phase"
    else:
        phase = "early base phase"
    return f"{phase} for {main.name}, {days} days away"


def _plan_context(current_planned: list[PlannedWorkout], next_planned: list[PlannedWorkout]) -> str:
    if not current_planned and not next_planned:
        return "no saved preparation workouts to compare against"
    current_km = sum(workout.distance_km or 0 for workout in current_planned)
    current_types = _workout_types(current_planned)
    next_bits = [
        f"{workout.planned_date.isoformat()} {workout.title} ({workout.distance_km:g} km)" if workout.distance_km else f"{workout.planned_date.isoformat()} {workout.title}"
        for workout in next_planned[:4]
    ]
    current_text = (
        f"current 7-day plan has {len(current_planned)} workouts, {current_km:.1f} planned km"
        + (f", types: {', '.join(current_types)}" if current_types else "")
    ) if current_planned else "no planned workouts in the last 7 days"
    next_text = f"next saved workouts: {'; '.join(next_bits)}" if next_bits else "no upcoming saved workouts"
    return f"{current_text}; {next_text}"


def _on_track_context(completed_km: float, planned_km: float, planned_workouts: list[PlannedWorkout]) -> str:
    if planned_km <= 0 or not planned_workouts:
        return "cannot judge plan adherence because no planned workouts were saved for this week"
    ratio = completed_km / planned_km
    if ratio < 0.65:
        return f"behind planned volume: completed {completed_km:.1f} km vs {planned_km:.1f} planned km"
    if ratio > 1.25:
        return f"ahead of planned volume: completed {completed_km:.1f} km vs {planned_km:.1f} planned km; watch recovery"
    return f"roughly on track: completed {completed_km:.1f} km vs {planned_km:.1f} planned km"


def _workout_types(workouts: list[PlannedWorkout]) -> list[str]:
    types: list[str] = []
    for workout in workouts:
        workout_type = workout.workout_type.lower()
        if workout_type not in types:
            types.append(workout_type)
    return types[:4]
