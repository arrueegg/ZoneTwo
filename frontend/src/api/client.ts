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
