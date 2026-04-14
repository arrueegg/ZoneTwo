# ZoneTwo

Training analytics app connecting Strava and Garmin Connect. Shows performance management (CTL/ATL/TSB), wellness trends (HRV, sleep, body battery), readiness scores, anomaly detection, and AI coaching summaries.

## Prerequisites

- Python 3.11+
- Node.js 20+ (via NVM at `/scratch2/Program/nvm/`)

## First-time setup

### 1. Environment file

```bash
cp .env.example .env
```

Fill in `.env`:
- `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` — from [strava.com/settings/api](https://www.strava.com/settings/api)
- `SECRET_KEY` — generate with `python3 -c "import secrets; print(secrets.token_hex(32))"`
- `ANTHROPIC_API_KEY` — only needed for the AI weekly debrief feature
- Leave `DATABASE_URL` as-is for local SQLite

### 2. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3. Frontend

```bash
source /scratch2/Program/nvm/nvm.sh
cd frontend
npm install
```

## Running locally

Open two terminals.

**Terminal 1 — backend:**
```bash
cd backend
source .venv/bin/activate
uvicorn main:app --reload --port 8000
```

**Terminal 2 — frontend:**
```bash
source /scratch2/Program/nvm/nvm.sh
cd frontend
npm run dev
```

App is at **http://localhost:3000**. The frontend proxies `/api` → `http://localhost:8000`.

## Connecting your data

1. Go to **Settings**
2. Connect Garmin (email + password) — this is the primary data source
3. Optionally connect Strava for additional activity data
4. Hit **Sync Now** to pull data; the initial sync takes a minute or two

If you reset the database (delete `backend/training_app.db`), restart the backend and reconnect via Settings → Sync Now.

## Architecture

```
frontend/   React + TypeScript + Vite + Recharts + TanStack Query
backend/    FastAPI + async SQLAlchemy + aiosqlite (SQLite for local dev)
```

### Data flow

1. **Garmin sync** pulls 90 days of activities and 30 days of wellness/HRV
2. **Training load** (CTL/ATL/TSB) is computed from activity TSS values
3. **Readiness score** (0–100) is a weighted composite of HRV, resting HR, sleep, body battery, and stress
4. **Analytics** (anomaly detection, correlations, weekly summaries) run on request
5. **AI debrief** calls Claude with the week's metrics — cached for 7 days

### TSS calculation

- Garmin activities: uses `activityTrainingLoad` directly
- Strava activities: HR-based TSS using your threshold HR (set in Settings → Training Profile)

## Pages

| Page | Description |
|------|-------------|
| Dashboard | Today's snapshot, PMC chart, anomaly flags, AI debrief |
| Activities | Full activity log with HR zones, TSS, pace, elevation |
| Wellness | HRV, sleep, body battery trends + zone distribution |
| Settings | Connect accounts, set threshold HR, target CTL, trigger sync |
