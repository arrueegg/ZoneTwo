import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ReferenceLine, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import type { WellnessPoint } from "../hooks/useWellness";

interface Props {
  data: WellnessPoint[];
}

export function ReadinessChart({ data }: Props) {
  const points = data.filter(
    (d) => d.readiness_score != null || d.training_readiness_score != null,
  );
  if (!points.length) return null;

  const hasGarmin   = points.some((d) => d.training_readiness_score != null);
  const hasComputed = points.some((d) => d.readiness_score != null);

  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer>
        <LineChart data={points} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
          <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
          <Tooltip
            labelFormatter={(v) => v.slice(5)}
            formatter={(v: number, name: string) => [`${v.toFixed(0)}`, name]}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <ReferenceLine y={70} stroke="#22c55e" strokeDasharray="3 3"
            label={{ value: "Good", fontSize: 10, fill: "#22c55e" }} />
          <ReferenceLine y={50} stroke="#f59e0b" strokeDasharray="3 3"
            label={{ value: "Fair", fontSize: 10, fill: "#f59e0b" }} />
          {hasComputed && (
            <Line
              type="monotone"
              dataKey="readiness_score"
              stroke="#6366f1"
              strokeWidth={2}
              dot={false}
              connectNulls
              name="Readiness (computed)"
            />
          )}
          {hasGarmin && (
            <Line
              type="monotone"
              dataKey="training_readiness_score"
              stroke="#0ea5e9"
              strokeWidth={2}
              dot={false}
              connectNulls
              name="Readiness (Garmin)"
              strokeDasharray="5 3"
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
