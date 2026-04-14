# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Backend

```bash
# Create venv (first time only)
cd backend && python3 -m venv .venv

# Activate
source backend/.venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run the API server (dev mode with reload)
uvicorn main:app --reload --port 8000

# Run Celery worker (in a separate terminal)
celery -A tasks.sync_tasks worker --loglevel=info

# Run Celery beat scheduler (periodic tasks)
celery -A tasks.sync_tasks beat --loglevel=info

# Lint
ruff check backend/

# Type check
mypy backend/
```

### Frontend

```bash
cd frontend

npm install
npm run dev        # start Vite dev server on :3000
npm run build      # type-check + production build
```

### Docker (full stack)

```bash
cp .env.example .env   # fill in credentials first
docker compose up      # starts TimescaleDB, Redis, backend, Celery worker+beat, frontend
```

## Architecture

### Data flow

1. **OAuth** — athlete connects Strava at `GET /auth/strava/login`. After the callback, a `sync_athlete_task` Celery job is queued immediately for the initial sync.
2. **Sync** — `services/sync.py:sync_athlete_strava` pulls incremental Strava activities (using `after` timestamp), normalizes them via `integrations/strava.py:normalize_activity`, calculates HR-based TSS, and upserts into `activities`.
3. **Metrics** — `services/sync.py:recalculate_training_load` runs a raw SQL aggregate over `activities`, feeds the result into `services/metrics.py:calculate_training_load`, and writes per-day CTL/ATL/TSB rows to `daily_metrics`.
4. **Recommendations** — `routers/recommendations.py` reads the last 8 rows of `daily_metrics` and passes them to `services/recommendations.py`. Rule-based insights fire on every request; the AI summary (`/recommendations/weekly-summary`) calls Claude and should be rate-limited to once per athlete per week.

### Key relationships

- `Athlete` (one) → many `Activity` rows (all stored with `athlete_id` prefix `strava_<id>`)
- `Activity.tss` feeds → `DailyMetrics` (aggregated by date, one row per athlete per day)
- `DailyMetrics` feeds → both the frontend PMC chart and the recommendations engine

### Database

- PostgreSQL with TimescaleDB extension. The `activities` table is a **hypertable** partitioned on `start_time`. Run `database.py:setup_timescaledb()` once after the initial `create_tables()`.
- `DailyMetrics` has a unique constraint on `(athlete_id, date)` — upserts must respect this.

### Frontend data layer

All API calls go through `src/api/client.ts` (Axios, baseURL `/api`). Vite proxies `/api` → `localhost:8000` in dev. All server state is managed with `@tanstack/react-query`; hooks live in `src/hooks/`.

### TSS calculation

Two paths exist in `services/metrics.py`:
- `calculate_tss_from_hr` — used when `avg_hr` and `threshold_hr` are both present (most runners)
- `calculate_tss_from_power` — used when `normalized_power` and FTP are available (cyclists with a power meter)

`sync.py` currently only calls the HR path. Add power-based TSS by checking `activity.normalized_power` before falling back to HR.

### Garmin integration

`integrations/garmin.py` is fully defined but requires Garmin Developer Program API approval before it can make real requests. All HRV/sleep enrichment fields on `Activity` and `DailyMetrics` will remain `null` until that approval is in place.

### AI coaching

`services/recommendations.py:generate_weekly_ai_summary` uses `claude-sonnet-4-20250514` with a structured prompt. The `ANTHROPIC_API_KEY` env var must be set. The call is synchronous (Anthropic SDK); wrap in `asyncio.to_thread` if called from an async FastAPI path handler at high concurrency.

## Environment variables

See `.env.example`. The minimum set to get the backend running locally:
- `DATABASE_URL` — must use `postgresql+asyncpg://` scheme for async SQLAlchemy
- `STRAVA_CLIENT_ID` + `STRAVA_CLIENT_SECRET`
- `ANTHROPIC_API_KEY` (only needed for `/recommendations/weekly-summary`)
- `SECRET_KEY` — used for session signing
