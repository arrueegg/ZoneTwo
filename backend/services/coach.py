"""
AI coach chat service.

Builds a data-grounded system prompt from the athlete's recent DB records
and calls Groq (llama-3.3-70b-versatile) to answer free-form questions.
"""

from datetime import datetime, timezone, timedelta
from typing import Any
import asyncio

import groq as groq_lib
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models.activity import Activity
from models.athlete import Athlete
from models.metrics import DailyMetrics
from models.preparation import PlannedWorkout, TrainingEvent


def _fmt_duration(sec: float | None) -> str:
    if not sec:
        return "—"
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    return f"{h}h{m}m" if h else f"{m}m"


def _fmt_pace(sec_km: float | None) -> str:
    if not sec_km:
        return "—"
    return f"{int(sec_km // 60)}:{int(sec_km % 60):02d}/km"


def _race_pred_str(preds: dict | None) -> str:
    if not preds:
        return "not available"
    parts = []
    labels = {"5k": "5k", "10k": "10k", "half_marathon": "half", "marathon": "marathon"}
    for key, label in labels.items():
        secs = preds.get(key)
        if secs:
            h = int(secs // 3600)
            m = int((secs % 3600) // 60)
            s = int(secs % 60)
            t = f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"
            parts.append(f"{label} {t}")
    return ", ".join(parts) if parts else "not available"


async def build_system_prompt(athlete_id: str, db: AsyncSession) -> str:
    """Fetch recent data and serialise into a system prompt for the LLM."""
    athlete = await db.get(Athlete, athlete_id)
    if not athlete:
        return "You are a personal endurance coach. No athlete data is available."

    # Last 14 days of daily metrics
    cutoff_14d = datetime.now(timezone.utc) - timedelta(days=14)
    metrics_result = await db.execute(
        select(DailyMetrics)
        .where(
            and_(
                DailyMetrics.athlete_id == athlete_id,
                DailyMetrics.date >= cutoff_14d.date(),
            )
        )
        .order_by(DailyMetrics.date.desc())
    )
    metrics_rows: list[DailyMetrics] = list(metrics_result.scalars().all())

    # Last 30 days of activities
    cutoff_30d = datetime.now(timezone.utc) - timedelta(days=30)
    acts_result = await db.execute(
        select(Activity)
        .where(
            and_(
                Activity.athlete_id == athlete_id,
                Activity.start_time >= cutoff_30d,
            )
        )
        .order_by(Activity.start_time.desc())
    )
    activities: list[Activity] = list(acts_result.scalars().all())

    # Upcoming preparation events and persisted planned workouts
    today = datetime.now(timezone.utc).date()
    events_result = await db.execute(
        select(TrainingEvent)
        .where(
            and_(
                TrainingEvent.athlete_id == athlete_id,
                TrainingEvent.event_date >= today,
            )
        )
        .order_by(TrainingEvent.event_date)
        .limit(5)
    )
    events: list[TrainingEvent] = list(events_result.scalars().all())

    workouts_result = await db.execute(
        select(PlannedWorkout)
        .where(
            and_(
                PlannedWorkout.athlete_id == athlete_id,
                PlannedWorkout.planned_date >= today,
            )
        )
        .order_by(PlannedWorkout.planned_date, PlannedWorkout.sort_order)
        .limit(30)
    )
    planned_workouts: list[PlannedWorkout] = list(workouts_result.scalars().all())

    # ── Athlete profile section ────────────────────────────────────────────────
    profile_lines = [
        f"Name: {athlete.name}",
        f"Goal: {athlete.goal or 'not set'}",
        f"Target race: {athlete.target_race or 'not set'}",
        f"Target CTL: {athlete.target_ctl or 'not set'}",
        f"Threshold HR: {athlete.threshold_hr or 'not set'} bpm",
        f"Max HR: {athlete.max_hr or 'not set'} bpm",
        f"VO2max: {athlete.vo2max:.1f}" if athlete.vo2max else "VO2max: not set",
        f"Fitness age: {athlete.fitness_age}" if athlete.fitness_age else "Fitness age: not set",
        f"Race predictions: {_race_pred_str(athlete.race_predictions)}",
    ]

    # ── Current training load (latest row with CTL) ────────────────────────────
    load_row = next((r for r in metrics_rows if r.ctl is not None), None)
    if load_row:
        load_lines = [
            f"CTL (fitness): {load_row.ctl:.1f}",
            f"ATL (fatigue): {load_row.atl:.1f}",
            f"TSB (form): {load_row.tsb:.1f}",
        ]
    else:
        load_lines = ["Training load: no data"]

    # ── Last 14 days of wellness ───────────────────────────────────────────────
    wellness_lines: list[str] = []
    for r in metrics_rows[:14]:
        parts: list[str] = [str(r.date)]
        if r.hrv_rmssd is not None:
            parts.append(f"HRV={r.hrv_rmssd:.0f}ms")
        if r.resting_hr is not None:
            parts.append(f"restHR={r.resting_hr:.0f}")
        if r.sleep_hours is not None:
            parts.append(f"sleep={r.sleep_hours:.1f}h")
        if r.sleep_score is not None:
            parts.append(f"sleepScore={r.sleep_score:.0f}")
        if r.readiness_score is not None:
            parts.append(f"readiness={r.readiness_score:.0f}")
        if r.training_readiness_score is not None:
            parts.append(f"garminReadiness={r.training_readiness_score:.0f}")
        if r.body_battery_wake is not None:
            parts.append(f"battery={r.body_battery_wake:.0f}")
        if r.stress_avg is not None:
            parts.append(f"stress={r.stress_avg:.0f}")
        if r.daily_tss is not None and r.daily_tss > 0:
            parts.append(f"TSS={r.daily_tss:.0f}")
        if r.training_status:
            parts.append(f"status={r.training_status}")
        wellness_lines.append("  " + ", ".join(parts))

    # ── Last 30 days of activities ─────────────────────────────────────────────
    activity_lines: list[str] = []
    for a in activities[:30]:
        date_str = a.start_time.strftime("%Y-%m-%d") if a.start_time else "?"
        dist = f"{a.distance_m / 1000:.1f}km" if a.distance_m else ""
        dur = _fmt_duration(a.duration_sec)
        hr = f"avgHR={a.avg_hr:.0f}" if a.avg_hr else ""
        pace = f"pace={_fmt_pace(a.avg_pace_sec_km)}" if a.avg_pace_sec_km else ""
        tss = f"TSS={a.tss:.0f}" if a.tss else ""
        te = (
            f"TE={a.aerobic_effect:.1f}/{a.anaerobic_effect:.1f}"
            if a.aerobic_effect is not None
            else ""
        )
        label = a.training_effect_label.replace("_", " ") if a.training_effect_label else ""
        parts = [p for p in [date_str, a.sport_type, dist, dur, hr, pace, tss, te, label] if p]
        activity_lines.append("  " + " | ".join(parts))

    event_lines: list[str] = []
    for event in events:
        distance = f"{event.target_distance_km:.1f}km" if event.target_distance_km else "distance not set"
        event_lines.append(
            f"  {event.event_date} | {event.name} | {event.priority} priority | {distance}"
        )

    planned_lines: list[str] = []
    for workout in planned_workouts:
        distance = f"{workout.distance_km:.1f}km" if workout.distance_km else "distance not set"
        planned_lines.append(
            f"  {workout.planned_date} | {workout.status} | {workout.workout_type} | {distance} | {workout.title}"
        )

    sections = [
        "## Athlete profile",
        *profile_lines,
        "",
        "## Current training load",
        *load_lines,
        "",
        "## Daily wellness (last 14 days, newest first)",
        *(wellness_lines if wellness_lines else ["  no data"]),
        "",
        "## Activities (last 30 days, newest first)",
        *(activity_lines if activity_lines else ["  no activities"]),
        "",
        "## Upcoming preparation targets",
        *(event_lines if event_lines else ["  no upcoming targets"]),
        "",
        "## Planned workouts (upcoming)",
        *(planned_lines if planned_lines else ["  no planned workouts saved"]),
    ]

    data_block = "\n".join(sections)

    return (
        "You are a personal endurance coach talking directly to your athlete. "
        "You have access to all of their recent training and wellness data shown below. "
        "Give specific, data-grounded advice. Reference exact numbers from the data when relevant. "
        "Be concise and direct — 3–6 sentences per response unless a detailed plan is requested. "
        "Always address the athlete as 'you'. Never make up data that isn't in the context.\n\n"
        f"{data_block}"
    )


async def chat(
    athlete_id: str,
    message: str,
    history: list[dict[str, str]],
    db: AsyncSession,
) -> str:
    """Send a message to the AI coach and return the reply."""
    system_prompt = await build_system_prompt(athlete_id, db)

    messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    # Include up to last 10 history turns to stay within token budget
    for turn in history[-10:]:
        if turn.get("role") in ("user", "assistant") and turn.get("content"):
            messages.append({"role": turn["role"], "content": turn["content"]})
    messages.append({"role": "user", "content": message})

    def _call() -> str:
        client = groq_lib.Groq(api_key=settings.groq_api_key)
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            max_tokens=600,
            temperature=0.4,
            messages=messages,
        )
        return response.choices[0].message.content or ""

    return await asyncio.to_thread(_call)
