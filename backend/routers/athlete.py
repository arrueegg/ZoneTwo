from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, SessionLocal
from models.activity import Activity
from models.athlete import Athlete
from services.crypto import encrypt, decrypt
from services.metrics import calculate_tss_from_hr
from services.sync import recalculate_training_load, sync_garmin_activities, sync_athlete_garmin

router = APIRouter(prefix="/athlete", tags=["athlete"])


class AthleteUpdate(BaseModel):
    threshold_hr: int | None = None
    max_hr: int | None = None
    goal: str | None = None
    target_race: str | None = None


@router.get("/{athlete_id}")
async def get_athlete(athlete_id: str, db: AsyncSession = Depends(get_db)):
    athlete = await db.get(Athlete, athlete_id)
    if not athlete:
        raise HTTPException(status_code=404, detail="Athlete not found")
    return {
        "id": athlete.id,
        "name": athlete.name,
        "threshold_hr": athlete.threshold_hr,
        "max_hr": athlete.max_hr,
        "goal": athlete.goal,
        "target_race": athlete.target_race,
        "strava_connected": bool(athlete.strava_athlete_id),
        "garmin_connected": bool(athlete.garmin_email),
        "garmin_email": athlete.garmin_email,
    }


@router.patch("/{athlete_id}")
async def update_athlete(
    athlete_id: str,
    body: AthleteUpdate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    athlete = await db.get(Athlete, athlete_id)
    if not athlete:
        raise HTTPException(status_code=404, detail="Athlete not found")

    threshold_hr_changed = (
        body.threshold_hr is not None and body.threshold_hr != athlete.threshold_hr
    )

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(athlete, field, value)

    await db.commit()

    # Recalculate TSS for all activities if threshold HR changed
    if threshold_hr_changed:
        background_tasks.add_task(_recalculate_tss, athlete_id)

    return {"status": "updated"}


async def _recalculate_tss(athlete_id: str) -> None:
    """Backfill TSS for all activities using the updated threshold HR."""
    async with SessionLocal() as db:
        athlete = await db.get(Athlete, athlete_id)
        if not athlete or not athlete.threshold_hr:
            return

        result = await db.execute(
            select(Activity).where(
                Activity.athlete_id == athlete_id,
                Activity.avg_hr.is_not(None),
                Activity.duration_sec.is_not(None),
            )
        )
        activities = result.scalars().all()
        for activity in activities:
            activity.tss = calculate_tss_from_hr(
                activity.duration_sec,
                activity.avg_hr,
                float(athlete.threshold_hr),
            )

        await db.commit()
        print(f"[tss] Recalculated TSS for {len(activities)} activities")
        await recalculate_training_load(athlete_id, db)
        print(f"[tss] Training load updated for {athlete_id}")


class GarminCredentials(BaseModel):
    email: str
    password: str


@router.post("/{athlete_id}/garmin")
async def connect_garmin(
    athlete_id: str,
    body: GarminCredentials,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """
    Save Garmin credentials (password encrypted at rest) and trigger an initial sync.
    """
    from garminconnect import Garmin, GarminConnectAuthenticationError
    import asyncio

    # Verify credentials before saving
    try:
        await asyncio.to_thread(lambda: Garmin(email=body.email, password=body.password).login())
    except GarminConnectAuthenticationError:
        raise HTTPException(status_code=401, detail="Invalid Garmin credentials")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Garmin login failed: {exc}")

    athlete = await db.get(Athlete, athlete_id)
    if not athlete:
        raise HTTPException(status_code=404, detail="Athlete not found")

    athlete.garmin_email = body.email
    athlete.garmin_password_encrypted = encrypt(body.password)
    await db.commit()

    background_tasks.add_task(_garmin_sync, athlete_id)
    return {"status": "connected"}


@router.delete("/{athlete_id}/garmin")
async def disconnect_garmin(athlete_id: str, db: AsyncSession = Depends(get_db)):
    athlete = await db.get(Athlete, athlete_id)
    if not athlete:
        raise HTTPException(status_code=404, detail="Athlete not found")
    athlete.garmin_email = None
    athlete.garmin_password_encrypted = None
    await db.commit()
    return {"status": "disconnected"}


@router.post("/{athlete_id}/sync")
async def trigger_sync(
    athlete_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Kick off a full re-sync (activities + wellness + training load) in the background."""
    athlete = await db.get(Athlete, athlete_id)
    if not athlete:
        raise HTTPException(status_code=404, detail="Athlete not found")
    background_tasks.add_task(_full_sync, athlete_id)
    return {"status": "sync_started"}


async def _garmin_sync(athlete_id: str) -> None:
    await _full_sync(athlete_id)


async def _full_sync(athlete_id: str) -> None:
    async with SessionLocal() as db:
        athlete = await db.get(Athlete, athlete_id)
        if not athlete:
            return
        if athlete.garmin_email:
            await sync_garmin_activities(athlete, db, days=90)
        await sync_athlete_garmin(athlete, db, days=90)
        await recalculate_training_load(athlete_id, db)
        print(f"[sync] Full sync complete for {athlete_id}")
