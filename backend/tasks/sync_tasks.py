"""
Celery background tasks for periodic data sync.

The worker is started separately from the FastAPI app:
  celery -A tasks.sync_tasks worker --loglevel=info
  celery -A tasks.sync_tasks beat --loglevel=info
"""

import asyncio
from celery import Celery

from config import settings

celery = Celery(
    "zonetwo",
    broker=settings.redis_url,
    backend=settings.redis_url,
)

celery.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
)


def _run_async(coro):
    """Run an async coroutine from a sync Celery task."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@celery.task(bind=True, max_retries=3, default_retry_delay=60)
def sync_athlete_task(self, athlete_id: str) -> dict:
    """
    Incremental sync for a single athlete: Strava + metric recalculation.
    Retries up to 3 times on failure (rate limits, network errors).
    """
    from database import SessionLocal
    from models.athlete import Athlete
    from services.sync import sync_athlete_strava, recalculate_training_load

    async def _run():
        async with SessionLocal() as db:
            athlete = await db.get(Athlete, athlete_id)
            if not athlete:
                return {"error": f"Athlete {athlete_id} not found"}

            new_count = 0
            if athlete.strava_access_token:
                new_count = await sync_athlete_strava(athlete, db)
                print(f"[sync] {athlete_id}: {new_count} new Strava activities")

            await recalculate_training_load(athlete_id, db)
            print(f"[sync] {athlete_id}: training load recalculated")

            return {"new_activities": new_count}

    try:
        return _run_async(_run())
    except Exception as exc:
        raise self.retry(exc=exc)


@celery.task
def sync_all_athletes_task() -> None:
    """Fan out sync tasks to all athletes. Run by celery beat hourly."""
    from database import SessionLocal
    from models.athlete import Athlete
    from sqlalchemy import select

    async def _get_athlete_ids():
        async with SessionLocal() as db:
            result = await db.execute(select(Athlete.id))
            return [row[0] for row in result.fetchall()]

    athlete_ids = _run_async(_get_athlete_ids())
    print(f"[beat] Queuing sync for {len(athlete_ids)} athletes")
    for aid in athlete_ids:
        sync_athlete_task.delay(aid)


# Hourly periodic sync for all athletes
celery.conf.beat_schedule = {
    "sync-all-athletes-hourly": {
        "task": "tasks.sync_tasks.sync_all_athletes_task",
        "schedule": 3600.0,
    },
}
