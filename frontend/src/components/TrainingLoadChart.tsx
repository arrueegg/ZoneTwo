import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { MetricPoint } from "../api/client";

interface Props {
  data: MetricPoint[];
  targetCtl?: number | null;
}

export function TrainingLoadChart({ data }: Props) {
  return (
    <div style={{ width: "100%", height: 300 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => v.slice(5)} // show MM-DD
          />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip
            formatter={(value: number, name: string) => [value.toFixed(1), name]}
          />
          <Legend />
          {/* Form=0 baseline */}
          <ReferenceLine y={0} stroke="#aaa" strokeDasharray="3 3" />
          <Line
            type="monotone"
            dataKey="ctl"
            stroke="#3B8BD4"
            name="Fitness (CTL)"
            dot={false}
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="atl"
            stroke="#E8593C"
            name="Fatigue (ATL)"
            dot={false}
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="tsb"
            stroke="#1D9E75"
            name="Form (TSB)"
            dot={false}
            strokeWidth={2}
            strokeDasharray="4 2"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
