import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  Legend, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import type { Activity } from "../api/client";
import { SkeletonChart } from "./Skeleton";

interface Props {
  athleteId: string;
}

const ZONE_COLORS = ["#93c5fd", "#6ee7b7", "#fde68a", "#fca5a5", "#f87171"];
const ZONE_LABELS = ["Z1 Recovery", "Z2 Aerobic", "Z3 Tempo", "Z4 Threshold", "Z5 VO2max"];

function getWeekStart(date: Date): string {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay() + 1); // Monday
  return d.toISOString().slice(0, 10);
}

export function ZoneDistributionChart({ athleteId }: Props) {
  const { data: activities = [], isLoading } = useQuery<Activity[]>({
    queryKey: ["activities-zones", athleteId],
    queryFn: async () => {
      const { data } = await api.get("/activities/", {
        params: { athlete_id: athleteId, limit: 500 },
      });
      return data;
    },
    enabled: Boolean(athleteId),
  });

  if (isLoading) return <SkeletonChart height={280} />;

  // Group by week, sum zone minutes
  const weekMap = new Map<string, Record<string, number>>();
  for (const act of activities) {
    if (!act.hr_zones || !act.start_time) continue;
    const week = getWeekStart(new Date(act.start_time));
    if (!weekMap.has(week)) {
      weekMap.set(week, { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 });
    }
    const entry = weekMap.get(week)!;
    for (const k of ["z1", "z2", "z3", "z4", "z5"]) {
      entry[k] = (entry[k] ?? 0) + (act.hr_zones[k] ?? 0) / 60; // sec → min
    }
  }

  // Only keep last 12 weeks, sorted ascending
  const chartData = Array.from(weekMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-12)
    .map(([week, zones]) => ({
      week: week.slice(5), // "MM-DD"
      ...Object.fromEntries(
        Object.entries(zones).map(([k, v]) => [k, Math.round(v)])
      ),
    }));

  if (!chartData.length) {
    return (
      <p style={{ color: "#9ca3af", fontSize: 14 }}>
        No HR zone data yet — available once Garmin activities are synced.
      </p>
    );
  }

  return (
    <div style={{ width: "100%", height: 280 }}>
      <ResponsiveContainer>
        <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="week" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} unit="m" />
          <Tooltip
            formatter={(v: number, name: string) => {
              const idx = ["z1", "z2", "z3", "z4", "z5"].indexOf(name);
              return [`${v} min`, ZONE_LABELS[idx] ?? name];
            }}
          />
          <Legend
            formatter={(value) => {
              const idx = ["z1", "z2", "z3", "z4", "z5"].indexOf(value);
              return ZONE_LABELS[idx] ?? value;
            }}
            iconSize={10}
            wrapperStyle={{ fontSize: 12 }}
          />
          {["z1", "z2", "z3", "z4", "z5"].map((z, i) => (
            <Bar key={z} dataKey={z} stackId="a" fill={ZONE_COLORS[i]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
