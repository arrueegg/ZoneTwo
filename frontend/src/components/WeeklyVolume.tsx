import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

export interface WeekSummary {
  week: string;          // e.g. "2024-W22"
  distance_km: number;
  elevation_m: number;
  duration_hours: number;
}

interface Props {
  weeks: WeekSummary[];
}

export function WeeklyVolume({ weeks }: Props) {
  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer>
        <BarChart data={weeks} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <XAxis dataKey="week" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend />
          <Bar dataKey="distance_km" fill="#3B8BD4" name="Distance (km)" radius={[3, 3, 0, 0]} />
          <Bar dataKey="elevation_m" fill="#1D9E75" name="Elevation (m)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
