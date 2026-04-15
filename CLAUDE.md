# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# First-time setup + launch (Linux/macOS)
./start.sh

# Backend only
cd backend && source .venv/bin/activate
uvicorn main:app --reload --port 8000

# Frontend only
cd frontend && npm run dev   # Vite dev server on :3000

# Lint / type-check
ruff check backend/
mypy backend/
npm run build   # also type-checks frontend
```

## Current state

### Stack
- **Backend**: FastAPI + async SQLAlchemy + aiosqlite (SQLite). No Celery, no Redis, no TimescaleDB — sync is triggered via a REST endpoint (`POST /athlete/{id}/sync`).
- **Frontend**: React + TypeScript + Vite + Recharts + TanStack Query.
- **AI**: Groq API, `llama-3.3-70b-versatile`, free tier. API key in `.env` as `GROQ_API_KEY`. **Not** Anthropic/Claude.
- **Garmin**: `garminconnect` unofficial library (email/password, no Developer Program approval needed). Session tokens cached in `backend/.garmin_tokens/` — never commit this directory.

### Data collected

**Per activity** (`activities` table):
- Core: `sport_type`, `start_time`, `duration_sec`, `distance_m`, `elevation_m`
- HR: `avg_hr`, `max_hr`, `hr_zones` (z1–z5 seconds each)
- Performance: `avg_pace_sec_km`, `normalized_power`, `tss`
- Training effect: `aerobic_effect`, `anaerobic_effect`, `training_effect_label` (BASE/TEMPO/etc.)
- Other: `avg_cadence`, `vo2max_estimated`, `hrv_rmssd`, `sleep_score`, `body_battery`

**Per day** (`daily_metrics` table, one row per athlete per day, ID = `{athlete_id}_{date}`):
- Training load: `ctl`, `atl`, `tsb`, `daily_tss`
- Wellness: `hrv_rmssd`, `resting_hr`, `sleep_hours`, `sleep_score`, `sleep_deep/light/rem/awake_seconds`
- Body battery: `body_battery_high`, `body_battery_low`, `body_battery_wake`
- Other vitals: `steps`, `stress_avg`, `spo2_avg`, `respiration_avg`
- Garmin performance: `training_status`, `endurance_score`, `training_readiness_score`, `training_readiness_description`
- Computed: `readiness_score` (0–100, weighted composite of HRV/sleep/stress/battery)

**Athlete profile** (`athletes` table):
- `threshold_hr`, `max_hr`, `vo2max`, `fitness_age`, `race_predictions` (JSON: 5k/10k/half/marathon seconds)
- `target_ctl`, `goal`, `target_race`
- `ai_summary`, `ai_summary_generated_at` (cached weekly AI debrief)

### What is shown in the frontend

| Page | Shows |
|------|-------|
| Dashboard | Today: recovery metrics + training status badge + readiness + endurance score; PMC (CTL/ATL/TSB + goal line); Performance tiles (race predictions, VO2max, fitness age); rule-based coaching insights; AI weekly debrief (3 cards); CTL/ATL/TSB/TSS glossary |
| Activities | Weekly-grouped list with per-week totals; expandable rows: training effect badges (0–5 color scale), cadence, max HR, elevation, VO2max estimate, HR zone breakdown (minutes + %) |
| Wellness | Today: all recovery metrics + sleep stage bar + both readiness scores + training status + endurance score; Readiness chart (computed vs. Garmin); Sleep stages stacked bar (60 days); Body battery area; HRV + 7-day avg; Resting HR; Steps; Stress; SpO₂ + respiration; Endurance score area; HR zone distribution (12 weeks) |
| Settings | Garmin connect/disconnect; Sync Now; Training profile (threshold HR, max HR, target CTL, goal, target race) |

### Key architecture decisions

**TSS sources** (in priority order):
1. `activityTrainingLoad` from Garmin (direct)
2. HR-based: `calculate_tss_from_hr(duration, avg_hr, threshold_hr)` — `(avg_hr/threshold_hr)² × duration / 3600 × 100`
3. Power-based: `calculate_tss_from_power` exists in `services/metrics.py` but is **not yet wired** — add by checking `activity.normalized_power` before falling back to HR in `sync.py`.

**Training load model**: CTL = 42-day EMA of daily TSS; ATL = 7-day EMA; TSB = CTL − ATL. Computed in `services/metrics.py:calculate_training_load` and written to `daily_metrics` by `services/sync.py:recalculate_training_load`.

**Garmin sync flow**: one shared client per full sync (single login/token load), passed through `sync_garmin_activities` → `sync_athlete_garmin`. Token cached to disk; `_with_retry` handles 429s with 30s/60s/120s backoff. `fetch_daily_extras` does 4 API calls per day (training status, endurance score, sleep data, training readiness) — for 30-day ranges that is ~120 calls total.

**DB migrations**: No Alembic. New columns require `ALTER TABLE ... ADD COLUMN ...` run manually against `backend/training_app.db`. Always add a migration block alongside model changes.

**AI weekly debrief**: cached 7 days in `athletes.ai_summary`. `POST /recommendations/weekly-summary?force=true` bypasses cache. Output is structured JSON with `week_summary`, `training_recommendation`, `recovery_insight` sections. Multi-strategy fallback parser in `services/recommendations.py:_extract_json` handles non-compliant LLM output.

**Frontend type safety**: `WellnessPoint` in `frontend/src/hooks/useWellness.ts` and `MetricsSummary` in `frontend/src/api/client.ts` must stay in sync with the backend `/metrics/wellness` and `/metrics/summary` responses. These drift silently — check both when adding fields.

## Roadmap

The following features are planned but not yet implemented. Work on them in this priority order unless instructed otherwise.

### 1. Detailed activity view with GPS + intraday charts

**Goal**: Clicking an activity opens a full detail page (or expanded panel) with:
- **Map**: render the GPS track from the FIT/GPX file (leaflet.js or similar)
- **Intraday charts**: pace, HR, elevation, cadence, and power (if available) plotted over distance or time
- **Km/mile splits table**: pace, HR, elevation gain per split
- **Lap data**: if the watch recorded laps

**Implementation notes**:
- Garmin FIT files can be downloaded via `client.download_activity(activity_id, dl_fmt=DownloadFormat.ORIGINAL)` — returns a ZIP containing the `.fit` file
- Parse FIT files with the `fitparse` Python library (`pip install fitparse`)
- Store GPS track as a JSON array of `{lat, lon, ele, time, hr, pace, cadence}` points, or as a separate `activity_laps` table
- The `raw_data` column on `Activity` already stores the summary; GPS data needs a new storage strategy given size (~1–5 MB per activity FIT file)
- Consider storing GPS tracks in a separate `activity_tracks` table with `(activity_id, points JSON)` rather than bloating the main activities table
- Add a `GET /activities/{id}/track` endpoint
- Frontend: use Leaflet (lightweight) for the map; Recharts for the intraday charts; these should lazy-load since most list views don't need them

### 2. AI Coach chat tab

**Goal**: A dedicated chat interface where the athlete can ask free-form questions and get data-grounded answers from an AI coach.

**Examples of supported queries**:
- "How was my training load this week compared to last week?"
- "Why am I feeling tired? What does my HRV trend say?"
- "Should I run tomorrow given today's readiness score?"
- "What's my best 5k time and when was it?" (needs personal records)
- "Plan my next 7 days given my CTL of 65 and an upcoming race in 3 weeks"

**Implementation notes**:
- New page: `frontend/src/pages/Coach.tsx` with a chat UI (message list + input box)
- New backend router: `routers/coach.py` with `POST /coach/chat`
- Request body: `{ athlete_id, message, history: [{role, content}] }` — pass conversation history so the model has context
- The backend fetches relevant data from the DB before calling the LLM:
  - Last 14 days of `daily_metrics` (HRV, readiness, TSB, sleep, etc.)
  - Last 30 days of activities (sport, distance, TSS, training effect)
  - Athlete profile (threshold HR, VO2max, race predictions, target CTL, goal)
  - Current CTL/ATL/TSB from latest `daily_metrics`
- All fetched data is serialised into a system prompt: "You are a personal endurance coach. Here is the athlete's data: ..."
- Use Groq (`llama-3.3-70b-versatile`) with streaming response if possible, otherwise standard completion
- For action-taking (e.g., "plan my week"): the model returns a structured JSON block that the frontend can render as a training plan table — do not write to the DB without explicit user confirmation
- Rate-limit to avoid burning free-tier quota: max 20 messages per athlete per day

### 3. Performance trends page

**Goal**: A dedicated page showing how key performance metrics have evolved over months.

**Charts to include**:
- VO2max estimated (per-activity estimates + athlete profile value) over time — is fitness improving?
- Cadence trend (running spm) — is form improving?
- Training effect distribution (pie/bar: how much BASE vs TEMPO vs THRESHOLD work over last 90 days)
- Personal records by distance (5k, 10k, half, marathon) — best efforts from activity data
- Race prediction trend (5k/10k predictions from Garmin over time, if synced periodically)
- Weekly training volume (km and hours) as a bar chart, last 52 weeks

**Implementation notes**:
- Most data is already in the DB; this page is primarily a frontend task
- VO2max estimated: query activities where `vo2max_estimated IS NOT NULL`, plot by `start_time`
- PRs: query for minimum `avg_pace_sec_km` per `sport_type` grouped by distance bucket — or add a `personal_records` table populated during sync from `get_personal_record()`
- Race prediction trend requires storing race predictions per-day rather than only keeping the latest on the athlete profile — add a `race_predictions` column to `daily_metrics` or a separate `race_prediction_history` table

### 4. Garmin data gaps to fill

Fields available from Garmin that we don't yet collect:

| Data | Garmin method | Where to store |
|------|--------------|----------------|
| FIT/GPS track | `download_activity` | `activity_tracks` table |
| Km splits | `get_activity_splits` | `activity_splits` table or JSON on Activity |
| Personal records | `get_personal_record` | `athletes.personal_records` JSON or separate table |
| Body composition (weight, body fat %) | `get_body_composition` | `daily_metrics` or `athletes` |
| Intensity minutes (moderate + vigorous) | `get_intensity_minutes_data` | `daily_metrics` |
| Power-based TSS | already have `normalized_power` | wire `calculate_tss_from_power` in `sync.py` |
| FTP (cycling) | `get_cycling_ftp` | `athletes.ftp` |
| Race prediction history | `get_race_predictions` (already called) | store per-day instead of overwriting |

### 5. Multi-user foundations (non-breaking, low priority)

The app is currently single-user but the DB schema already has `athlete_id` on every table. When multi-user becomes relevant:
- Add authentication (JWT or session-based) — currently anyone can access any athlete_id
- Add a user → athlete mapping table
- The Garmin password is encrypted at rest (`services/crypto.py`) — this is already correct
- Rate-limit the AI endpoints per-user not just per-athlete

## Environment variables

```
DATABASE_URL=sqlite+aiosqlite:///./training_app.db
SECRET_KEY=<random 32-char hex>
GROQ_API_KEY=<from console.groq.com/keys>
STRAVA_CLIENT_ID=      # optional, only for Strava OAuth
STRAVA_CLIENT_SECRET=  # optional
FRONTEND_URL=http://localhost:3000
```
