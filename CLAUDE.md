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

**Preparation targets** (`training_events` table):
- User-defined upcoming events and target runs/races.
- Core fields: `name`, `event_date`, `event_type`, `target_distance_km`, `target_time_sec`, `priority`, `notes`
- Used by the Preparation page to build one aligned, editable season plan.

**Planned workouts** (`planned_workouts` table):
- Persisted future workouts created from an edited season plan and then editable by the user.
- Core fields: `event_id`, `planned_date`, `week`, `workout_type`, `title`, `description`, `distance_km`, `status`, `notes`
- Status values: `planned`, `accepted`, `completed`, `skipped`, `moved`

### What is shown in the frontend

| Page | Shows |
|------|-------|
| Dashboard | Today: recovery metrics + training status badge + readiness + endurance score; PMC (CTL/ATL/TSB + goal line); Performance tiles (race predictions, VO2max, fitness age); rule-based coaching insights; AI weekly debrief (3 cards); CTL/ATL/TSB/TSS glossary |
| Activities | Weekly-grouped list with per-week totals; expandable rows: training effect badges (0–5 color scale), cadence, max HR, elevation, VO2max estimate, HR zone breakdown (minutes + %); `↗` link on each row opens full detail page |
| Activity Detail | `/activities/:id` — stat tiles, training effect tile, GPS map (Leaflet/OpenStreetMap), elevation/HR/pace/cadence intraday charts (vs distance), splits table. Track downloaded on-demand from Garmin GPX and cached in `activity_tracks` table. |
| Preparation | Season-level target planning only: add/delete upcoming events, generate one aligned plan per week across all targets, edit proposed weekly workouts directly, save the edited season into future planned workouts, and discuss/apply changes to the whole season plan. |
| Recovery | Today: all recovery metrics + sleep stage bar + both readiness scores + training status + endurance score; Readiness chart (computed vs. Garmin); Sleep stages stacked bar (60 days); Body battery area; HRV + 7-day avg; Resting HR; Steps; Stress; SpO₂ + respiration; Endurance score area; HR zone distribution (12 weeks). Route remains `/wellness`; user-facing label is Recovery. |
| Coach | Chat interface with data-grounded AI coach (Groq/Llama 3). Context window: last 14 days of wellness + 30 days of activities + full athlete profile. Rate-limited to 20 messages/day. Quick-start suggestion chips on empty state. |
| Settings | Garmin connect/disconnect; Sync Now; Training profile (threshold HR, max HR, target CTL, goal, target race) |

### Key architecture decisions

**Frontend shell**: The app uses a left-side navigation rail in `frontend/src/main.tsx`, with page content rendered to the right. Keep primary navigation there instead of reintroducing a small top-row menu.

**TSS sources** (in priority order):
1. `activityTrainingLoad` from Garmin (direct)
2. HR-based: `calculate_tss_from_hr(duration, avg_hr, threshold_hr)` — `(avg_hr/threshold_hr)² × duration / 3600 × 100`
3. Power-based: `calculate_tss_from_power` exists in `services/metrics.py` but is **not yet wired** — add by checking `activity.normalized_power` before falling back to HR in `sync.py`.

**Training load model**: CTL = 42-day EMA of daily TSS; ATL = 7-day EMA; TSB = CTL − ATL. Computed in `services/metrics.py:calculate_training_load` and written to `daily_metrics` by `services/sync.py:recalculate_training_load`.

**Garmin sync flow**: one shared client per full sync (single login/token load), passed through `sync_garmin_activities` → `sync_athlete_garmin`. Token cached to disk; `_with_retry` handles 429s with 30s/60s/120s backoff. `fetch_daily_extras` does 4 API calls per day (training status, endurance score, sleep data, training readiness) — for 30-day ranges that is ~120 calls total.

**DB migrations**: No Alembic. New columns require `ALTER TABLE ... ADD COLUMN ...` run manually against `backend/training_app.db`. Always add a migration block alongside model changes.

**AI weekly debrief**: cached 7 days in `athletes.ai_summary`. `POST /recommendations/weekly-summary?force=true` bypasses cache. Output is structured JSON with `week_summary`, `training_recommendation`, `recovery_insight` sections. Multi-strategy fallback parser in `services/recommendations.py:_extract_json` handles non-compliant LLM output.

**AI coach chat**: `POST /coach/chat` — body `{athlete_id, message, history}`. `services/coach.py:build_system_prompt` fetches 14 days of daily metrics + 30 days of activities + athlete profile and serialises to a text block for the system prompt. In-memory rate limiter (20 msg/day per athlete, resets on server restart). History capped to last 10 turns before sending to Groq.

