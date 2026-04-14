import { useQuery } from "@tanstack/react-query";
import api, { Activity } from "../api/client";

interface UseActivitiesParams {
  athleteId: string;
  start?: string;
  end?: string;
  sportType?: string;
  limit?: number;
}

export function useActivities({
  athleteId,
  start,
  end,
  sportType,
  limit = 50,
}: UseActivitiesParams) {
  return useQuery<Activity[]>({
    queryKey: ["activities", athleteId, start, end, sportType, limit],
    queryFn: async () => {
      const { data } = await api.get("/activities/", {
        params: {
          athlete_id: athleteId,
          start,
          end,
          sport_type: sportType,
          limit,
        },
      });
      return data;
    },
    enabled: Boolean(athleteId),
  });
}
