import { useQuery } from "@tanstack/react-query";
import api from "../api/client";

export interface Anomaly {
  metric: string;
  label: string;
  value: number;
  mean: number;
  z_score: number;
  direction: string;
  message: string;
}

export interface WeekSummary {
  week_start: string;
  week_end: string;
  averages: Record<string, number | null>;
  trends: Record<string, string>;
}

export interface Correlation {
  label: string;
  x_metric: string;
  y_metric: string;
  lag_days: number;
  r: number;
  n: number;
  interpretation: string;
}

export interface Analysis {
  anomalies: Anomaly[];
  weekly_summary: WeekSummary[];
  correlations: Correlation[];
}

export function useAnalysis(athleteId: string) {
  return useQuery<Analysis>({
    queryKey: ["analysis", athleteId],
    queryFn: async () => {
      const { data } = await api.get("/metrics/analysis", {
        params: { athlete_id: athleteId },
      });
      return data;
    },
    enabled: Boolean(athleteId),
    staleTime: 5 * 60_000, // re-fetch at most every 5 min
  });
}
