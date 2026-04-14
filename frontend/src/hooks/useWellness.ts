import { useQuery } from "@tanstack/react-query";
import api from "../api/client";

export interface WellnessPoint {
  date: string;
  hrv_rmssd: number | null;
  resting_hr: number | null;
  sleep_hours: number | null;
  body_battery_high: number | null;
  body_battery_low: number | null;
  body_battery_wake: number | null;
  steps: number | null;
  stress_avg: number | null;
  spo2_avg: number | null;
  respiration_avg: number | null;
}

export function useWellness(athleteId: string, startDate: string, endDate: string) {
  return useQuery<WellnessPoint[]>({
    queryKey: ["wellness", athleteId, startDate, endDate],
    queryFn: async () => {
      const { data } = await api.get("/metrics/wellness", {
        params: { athlete_id: athleteId, start: startDate, end: endDate },
      });
      return data;
    },
    enabled: Boolean(athleteId && startDate && endDate),
  });
}
