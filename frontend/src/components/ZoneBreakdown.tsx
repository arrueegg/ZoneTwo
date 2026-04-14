import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  ResponsiveContainer,
} from "recharts";

interface ZoneData {
  zone: string;
  minutes: number;
}

interface Props {
  hrZones: Record<string, number> | null; // seconds per zone
}

const ZONE_COLORS = ["#6EE7B7", "#3B82F6", "#F59E0B", "#EF4444", "#7C3AED"];
const ZONE_LABELS: Record<string, string> = {
  z1: "Easy",
  z2: "Aerobic",
  z3: "Tempo",
  z4: "Threshold",
  z5: "VO2max",
};

export function ZoneBreakdown({ hrZones }: Props) {
  if (!hrZones) {
    return <p style={{ color: "#888" }}>No zone data available</p>;
  }

  const data: ZoneData[] = Object.entries(hrZones).map(([zone, seconds]) => ({
    zone: ZONE_LABELS[zone] ?? zone,
    minutes: Math.round(seconds / 60),
  }));

  return (
    <div style={{ width: "100%", height: 200 }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 60, right: 16 }}>
          <XAxis type="number" unit=" min" tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="zone" tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v: number) => [`${v} min`]} />
          <Bar dataKey="minutes" radius={[0, 3, 3, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={ZONE_COLORS[i % ZONE_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
