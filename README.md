# ZoneTwo

Training analytics app connecting Strava and Garmin Connect. Shows performance management (CTL/ATL/TSB), recovery trends (HRV, sleep, body battery), readiness scores, anomaly detection, and AI coaching summaries.

## Prerequisites

- Python 3.11+
- Node.js 18+

## Quick start

```bash
git clone https://github.com/arrueegg/ZoneTwo.git
cd ZoneTwo
./start.sh
```

On first run the script will:
1. Copy `.env.example` → `.env` and exit, asking you to fill in credentials
2. On the next run: create the Python venv, install all dependencies, and launch both servers

**Minimum `.env` values to fill in:**
- `SECRET_KEY` — any random string, e.g. `python3 -c "import secrets; print(secrets.token_hex(32))"`
- `GROQ_API_KEY` — free at [console.groq.com/keys](https://console.groq.com/keys) (needed for the AI debrief)
- Leave `DATABASE_URL` as-is for local SQLite
- `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` only needed if connecting Strava

App is at **http://localhost:3000** once both servers are running. Stop with `Ctrl-C`.

## Manual setup (optional)

If you prefer separate terminals:

```bash
# Backend
cd backend && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend && npm install && npm run dev
```

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
| Recovery | HRV, sleep, body battery trends + zone distribution |
| Settings | Connect accounts, set threshold HR, target CTL, trigger sync |
