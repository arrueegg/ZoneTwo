import axios from "axios";

const api = axios.create({
  baseURL: "/api",
  headers: { "Content-Type": "application/json" },
});

export default api;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MetricPoint {
  date: string;
  ctl: number;
  atl: number;
  tsb: number;
  daily_tss: number;
}

export interface Activity {
  id: string;
  athlete_id: string;
  source: string;
  sport_type: string;
  start_time: string;
  duration_sec: number | null;
  distance_m: number | null;
  elevation_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  hr_zones: Record<string, number> | null;
  avg_pace_sec_km: number | null;
  normalized_power: number | null;
  tss: number | null;
  aerobic_effect: number | null;
  anaerobic_effect: number | null;
  training_effect_label: string | null;
  avg_cadence: number | null;
  vo2max_estimated: number | null;
  hrv_rmssd: number | null;
  sleep_score: number | null;
  body_battery: number | null;
}

export interface TrackPoint {
  lat: number;
  lon: number;
  ele?: number;
  time?: string;
  hr?: number;
  cadence?: number;
  pace_sec_km?: number;
}

export interface Split {
  distance_m?: number;
  duration_sec?: number;
  avg_hr?: number;
  avg_pace_sec_km?: number;
  elevation_gain_m?: number;
  avg_cadence?: number;
}

export interface ActivityTrack {
  points: TrackPoint[];
  splits: Split[];
}

export interface TrainingEvent {
  id: string;
  athlete_id: string;
  name: string;
  event_date: string;
  event_type: string;
  target_distance_km: number | null;
  target_time_sec: number | null;
  priority: "A" | "B" | "C";
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface PreparationWorkout {
  type: string;
  day: string;
  distance_km: number;
  title: string;
  description: string;
}

export interface PreparationWeek {
  week: number;
  starts_on: string;
  focus: string;
  target_km: number;
  long_run_km: number;
  workouts: PreparationWorkout[];
  adjustment_note: string;
}

export interface PreparationPlan {
  event: TrainingEvent;
  context: {
    days_to_event: number;
    weeks_to_event: number;
    target_distance_km: number | null;
    target_time_sec: number | null;
    target_pace_sec_km: number | null;
    recent_weekly_km: number;
    recent_weekly_hours: number;
    recent_runs_per_week: number;
    recent_long_run_km: number;
    ctl: number | null;
    atl: number | null;
    tsb: number | null;
    readiness_score: number | null;
    sleep_score: number | null;
    stress_avg: number | null;
    target_ctl: number | null;
    threshold_hr: number | null;
  };
  options: {
    days_per_week: number;
    max_weekly_km: number | null;
    long_run_day: string;
    emphasis: string;
  };
  summary: {
    headline: string;
    current_load: string;
    target: string;
    risk_flags: string[];
  };
  weeks: PreparationWeek[];
}

export interface SeasonRecommendation {
  severity: "low" | "medium" | "high";
  title: string;
  body: string;
}

export interface SeasonPlanWeek extends PreparationWeek {
  primary_event_id: string;
  primary_event_name: string;
  supporting_events: string[];
}

export interface SeasonPlan {
  events: TrainingEvent[];
  recommendations: SeasonRecommendation[];
  weeks: SeasonPlanWeek[];
}

export interface PlannedWorkout {
  id: string;
  event_id: string;
  athlete_id: string;
  week: number;
  planned_date: string;
  workout_type: string;
  title: string;
  description: string | null;
  distance_km: number | null;
  status: "planned" | "accepted" | "completed" | "skipped" | "moved";
  notes: string | null;
  sort_order: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface Insight {
  type: "warning" | "positive" | "info";
  title: string;
  body: string;
  priority: "high" | "medium" | "low";
}

export interface MetricsSummary {
  date: string;
  ctl: number | null;
  atl: number | null;
  tsb: number | null;
  daily_tss: number | null;
  hrv_rmssd: number | null;
  resting_hr: number | null;
  sleep_hours: number | null;
  sleep_score: number | null;
  sleep_deep_seconds: number | null;
  sleep_light_seconds: number | null;
  sleep_rem_seconds: number | null;
  sleep_awake_seconds: number | null;
  body_battery_high: number | null;
  body_battery_low: number | null;
  body_battery_wake: number | null;
  stress_avg: number | null;
  spo2_avg: number | null;
  respiration_avg: number | null;
  readiness_score: number | null;
  training_readiness_score: number | null;
  training_readiness_description: string | null;
  training_status: string | null;
  endurance_score: number | null;
}
