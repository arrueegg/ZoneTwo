from __future__ import annotations

from datetime import date, datetime, timedelta
from math import ceil
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.activity import Activity
from models.athlete import Athlete
from models.metrics import DailyMetrics
from models.preparation import PlannedWorkout, TrainingEvent

router = APIRouter(prefix="/preparation", tags=["preparation"])


class EventIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    event_date: date
    event_type: str = "race"
    target_distance_km: float | None = Field(None, gt=0)
    target_time_sec: float | None = Field(None, gt=0)
    priority: str = Field("B", pattern="^[ABC]$")
    notes: str | None = None


class EventPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    event_date: date | None = None
    event_type: str | None = None
    target_distance_km: float | None = Field(None, gt=0)
    target_time_sec: float | None = Field(None, gt=0)
    priority: str | None = Field(None, pattern="^[ABC]$")
    notes: str | None = None


class PlanDiscussionIn(BaseModel):
    message: str = Field(..., min_length=1, max_length=1000)
    days_per_week: int = Field(4, ge=3, le=7)
    max_weekly_km: float | None = Field(None, gt=0)
    long_run_day: str = "Sun"
    emphasis: str = "balanced"


class WorkoutPatch(BaseModel):
    planned_date: date | None = None
    workout_type: str | None = None
    title: str | None = Field(None, min_length=1, max_length=160)
    description: str | None = None
    distance_km: float | None = Field(None, gt=0)
    status: str | None = Field(None, pattern="^(planned|accepted|completed|skipped|moved)$")
    notes: str | None = None


