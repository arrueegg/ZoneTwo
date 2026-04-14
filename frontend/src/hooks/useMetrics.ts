import { useQuery } from "@tanstack/react-query";
import api, { MetricPoint, MetricsSummary } from "../api/client";

export function useTrainingLoad(
  athleteId: string,
  startDate: string,
  endDate: string,
) {
  return useQuery<MetricPoint[]>({
    queryKey: ["training-load", athleteId, startDate, endDate],
    queryFn: async () => {
      const { data } = await api.get("/metrics/training-load", {
        params: { athlete_id: athleteId, start: startDate, end: endDate },
      });
      return data;
    },
    enabled: Boolean(athleteId && startDate && endDate),
  });
}

export function useMetricsSummary(athleteId: string) {
  return useQuery<MetricsSummary>({
    queryKey: ["metrics-summary", athleteId],
    queryFn: async () => {
      const { data } = await api.get("/metrics/summary", {
        params: { athlete_id: athleteId },
      });
      return data;
    },
    enabled: Boolean(athleteId),
  });
}
