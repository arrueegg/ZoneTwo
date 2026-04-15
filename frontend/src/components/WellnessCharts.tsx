import {
  LineChart, Line, BarChart, Bar, ComposedChart, AreaChart, Area,
  XAxis, YAxis, Tooltip, Legend, ReferenceLine,
  ResponsiveContainer, CartesianGrid,
} from "recharts";
import type { WellnessPoint } from "../hooks/useWellness";

interface Props {
  data: WellnessPoint[];
}

const tick = { fontSize: 11 };
const fmt = (v: string) => v.slice(5); // show MM-DD

// Rolling N-day average over a nullable series
function rollingAvg(data: WellnessPoint[], key: keyof WellnessPoint, n: number): (number | null)[] {
  return data.map((_, i) => {
    const window = data.slice(Math.max(0, i - n + 1), i + 1);
    const vals = window.map((d) => d[key] as number | null).filter((v): v is number => v != null);
    return vals.length > 0 ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
  });
}

export function WellnessCharts({ data }: Props) {
  if (!data.length) return null;

  // Enrich data with 7-day rolling averages
  const hrv7 = rollingAvg(data, "hrv_rmssd", 7);
  const enriched = data.map((d, i) => ({ ...d, hrv_7d_avg: hrv7[i] }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
      <ChartCard title="HRV (nightly avg)">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={enriched} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={tick} tickFormatter={fmt} />
            <YAxis tick={tick} unit=" ms" />
            <Tooltip formatter={(v: number) => [`${v} ms`]} labelFormatter={fmt} />
            <Legend />
            <Line type="monotone" dataKey="hrv_rmssd" stroke="#6366f1" name="HRV" dot={false} strokeWidth={1.5} connectNulls />
            <Line type="monotone" dataKey="hrv_7d_avg" stroke="#a5b4fc" name="7-day avg" dot={false} strokeWidth={2} strokeDasharray="4 2" connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Resting Heart Rate">
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={tick} tickFormatter={fmt} />
            <YAxis tick={tick} unit=" bpm" domain={["auto", "auto"]} />
            <Tooltip formatter={(v: number) => [`${v} bpm`]} labelFormatter={fmt} />
            <Line type="monotone" dataKey="resting_hr" stroke="#e8593c" name="Resting HR" dot={false} strokeWidth={2} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Sleep duration & score">
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={data} margin={{ top: 4, right: 40, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={tick} tickFormatter={fmt} />
            <YAxis yAxisId="h" tick={tick} unit="h" domain={[0, 12]} />
            <YAxis yAxisId="score" orientation="right" tick={tick} domain={[0, 100]}
              label={{ value: "score", angle: 90, position: "insideRight", fontSize: 10, fill: "#9ca3af" }} />
            <Tooltip
              formatter={(v: number, name: string) =>
                name === "Score" ? [`${v.toFixed(0)}`, name] : [`${v.toFixed(1)} h`, name]
              }
              labelFormatter={fmt}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine yAxisId="h" y={8} stroke="#9ca3af" strokeDasharray="3 3"
              label={{ value: "8h", fontSize: 10, fill: "#9ca3af" }} />
            <Bar yAxisId="h" dataKey="sleep_hours" fill="#3b82f6" name="Hours" radius={[2, 2, 0, 0]} />
            <Line yAxisId="score" type="monotone" dataKey="sleep_score" stroke="#f59e0b"
              name="Score" dot={false} strokeWidth={2} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Body Battery">
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={tick} tickFormatter={fmt} />
            <YAxis tick={tick} domain={[0, 100]} />
            <Tooltip labelFormatter={fmt} />
            <Legend />
            <Area type="monotone" dataKey="body_battery_high" stroke="#22c55e" fill="#bbf7d0" name="High" strokeWidth={1.5} connectNulls />
            <Area type="monotone" dataKey="body_battery_wake" stroke="#3b82f6" fill="#bfdbfe" name="At wake" strokeWidth={1.5} connectNulls />
            <Area type="monotone" dataKey="body_battery_low" stroke="#f97316" fill="#fed7aa" name="Low" strokeWidth={1.5} connectNulls />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Steps">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={tick} tickFormatter={fmt} />
            <YAxis tick={tick} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: number) => [v.toLocaleString()]} labelFormatter={fmt} />
            <Bar dataKey="steps" fill="#8b5cf6" name="Steps" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Stress">
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={tick} tickFormatter={fmt} />
            <YAxis tick={tick} domain={[0, 100]} />
            <Tooltip formatter={(v: number) => [`${v}`]} labelFormatter={fmt} />
            <ReferenceLine y={50} stroke="#9ca3af" strokeDasharray="3 3" />
            <Area type="monotone" dataKey="stress_avg" stroke="#f59e0b" fill="#fef3c7" name="Avg stress" strokeWidth={2} connectNulls />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      {data.some((d) => d.endurance_score != null) && (
        <ChartCard title="Endurance score">
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="enduranceGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={tick} tickFormatter={fmt} />
              <YAxis tick={tick} domain={["auto", "auto"]} />
              <Tooltip formatter={(v: number) => [`${Math.round(v)}`]} labelFormatter={fmt} />
              <Area type="monotone" dataKey="endurance_score" stroke="#10b981" fill="url(#enduranceGrad)"
                name="Endurance score" strokeWidth={2} dot={false} connectNulls />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      <ChartCard title="SpO₂ & Respiration">
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={tick} tickFormatter={fmt} />
            <YAxis yAxisId="spo2" tick={tick} domain={[90, 100]} unit="%" />
            <YAxis yAxisId="resp" orientation="right" tick={tick} unit=" br/m" />
            <Tooltip labelFormatter={fmt} />
            <Legend />
            <Line yAxisId="spo2" type="monotone" dataKey="spo2_avg" stroke="#06b6d4" name="SpO₂" dot={false} strokeWidth={2} connectNulls />
            <Line yAxisId="resp" type="monotone" dataKey="respiration_avg" stroke="#84cc16" name="Respiration" dot={false} strokeWidth={2} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 8 }}>{title}</h3>
      {children}
    </div>
  );
}