**Activity track (GPS)**: `GET /activities/{id}/track` downloads a GPX from Garmin on first request, parses HR/cadence from TrackPointExtension namespace using `gpxpy`, derives pace from consecutive point distances, fetches splits via `get_activity_splits`, and caches everything in the `activity_tracks` table. The download only runs for `garmin_*` activity IDs. Frontend lazy-loads Leaflet to avoid bundle bloat.

**Frontend type safety**: `WellnessPoint` in `frontend/src/hooks/useWellness.ts` and `MetricsSummary` in `frontend/src/api/client.ts` must stay in sync with the backend `/metrics/wellness` and `/metrics/summary` responses. These drift silently — check both when adding fields.

**Preparation planning**: The frontend should use season-level planning as the only planning interaction. `GET /preparation/season-plan` returns the aligned proposal, and `POST /preparation/season-workouts/save` persists the edited proposal to `planned_workouts`. Legacy selected-event endpoints still exist for compatibility, but do not expose them as a competing planning workflow. Persist event intent and user decisions; derive recommendations from current data.

**Season alignment**: Preparation has a single source of truth: the season plan. When multiple upcoming events overlap, the app must still produce only one training plan per week. `GET /preparation/season-plan` builds an aligned season view by selecting one primary event for each week and listing nearby supporting events. It flags conflicting target schedules such as A/B races too close together, too many priority targets in six weeks, or events with very different demands in the same block. `POST /preparation/season-workouts/save` persists the edited season proposal into future `planned_workouts`; `replace=true` replaces future planned workouts, not historical/completed entries. The Preparation frontend should not expose separate single-event plan or calendar workspaces. It has Events for target list/add/delete only, Season Plan for editing the proposed weekly workouts directly, and Coach for discussing the entire season plan and applying plan-setting changes back to the proposal.

**Preparation workout editing**: Season Plan workout rows use controlled run-type choices (easy, recovery, long, steady, tempo, interval, hill, race pace, progression, strides, strength, rest), color-coded by type. Distances in the editable proposal are rounded to 0.5 km increments.

**Coach context and preparation**: The AI Coach prompt includes upcoming preparation targets and saved upcoming planned workouts, so coach answers can account for target events plus accepted/completed/skipped workouts.

## Roadmap

Work on items in priority order unless instructed otherwise.

### ✅ 1. Detailed activity view with GPS + intraday charts — DONE

`/activities/:id` page with GPS map, elevation/HR/pace/cadence charts, splits table. Backend caches GPX track in `activity_tracks` table. Activity rows in the list have an `↗` link.

### ✅ 2. AI Coach chat tab — DONE

`/coach` page with chat UI. `POST /coach/chat` fetches 14-day wellness + 30-day activities + athlete profile and builds a Groq system prompt. In-memory rate limiter (20 msg/day). Quick-start suggestions on empty state.

### ✅ 3. Preparation goals + adaptive event planning — INITIAL SLICE DONE

**Goal**: Users can add upcoming events/races/runs they are training for and maintain one adaptive season plan across those targets.

**Implemented scope**:
- `training_events` table for user-created upcoming targets.
- `/preparation/events` CRUD endpoints.
- `/preparation/events/{event_id}/plan` rule-based adaptive plan endpoint with user-adjustable planning controls.
- `/preparation/events/{event_id}/discuss` plan discussion endpoint.
- `/preparation/events/{event_id}/workouts` + `/preparation/workouts/{workout_id}` endpoints for persistent planned workouts.
- Frontend Preparation page with Events target management, editable aligned weekly workout proposal in Season Plan, season-save action, and whole-season coach discussion.
- Coach prompt includes upcoming targets and saved planned workouts.

**Planning inputs**:
- Event date, type, priority, target distance, target time.
- Recent activities, especially run volume and frequency over 28 days.
- Latest CTL/ATL/TSB/readiness/sleep/stress where available.
- Athlete profile fields such as threshold HR and target CTL.
- User constraints: run days per week, max weekly km, preferred long-run day, training emphasis.

**Next improvements**:
- Improve matching completed Garmin activities back to planned workouts automatically.
- Upgrade plan discussion from rule-based replies to the existing Groq coach when the API key is available.
- Add notifications for upcoming saved workouts.
- Add plan recalculation history so users can see what changed after sync.

### 4. Performance trends page

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

### 5. Garmin data gaps to fill

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

### 6. Multi-user foundations (non-breaking, low priority)

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
