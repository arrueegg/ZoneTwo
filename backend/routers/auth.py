import asyncio
import uuid
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from config import settings
from database import get_db, SessionLocal
from integrations import strava
from models.athlete import Athlete
from services.crypto import encrypt
from services.sync import sync_athlete_strava, sync_garmin_activities, sync_athlete_garmin, recalculate_training_load

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/strava/login")
async def strava_login():
    """Redirect user to Strava OAuth consent screen."""
    temp_id = str(uuid.uuid4())
    return RedirectResponse(strava.get_auth_url(temp_id))


@router.get("/strava/callback")
async def strava_callback(
    background_tasks: BackgroundTasks,
    code: str = Query(...),
    state: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Strava redirects here with an auth code.
    Exchange it for tokens, fetch the athlete profile, and upsert the record.
    """
    token_data = await strava.exchange_code(code)

    if "access_token" not in token_data:
        raise HTTPException(status_code=400, detail="Strava token exchange failed")

    access_token = token_data["access_token"]
    profile = await strava.fetch_athlete_profile(access_token)
    strava_athlete_id = str(profile["id"])

    result = await db.execute(
        select(Athlete).where(Athlete.strava_athlete_id == strava_athlete_id)
    )
    athlete = result.scalar_one_or_none()

    if not athlete:
        athlete = Athlete(
            id=f"strava_{strava_athlete_id}",
            name=f"{profile.get('firstname', '')} {profile.get('lastname', '')}".strip(),
            strava_athlete_id=strava_athlete_id,
        )
        db.add(athlete)

    athlete.strava_access_token = access_token
    athlete.strava_refresh_token = token_data["refresh_token"]
    athlete.strava_token_expires_at = token_data["expires_at"]

    await db.commit()

    # Kick off initial sync in the background (no Celery needed)
    athlete_id = athlete.id
    background_tasks.add_task(_background_sync, athlete_id)

    # Redirect to frontend, passing athlete_id so it can be stored in localStorage
    return RedirectResponse(
        f"{settings.frontend_url}/?athlete_id={athlete_id}&name={athlete.name}"
    )


async def _background_sync(athlete_id: str) -> None:
    async with SessionLocal() as db:
        athlete = await db.get(Athlete, athlete_id)
        if not athlete:
            return
        print(f"[sync] Starting initial sync for {athlete_id}")
        new_count = await sync_athlete_strava(athlete, db)
        print(f"[sync] {athlete_id}: {new_count} activities synced")
        await recalculate_training_load(athlete_id, db)
        print(f"[sync] {athlete_id}: training load recalculated")


class GarminLoginRequest(BaseModel):
    email: str
    password: str


@router.post("/garmin/login")
async def garmin_login(
    body: GarminLoginRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """
    Create (or retrieve) an athlete account using Garmin credentials.
    Works independently of Strava — Garmin is used as the identity provider.
    """
    from garminconnect import Garmin, GarminConnectAuthenticationError

    # Verify credentials and fetch display name
    try:
        client = await asyncio.to_thread(
            lambda: _garmin_login(body.email, body.password)
        )
        display_name = await asyncio.to_thread(client.get_full_name)
    except GarminConnectAuthenticationError:
        raise HTTPException(status_code=401, detail="Invalid Garmin credentials")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Garmin login failed: {exc}")

    if not display_name:
        display_name = body.email.split("@")[0]

    # Use email as stable identifier
    athlete_id = f"garmin_{body.email.replace('@', '_').replace('.', '_')}"

    result = await db.execute(select(Athlete).where(Athlete.id == athlete_id))
    athlete = result.scalar_one_or_none()

    if not athlete:
        athlete = Athlete(
            id=athlete_id,
            name=display_name,
            email=body.email,
        )
        db.add(athlete)

    athlete.garmin_email = body.email
    athlete.garmin_password_encrypted = encrypt(body.password)
    await db.commit()

    background_tasks.add_task(_garmin_background_sync, athlete_id)

    return {
        "athlete_id": athlete_id,
        "name": athlete.name,
    }


def _garmin_login(email: str, password: str):
    from garminconnect import Garmin
    client = Garmin(email=email, password=password)
    client.login()
    return client


async def _garmin_background_sync(athlete_id: str) -> None:
    async with SessionLocal() as db:
        athlete = await db.get(Athlete, athlete_id)
        if not athlete:
            return
        print(f"[garmin] Starting initial sync for {athlete_id}")
        await sync_garmin_activities(athlete, db, days=90)
        updated = await sync_athlete_garmin(athlete, db, days=90)
        print(f"[garmin] {athlete_id}: {updated} days of wellness data synced")
        await recalculate_training_load(athlete_id, db)
        print(f"[garmin] {athlete_id}: training load recalculated")