@router.get("/events")
async def list_events(
    athlete_id: str = Query(...),
    include_past: bool = Query(False),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    filters = [TrainingEvent.athlete_id == athlete_id]
    if not include_past:
        filters.append(TrainingEvent.event_date >= date.today())

    result = await db.execute(
        select(TrainingEvent)
        .where(and_(*filters))
        .order_by(TrainingEvent.event_date)
    )
    return [_serialize_event(event) for event in result.scalars().all()]


@router.get("/season-plan")
async def get_season_plan(
    athlete_id: str = Query(...),
    days_per_week: int = Query(4, ge=3, le=7),
    max_weekly_km: float | None = Query(None, gt=0),
    long_run_day: str = Query("Sun"),
    emphasis: str = Query("balanced"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    athlete = await db.get(Athlete, athlete_id)
    if not athlete:
        raise HTTPException(status_code=404, detail="Athlete not found")

    events = await _upcoming_events(athlete_id, db)
    latest_metrics = await _latest_metrics(athlete_id, db)
    recent_runs = await _recent_runs(athlete_id, db)
    options = _plan_options(days_per_week, max_weekly_km, long_run_day, emphasis)

    weeks = _build_season_plan(events, athlete, latest_metrics, recent_runs, options)
    return {
        "events": [_serialize_event(event) for event in events],
        "recommendations": _season_recommendations(events),
        "weeks": weeks,
    }


@router.post("/season-workouts/generate")
async def save_season_workouts(
    athlete_id: str = Query(...),
    days_per_week: int = Query(4, ge=3, le=7),
    max_weekly_km: float | None = Query(None, gt=0),
    long_run_day: str = Query("Sun"),
    emphasis: str = Query("balanced"),
    replace: bool = Query(False),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    athlete = await db.get(Athlete, athlete_id)
    if not athlete:
        raise HTTPException(status_code=404, detail="Athlete not found")

    events = await _upcoming_events(athlete_id, db)
    if not events:
        return []

    existing_result = await db.execute(
        select(PlannedWorkout).where(
            PlannedWorkout.athlete_id == athlete_id,
            PlannedWorkout.planned_date >= date.today(),
        )
    )
    existing = list(existing_result.scalars().all())
    if existing and not replace:
        return [_serialize_workout(workout) for workout in sorted(existing, key=lambda w: (w.planned_date, w.sort_order))]

    for workout in existing:
        await db.delete(workout)

    latest_metrics = await _latest_metrics(athlete_id, db)
    recent_runs = await _recent_runs(athlete_id, db)
    options = _plan_options(days_per_week, max_weekly_km, long_run_day, emphasis)
    weeks = _build_season_plan(events, athlete, latest_metrics, recent_runs, options)

    saved: list[PlannedWorkout] = []
    for week in weeks:
        week_start = date.fromisoformat(week["starts_on"])
        for sort_order, workout in enumerate(week["workouts"]):
            planned = PlannedWorkout(
                id=f"workout_{uuid4().hex}",
                event_id=week["primary_event_id"],
                athlete_id=athlete_id,
                week=week["week"],
                planned_date=_date_for_day(week_start, workout["day"]),
                workout_type=workout["type"],
                title=workout["title"],
                description=workout["description"],
                distance_km=workout.get("distance_km"),
                status="planned",
                sort_order=sort_order,
            )
            db.add(planned)
            saved.append(planned)

    await db.commit()
    return [_serialize_workout(workout) for workout in sorted(saved, key=lambda w: (w.planned_date, w.sort_order))]


@router.post("/events")
async def create_event(
    body: EventIn,
    athlete_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    athlete = await db.get(Athlete, athlete_id)
    if not athlete:
        raise HTTPException(status_code=404, detail="Athlete not found")
    event = TrainingEvent(
        id=f"event_{uuid4().hex}",
        athlete_id=athlete_id,
        name=body.name.strip(),
        event_date=body.event_date,
        event_type=body.event_type.lower().strip() or "race",
        target_distance_km=body.target_distance_km,
        target_time_sec=body.target_time_sec,
        priority=body.priority,
        notes=body.notes.strip() if body.notes else None,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return _serialize_event(event)


@router.patch("/events/{event_id}")
async def update_event(
    event_id: str,
    body: EventPatch,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    event = await db.get(TrainingEvent, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        if field in {"name", "event_type", "notes"} and isinstance(value, str):
            value = value.strip()
        if field == "event_type" and value:
            value = value.lower()
        if field == "notes" and not value:
            value = None
        setattr(event, field, value)

    await db.commit()
    await db.refresh(event)
    return _serialize_event(event)


@router.delete("/events/{event_id}")
async def delete_event(event_id: str, db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    event = await db.get(TrainingEvent, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    await db.delete(event)
    await db.commit()
    return {"status": "deleted"}


@router.get("/events/{event_id}/plan")
async def get_event_plan(
    event_id: str,
    days_per_week: int = Query(4, ge=3, le=7),
    max_weekly_km: float | None = Query(None, gt=0),
    long_run_day: str = Query("Sun"),
    emphasis: str = Query("balanced"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    event = await db.get(TrainingEvent, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    athlete = await db.get(Athlete, event.athlete_id)
    if not athlete:
        raise HTTPException(status_code=404, detail="Athlete not found")

    latest_metrics = await _latest_metrics(event.athlete_id, db)
    recent_runs = await _recent_runs(event.athlete_id, db)

    context = _planning_context(event, athlete, latest_metrics, recent_runs)
    options = _plan_options(days_per_week, max_weekly_km, long_run_day, emphasis)
    plan = _build_plan(event, context, options)

    return {
        "event": _serialize_event(event),
        "context": context,
        "options": options,
        "summary": _plan_summary(event, context),
        "weeks": plan,
    }


@router.post("/events/{event_id}/discuss")
async def discuss_event_plan(
    event_id: str,
    body: PlanDiscussionIn,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    event = await db.get(TrainingEvent, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    athlete = await db.get(Athlete, event.athlete_id)
    if not athlete:
        raise HTTPException(status_code=404, detail="Athlete not found")

    latest_metrics = await _latest_metrics(event.athlete_id, db)
    recent_runs = await _recent_runs(event.athlete_id, db)
    context = _planning_context(event, athlete, latest_metrics, recent_runs)
    options = _plan_options(body.days_per_week, body.max_weekly_km, body.long_run_day, body.emphasis)
    plan = _build_plan(event, context, options)

    return {
        "reply": _discuss_plan(body.message, event, context, options, plan),
        "plan": {
            "event": _serialize_event(event),
            "context": context,
            "options": options,
            "summary": _plan_summary(event, context),
            "weeks": plan,
        },
    }


@router.get("/events/{event_id}/workouts")
async def list_planned_workouts(event_id: str, db: AsyncSession = Depends(get_db)) -> list[dict[str, Any]]:
    event = await db.get(TrainingEvent, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    result = await db.execute(
        select(PlannedWorkout)
        .where(PlannedWorkout.event_id == event_id)
        .order_by(PlannedWorkout.planned_date, PlannedWorkout.sort_order)
    )
    return [_serialize_workout(workout) for workout in result.scalars().all()]


@router.post("/events/{event_id}/workouts/generate")
async def save_generated_workouts(
    event_id: str,
    days_per_week: int = Query(4, ge=3, le=7),
    max_weekly_km: float | None = Query(None, gt=0),
    long_run_day: str = Query("Sun"),
    emphasis: str = Query("balanced"),
    replace: bool = Query(False),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    event = await db.get(TrainingEvent, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    existing_result = await db.execute(
        select(PlannedWorkout).where(PlannedWorkout.event_id == event_id)
    )
    existing = list(existing_result.scalars().all())
    if existing and not replace:
        return [_serialize_workout(workout) for workout in sorted(existing, key=lambda w: (w.planned_date, w.sort_order))]

    for workout in existing:
        await db.delete(workout)

    athlete = await db.get(Athlete, event.athlete_id)
    latest_metrics = await _latest_metrics(event.athlete_id, db)
    recent_runs = await _recent_runs(event.athlete_id, db)
    context = _planning_context(event, athlete, latest_metrics, recent_runs)
    options = _plan_options(days_per_week, max_weekly_km, long_run_day, emphasis)
    plan = _build_plan(event, context, options)

    saved: list[PlannedWorkout] = []
    for week in plan:
        week_start = date.fromisoformat(week["starts_on"])
        for sort_order, workout in enumerate(week["workouts"]):
            planned = PlannedWorkout(
                id=f"workout_{uuid4().hex}",
                event_id=event_id,
                athlete_id=event.athlete_id,
                week=week["week"],
                planned_date=_date_for_day(week_start, workout["day"]),
                workout_type=workout["type"],
                title=workout["title"],
                description=workout["description"],
                distance_km=workout.get("distance_km"),
                status="planned",
                sort_order=sort_order,
            )
            db.add(planned)
            saved.append(planned)

    await db.commit()
    return [_serialize_workout(workout) for workout in sorted(saved, key=lambda w: (w.planned_date, w.sort_order))]


@router.patch("/workouts/{workout_id}")
async def update_planned_workout(
    workout_id: str,
    body: WorkoutPatch,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    workout = await db.get(PlannedWorkout, workout_id)
    if not workout:
        raise HTTPException(status_code=404, detail="Workout not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        if field in {"title", "description", "workout_type", "status", "notes"} and isinstance(value, str):
            value = value.strip()
        if field in {"description", "notes"} and not value:
            value = None
        setattr(workout, field, value)

    await db.commit()
    await db.refresh(workout)
    return _serialize_workout(workout)


async def _latest_metrics(athlete_id: str, db: AsyncSession) -> DailyMetrics | None:
    result = await db.execute(
        select(DailyMetrics)
        .where(DailyMetrics.athlete_id == athlete_id)
        .order_by(DailyMetrics.date.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _upcoming_events(athlete_id: str, db: AsyncSession) -> list[TrainingEvent]:
    result = await db.execute(
        select(TrainingEvent)
        .where(
            TrainingEvent.athlete_id == athlete_id,
            TrainingEvent.event_date >= date.today(),
        )
        .order_by(TrainingEvent.event_date)
    )
    return list(result.scalars().all())


async def _recent_runs(athlete_id: str, db: AsyncSession) -> list[Activity]:
    start = datetime.now() - timedelta(days=28)
    result = await db.execute(
        select(Activity)
        .where(
            Activity.athlete_id == athlete_id,
            Activity.start_time >= start,
            Activity.sport_type.in_(["run", "trail_run"]),
        )
        .order_by(Activity.start_time.desc())
    )
    return list(result.scalars().all())


def _planning_context(
    event: TrainingEvent,
    athlete: Athlete,
    latest: DailyMetrics | None,
    recent_runs: list[Activity],
) -> dict[str, Any]:
    today = date.today()
    days_to_event = max(0, (event.event_date - today).days)
    distance_km = event.target_distance_km or _distance_guess(event.name)
    recent_km = sum((run.distance_m or 0) for run in recent_runs) / 1000
    recent_hours = sum((run.duration_sec or 0) for run in recent_runs) / 3600
    weekly_km = recent_km / 4
    long_run_km = max([(run.distance_m or 0) / 1000 for run in recent_runs] or [0])
    run_frequency = len(recent_runs) / 4

    return {
        "days_to_event": days_to_event,
        "weeks_to_event": ceil(days_to_event / 7) if days_to_event else 0,
        "target_distance_km": distance_km,
        "target_time_sec": event.target_time_sec,
        "target_pace_sec_km": (
            event.target_time_sec / distance_km
            if event.target_time_sec and distance_km
            else None
        ),
        "recent_weekly_km": round(weekly_km, 1),
        "recent_weekly_hours": round(recent_hours / 4, 1),
        "recent_runs_per_week": round(run_frequency, 1),
        "recent_long_run_km": round(long_run_km, 1),
        "ctl": latest.ctl if latest else None,
        "atl": latest.atl if latest else None,
        "tsb": latest.tsb if latest else None,
        "readiness_score": latest.readiness_score if latest else None,
        "sleep_score": latest.sleep_score if latest else None,
        "stress_avg": latest.stress_avg if latest else None,
        "target_ctl": athlete.target_ctl,
        "threshold_hr": athlete.threshold_hr,
    }


def _plan_options(
    days_per_week: int,
    max_weekly_km: float | None,
    long_run_day: str,
    emphasis: str,
) -> dict[str, Any]:
    return {
        "days_per_week": min(7, max(3, days_per_week)),
        "max_weekly_km": max_weekly_km,
        "long_run_day": long_run_day if long_run_day in {"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"} else "Sun",
        "emphasis": emphasis if emphasis in {"balanced", "speed", "endurance", "conservative"} else "balanced",
    }


def _build_plan(
    event: TrainingEvent,
    context: dict[str, Any],
    options: dict[str, Any],
) -> list[dict[str, Any]]:
    weeks = min(16, max(1, context["weeks_to_event"] or 1))
    target_distance = context["target_distance_km"] or 10
    useful_floor = _useful_weekly_floor(target_distance, options["days_per_week"])
    recent_weekly = context["recent_weekly_km"] or 0
    current_km = max(useful_floor, recent_weekly)
    target_peak = _target_peak_km(target_distance, current_km, event.priority)
    if options["max_weekly_km"]:
        target_peak = min(target_peak, options["max_weekly_km"])
        current_km = min(current_km, options["max_weekly_km"])
    readiness = context["readiness_score"]
    tsb = context["tsb"]

    if readiness is not None and readiness < 45:
        target_peak *= 0.9
    if tsb is not None and tsb < -20:
        current_km *= 0.9

    plan: list[dict[str, Any]] = []
    for index in range(weeks):
        week_no = index + 1
        weeks_left = weeks - index
        taper_factor = 1.0
        if weeks_left == 1:
            taper_factor = 0.55
        elif weeks_left == 2 and target_distance >= 15:
            taper_factor = 0.75

        build_progress = index / max(1, weeks - 2)
        volume = current_km + (target_peak - current_km) * min(1.0, build_progress)
        if week_no % 4 == 0 and weeks_left > 2:
            volume *= 0.82
        volume *= taper_factor

        intensity = _intensity_focus(week_no, weeks_left, readiness, tsb, target_distance, options["emphasis"])
        long_run = _long_run_target(
            target_distance,
            volume,
            context["recent_long_run_km"] or 0,
            build_progress,
            weeks_left,
        )
        if options["max_weekly_km"]:
            long_run = min(long_run, volume * 0.5)

        plan.append({
            "week": week_no,
            "starts_on": (date.today() + timedelta(days=index * 7)).isoformat(),
            "focus": intensity["focus"],
            "target_km": round(max(0, volume), 1),
            "long_run_km": round(max(0, long_run), 1),
            "workouts": _week_workouts(volume, long_run, intensity, context, options),
            "adjustment_note": intensity["note"],
        })

    return plan


def _build_season_plan(
    events: list[TrainingEvent],
    athlete: Athlete,
    latest_metrics: DailyMetrics | None,
    recent_runs: list[Activity],
    options: dict[str, Any],
) -> list[dict[str, Any]]:
    if not events:
        return []

    today = date.today()
    last_event_date = max(event.event_date for event in events)
    weeks = min(24, max(1, ceil((last_event_date - today).days / 7)))
    weeks_by_event: dict[str, list[dict[str, Any]]] = {}
    contexts: dict[str, dict[str, Any]] = {}
    for event in events:
        context = _planning_context(event, athlete, latest_metrics, recent_runs)
        contexts[event.id] = context
        weeks_by_event[event.id] = _build_plan(event, context, options)

    aligned: list[dict[str, Any]] = []
    for index in range(weeks):
        week_start = today + timedelta(days=index * 7)
        week_end = week_start + timedelta(days=6)
        primary = _primary_event_for_week(events, week_start, week_end)
        event_weeks = weeks_by_event.get(primary.id, [])
        weeks_until_primary = max(0, ceil((primary.event_date - week_start).days / 7))
        event_week_index = max(0, len(event_weeks) - weeks_until_primary)
        event_week_index = min(event_week_index, max(0, len(event_weeks) - 1))
        source_week = event_weeks[event_week_index] if event_weeks else _fallback_week(primary, contexts[primary.id], options, index)
        supporting = [
            event.name
            for event in events
            if event.id != primary.id and week_start <= event.event_date <= week_end + timedelta(days=21)
        ][:3]

        aligned.append({
            **source_week,
            "week": index + 1,
            "starts_on": week_start.isoformat(),
            "primary_event_id": primary.id,
            "primary_event_name": primary.name,
            "supporting_events": supporting,
            "adjustment_note": _season_note(primary, supporting, source_week.get("adjustment_note", "")),
        })

    return aligned


def _primary_event_for_week(events: list[TrainingEvent], week_start: date, week_end: date) -> TrainingEvent:
    priority_weight = {"A": 300, "B": 180, "C": 80}

    def score(event: TrainingEvent) -> float:
        days_until = (event.event_date - week_start).days
        if days_until < -1:
            return -9999
        race_week_bonus = 220 if week_start <= event.event_date <= week_end else 0
        urgency = max(0, 140 - max(0, days_until) * 3)
        distance = event.target_distance_km or _distance_guess(event.name) or 10
        distance_weight = min(80, distance * 2)
        return priority_weight.get(event.priority, 120) + race_week_bonus + urgency + distance_weight

    return max(events, key=score)


def _season_recommendations(events: list[TrainingEvent]) -> list[dict[str, str]]:
    recommendations: list[dict[str, str]] = []
    sorted_events = sorted(events, key=lambda event: event.event_date)
    important = [event for event in sorted_events if event.priority in {"A", "B"}]

    for previous, current in zip(important, important[1:]):
        gap = (current.event_date - previous.event_date).days
        if gap < 14:
            recommendations.append({
                "severity": "high",
                "title": "Events are too close together",
                "body": f"{previous.name} and {current.name} are only {gap} days apart. Treat one as a tune-up or lower its priority.",
            })
        elif gap < 28 and (previous.priority == "A" or current.priority == "A"):
            recommendations.append({
                "severity": "medium",
                "title": "Limited rebuild time",
                "body": f"{previous.name} and {current.name} are {gap} days apart. The weeks between them should focus on recovery and sharpening, not a full new build.",
            })

    six_weeks = timedelta(days=42)
    for event in sorted_events:
        cluster = [
            other for other in important
            if event.event_date <= other.event_date <= event.event_date + six_weeks
        ]
        if len(cluster) >= 3:
            recommendations.append({
                "severity": "high",
                "title": "Too many priority events",
                "body": f"{len(cluster)} A/B events fall within six weeks starting at {event.name}. Pick one main goal and downgrade the others.",
            })
            break

    for previous, current in zip(sorted_events, sorted_events[1:]):
        prev_dist = previous.target_distance_km or _distance_guess(previous.name) or 0
        curr_dist = current.target_distance_km or _distance_guess(current.name) or 0
        gap = (current.event_date - previous.event_date).days
        if prev_dist and curr_dist and gap < 56 and max(prev_dist, curr_dist) / max(1, min(prev_dist, curr_dist)) >= 3:
            recommendations.append({
                "severity": "medium",
                "title": "Event demands do not align",
                "body": f"{previous.name} and {current.name} ask for very different preparation within {gap} days. Keep the smaller one as a workout effort.",
            })

    return recommendations


def _fallback_week(
    event: TrainingEvent,
    context: dict[str, Any],
    options: dict[str, Any],
    index: int,
) -> dict[str, Any]:
    target_distance = context["target_distance_km"] or 10
    volume = _useful_weekly_floor(target_distance, options["days_per_week"])
    long_run = _long_run_target(target_distance, volume, context["recent_long_run_km"] or 0, 0.0, 4)
    intensity = _intensity_focus(index + 1, 4, context["readiness_score"], context["tsb"], target_distance, options["emphasis"])
    return {
        "week": index + 1,
        "starts_on": (date.today() + timedelta(days=index * 7)).isoformat(),
        "focus": intensity["focus"],
        "target_km": round(volume, 1),
        "long_run_km": round(long_run, 1),
        "workouts": _week_workouts(volume, long_run, intensity, context, options),
        "adjustment_note": intensity["note"],
    }


def _season_note(primary: TrainingEvent, supporting: list[str], base_note: str) -> str:
    if supporting:
        return f"{base_note} This week is aligned to {primary.name}; also keep {', '.join(supporting)} in view."
    return f"{base_note} This is the single plan for the week, aligned to {primary.name}."


def _week_workouts(
    volume: float,
    long_run: float,
    intensity: dict[str, str],
    context: dict[str, Any],
    options: dict[str, Any],
) -> list[dict[str, Any]]:
    target_pace = _format_pace(context.get("target_pace_sec_km"))
    days = _training_days(options["days_per_week"], options["long_run_day"])
    support_days = [day for day in days if day != options["long_run_day"]] or [days[0]]
    remaining = max(0.0, volume - long_run)
    quality_km = min(max(3.0, volume * 0.22), max(3.0, remaining * 0.5))
    easy_pool = max(0.0, remaining - quality_km)
    easy_runs = max(1, len(days) - 2)
    easy_km = max(1.5, easy_pool / easy_runs)

    workouts = [
        {
            "type": "easy",
            "day": support_days[0],
            "distance_km": round(easy_km, 1),
            "title": "Easy aerobic run",
            "description": f"{easy_km:.1f} km relaxed. Keep it conversational.",
        },
        {
            "type": "long_run",
            "day": options["long_run_day"],
            "distance_km": round(long_run, 1),
            "title": "Long run",
            "description": f"{long_run:.1f} km easy. For a 10K goal this should usually build near 9-11 km, not stop at 4-5 km.",
        },
    ]

    if intensity["kind"] == "quality":
        workouts.insert(1, {
            "type": "quality",
            "day": support_days[min(1, len(support_days) - 1)],
            "distance_km": round(quality_km, 1),
            "title": "Race-specific quality",
            "description": (
                f"{quality_km:.1f} km total: warm up, controlled reps around target pace ({target_pace}), cool down."
                if target_pace
                else f"{quality_km:.1f} km total: warm up, controlled reps at comfortably hard effort, cool down."
            ),
        })
    elif intensity["kind"] == "tempo":
        workouts.insert(1, {
            "type": "tempo",
            "day": support_days[min(1, len(support_days) - 1)],
            "distance_km": round(quality_km, 1),
            "title": "Tempo / steady run",
            "description": f"{quality_km:.1f} km total with 20-40 min steady below threshold.",
        })
    else:
        workouts.insert(1, {
            "type": "recovery",
            "day": support_days[min(1, len(support_days) - 1)],
            "distance_km": round(max(3.0, quality_km * 0.7), 1),
            "title": "Recovery emphasis",
            "description": "Keep intensity low. Add strides only if legs feel fresh.",
        })

    used_days = {workout["day"] for workout in workouts}
    for day in days:
        if day in used_days:
            continue
        workouts.insert(-1, {
            "type": "easy",
            "day": day,
            "distance_km": round(easy_km, 1),
            "title": "Easy run",
            "description": f"{easy_km:.1f} km easy. Stay below aerobic drift.",
        })

    workouts.sort(key=lambda workout: _day_order(workout["day"]))
    return workouts


def _intensity_focus(
    week_no: int,
    weeks_left: int,
    readiness: float | None,
    tsb: float | None,
    target_distance: float,
    emphasis: str,
) -> dict[str, str]:
    if weeks_left == 1:
        return {"kind": "recovery", "focus": "Taper and sharpen", "note": "Race week: reduce load and keep legs fresh."}
    if emphasis == "conservative":
        return {"kind": "tempo", "focus": "Controlled aerobic build", "note": "Conservative setting: avoid stacking hard sessions."}
    if readiness is not None and readiness < 45:
        return {"kind": "recovery", "focus": "Absorb training", "note": "Readiness is low, so this week is intentionally conservative."}
    if tsb is not None and tsb < -20:
        return {"kind": "recovery", "focus": "Reduce fatigue", "note": "Fatigue is elevated; hold back before adding more load."}
    if week_no % 4 == 0:
        return {"kind": "recovery", "focus": "Deload", "note": "Planned lighter week to consolidate progress."}
    if emphasis == "speed" or (target_distance <= 10 and weeks_left > 2):
        return {"kind": "quality", "focus": "Speed and race rhythm", "note": "Shorter target favors controlled quality work."}
    if emphasis == "endurance" or weeks_left > 3:
        return {"kind": "tempo", "focus": "Aerobic build", "note": "Build durable volume before sharpening."}
    return {"kind": "quality", "focus": "Race-specific work", "note": "Shift toward the rhythm needed on event day."}


def _target_peak_km(target_distance: float, current_km: float, priority: str) -> float:
    if target_distance <= 6:
        base = 28
    elif target_distance <= 12:
        base = 38
    elif target_distance <= 24:
        base = 55
    else:
        base = 75

    priority_factor = {"A": 1.0, "B": 0.9, "C": 0.8}.get(priority, 0.9)
    return max(current_km * 1.15, min(base * priority_factor, current_km * 1.8 + 12))


def _useful_weekly_floor(target_distance: float, days_per_week: int) -> float:
    if target_distance <= 6:
        return max(16, days_per_week * 4)
    if target_distance <= 12:
        return max(22, days_per_week * 5)
    if target_distance <= 24:
        return max(32, days_per_week * 7)
    return max(42, days_per_week * 8)


def _long_run_target(
    target_distance: float,
    volume: float,
    recent_long_run: float,
    build_progress: float,
    weeks_left: int,
) -> float:
    if target_distance <= 6:
        goal_long = target_distance * 1.2
    elif target_distance <= 12:
        goal_long = target_distance * 1.05
    elif target_distance <= 24:
        goal_long = target_distance * 0.9
    else:
        goal_long = target_distance * 0.72

    start_long = max(recent_long_run * 1.05, min(goal_long * 0.72, target_distance * 0.7))
    long_run = start_long + (goal_long - start_long) * min(1.0, build_progress)
    long_run = min(long_run, volume * 0.46)

    if weeks_left == 1:
        long_run *= 0.55
    elif weeks_left == 2:
        long_run *= 0.75

    if weeks_left <= 1:
        return max(3.0, long_run)
    return max(min(target_distance * 0.65, 7.0), long_run)


def _training_days(days_per_week: int, long_run_day: str) -> list[str]:
    templates = {
        3: ["Tue", "Thu"],
        4: ["Tue", "Thu", "Sat"],
        5: ["Mon", "Tue", "Thu", "Sat"],
        6: ["Mon", "Tue", "Wed", "Thu", "Sat"],
        7: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    }
    days = [day for day in templates.get(days_per_week, templates[4]) if day != long_run_day]
    days.append(long_run_day)
    return sorted(days, key=_day_order)


def _day_order(day: str) -> int:
    return {"Mon": 0, "Tue": 1, "Wed": 2, "Thu": 3, "Fri": 4, "Sat": 5, "Sun": 6}.get(day, 6)


def _date_for_day(week_start: date, day: str) -> date:
    return week_start + timedelta(days=_day_order(day))


def _discuss_plan(
    message: str,
    event: TrainingEvent,
    context: dict[str, Any],
    options: dict[str, Any],
    plan: list[dict[str, Any]],
) -> str:
    text = message.lower()
    first_week = plan[0] if plan else {}
    long_run = first_week.get("long_run_km")
    target = context["target_distance_km"] or 10

    if any(word in text for word in ["long", "4.6", "short"]):
        goal_long = target * 1.05 if target <= 12 else target * 0.9
        return (
            f"You are right to challenge the long run. For {event.name}, the first week now starts "
            f"around {long_run} km and builds toward a target-specific long run near "
            f"{goal_long:.1f} km. "
            "For a 10K, a useful long run usually reaches roughly 9-11 km unless readiness or injury risk says otherwise."
        )

    if any(word in text for word in ["tired", "fatigue", "sore", "injury", "pain"]):
        return (
            "I would switch the next block to conservative: keep the long run, but remove the quality session for one week, "
            "cap intensity at easy effort, and only resume faster work after soreness and readiness normalize."
        )

    if any(word in text for word in ["days", "schedule", "busy", "available"]):
        return (
            f"The current plan uses {options['days_per_week']} run days with the long run on {options['long_run_day']}. "
            "Change those controls and the week will rebalance while keeping one long run, one key session, and easy support runs."
        )

    if any(word in text for word in ["pace", "target", "speed"]):
        pace = _format_pace(context.get("target_pace_sec_km"))
        if pace:
            return f"Target pace is {pace}. Quality days should touch that rhythm, but most weekly volume should stay easy so the plan is repeatable."
        return "Add a target time to the event and I can anchor quality sessions around a target pace. Without it, the plan uses effort-based quality."

    return (
        f"The plan is built around {event.name}, {context['days_to_event']} days away. "
        f"Week 1 targets {first_week.get('target_km')} km, with a {long_run} km long run and "
        f"{options['days_per_week']} running days. Use the controls to constrain the plan, then ask about any week or workout."
    )


def _plan_summary(event: TrainingEvent, context: dict[str, Any]) -> dict[str, Any]:
    days = context["days_to_event"]
    target_distance = context["target_distance_km"]
    weekly_km = context["recent_weekly_km"]
    long_run = context["recent_long_run_km"]

    flags: list[str] = []
    if target_distance and long_run < target_distance * 0.45 and days < 42:
        flags.append("Long run is still short relative to the target distance.")
    if context["tsb"] is not None and context["tsb"] < -20:
        flags.append("Current fatigue is high; plan starts conservatively.")
    if context["readiness_score"] is not None and context["readiness_score"] < 45:
        flags.append("Readiness is low; prioritize recovery before harder sessions.")

    return {
        "headline": f"{event.name} is {days} days away.",
        "current_load": f"Recent running volume is {weekly_km:.1f} km/week.",
        "target": (
            f"Target distance: {target_distance:.1f} km."
            if target_distance
            else "No target distance set yet."
        ),
        "risk_flags": flags,
    }


def _distance_guess(name: str) -> float | None:
    normalized = name.lower()
    if "marathon" in normalized and "half" not in normalized:
        return 42.2
    if "half" in normalized:
        return 21.1
    if "10k" in normalized or "10 km" in normalized:
        return 10
    if "5k" in normalized or "5 km" in normalized:
        return 5
    return None


def _format_pace(seconds_per_km: float | None) -> str | None:
    if not seconds_per_km:
        return None
    minutes = int(seconds_per_km // 60)
    seconds = int(round(seconds_per_km % 60))
    return f"{minutes}:{seconds:02d}/km"


def _serialize_event(event: TrainingEvent) -> dict[str, Any]:
    return {
        "id": event.id,
        "athlete_id": event.athlete_id,
        "name": event.name,
        "event_date": event.event_date.isoformat(),
        "event_type": event.event_type,
        "target_distance_km": event.target_distance_km,
        "target_time_sec": event.target_time_sec,
        "priority": event.priority,
        "notes": event.notes,
        "created_at": event.created_at.isoformat() if event.created_at else None,
        "updated_at": event.updated_at.isoformat() if event.updated_at else None,
    }


def _serialize_workout(workout: PlannedWorkout) -> dict[str, Any]:
    return {
        "id": workout.id,
        "event_id": workout.event_id,
        "athlete_id": workout.athlete_id,
        "week": workout.week,
        "planned_date": workout.planned_date.isoformat(),
        "workout_type": workout.workout_type,
        "title": workout.title,
        "description": workout.description,
        "distance_km": workout.distance_km,
        "status": workout.status,
        "notes": workout.notes,
        "sort_order": workout.sort_order,
        "created_at": workout.created_at.isoformat() if workout.created_at else None,
        "updated_at": workout.updated_at.isoformat() if workout.updated_at else None,
    }
