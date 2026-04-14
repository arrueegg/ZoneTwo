import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ReferenceLine, ResponsiveContainer, CartesianGrid,
} from "recharts";
import type { WellnessPoint } from "../hooks/useWellness";

interface Props {
  data: WellnessPoint[];
}

function readinessColor(score: number): string {
  if (score >= 70) return "#22c55e";
  if (score >= 50) return "#f59e0b";
  return "#ef4444";
}

function ReadinessDot(props: { cx?: number; cy?: number; payload?: WellnessPoint }) {
  const { cx, cy, payload } = props;
  if (!payload?.readiness_score || cx == null || cy == null) return null;
  return <circle cx={cx} cy={cy} r={3} fill={readinessColor(payload.readiness_score)} stroke="none" />;
}

export function ReadinessChart({ data }: Props) {
  const withScore = data.filter((d) => d.readiness_score != null);
  if (!withScore.length) return null;

  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer>
        <AreaChart data={withScore} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="readinessGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
          <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
          <Tooltip
            formatter={(v: number) => [`${v}`, "Readiness"]}
            labelFormatter={(v) => v.slice(5)}
          />
          <ReferenceLine y={70} stroke="#22c55e" strokeDasharray="3 3" label={{ value: "Good", fontSize: 10, fill: "#22c55e" }} />
          <ReferenceLine y={50} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: "Fair", fontSize: 10, fill: "#f59e0b" }} />
          <Area
            type="monotone"
            dataKey="readiness_score"
            stroke="#6366f1"
            fill="url(#readinessGrad)"
            strokeWidth={2}
            dot={<ReadinessDot />}
            connectNulls
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
