import type { WeekSummary } from "../hooks/useAnalysis";
import { HelpTerm } from "./Help";

interface Props {
  weeks: WeekSummary[];
}

const METRICS: { key: string; label: string; fmt: (v: number) => string }[] = [
  { key: "readiness_score", label: "Readiness",    fmt: (v) => v.toFixed(0) },
  { key: "hrv_rmssd",       label: "HRV (ms)",     fmt: (v) => v.toFixed(0) },
  { key: "resting_hr",      label: "Resting HR",   fmt: (v) => `${v.toFixed(0)} bpm` },
  { key: "sleep_hours",     label: "Sleep",        fmt: (v) => `${v.toFixed(1)} h` },
  { key: "body_battery_wake", label: "Battery",    fmt: (v) => v.toFixed(0) },
  { key: "stress_avg",      label: "Stress",       fmt: (v) => v.toFixed(0) },
  { key: "steps",           label: "Steps",        fmt: (v) => Math.round(v).toLocaleString() },
];

const TREND_COLOR: Record<string, string> = {
  "↑": "#22c55e",
  "↓": "#ef4444",
  "→": "#9ca3af",
  "—": "#d1d5db",
};

export function WeeklySummaryTable({ weeks }: Props) {
  if (!weeks.length) return null;
  const recent = weeks.slice(-8);

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            <th style={TH_LABEL}>Metric</th>
            {recent.map((w) => (
              <th key={w.week_start} style={TH}>
                {w.week_start.slice(5)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {METRICS.map(({ key, label, fmt }) => (
            <tr key={key} style={{ borderBottom: "1px solid #f3f4f6" }}>
              <td style={{ ...TD, color: "#6b7280", fontWeight: 500 }}><HelpTerm>{label}</HelpTerm></td>
              {recent.map((w) => {
                const val = w.averages[key];
                const trend = w.trends[key] ?? "—";
                return (
                  <td key={w.week_start} style={{ ...TD, textAlign: "right" }}>
                    {val != null ? fmt(val) : "—"}
                    {" "}
                    <span style={{ color: TREND_COLOR[trend] ?? "#9ca3af", fontWeight: 700 }}>
                      {trend}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TH_LABEL: React.CSSProperties = {
  padding: "6px 10px", textAlign: "left", color: "#6b7280",
  fontWeight: 600, fontSize: 11, whiteSpace: "nowrap",
  borderBottom: "2px solid #e5e7eb",
};
const TH: React.CSSProperties = {
  padding: "6px 10px", textAlign: "right", color: "#6b7280",
  fontWeight: 600, fontSize: 11, whiteSpace: "nowrap",
  borderBottom: "2px solid #e5e7eb",
};
const TD: React.CSSProperties = { padding: "7px 10px" };
