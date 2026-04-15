import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  Legend, ResponsiveContainer, CartesianGrid,
} from "recharts";

interface WellnessDay {
  date: string;
  sleep_hours: number | null;
  sleep_score: number | null;
  sleep_deep_seconds: number | null;
  sleep_light_seconds: number | null;
  sleep_rem_seconds: number | null;
  sleep_awake_seconds: number | null;
}

interface Props {
  data: WellnessDay[];
}

const STAGE_COLORS = {
  deep:  "#4f46e5",  // indigo — most restorative
  rem:   "#7c3aed",  // purple — memory consolidation
  light: "#a5b4fc",  // light indigo — transition sleep
  awake: "#e5e7eb",  // grey — time awake in window
};

function secsToHours(s: number | null): number | null {
  return s != null ? Math.round((s / 3600) * 10) / 10 : null;
}

export function SleepChart({ data }: Props) {
  // Only include days that have sleep stage data
  const points = data
    .filter((d) => d.sleep_deep_seconds != null || d.sleep_rem_seconds != null || d.sleep_light_seconds != null)
    .slice(-60)
    .map((d) => ({
      date: d.date.slice(5),   // MM-DD
      deep:  secsToHours(d.sleep_deep_seconds),
      rem:   secsToHours(d.sleep_rem_seconds),
      light: secsToHours(d.sleep_light_seconds),
      awake: secsToHours(d.sleep_awake_seconds),
      score: d.sleep_score,
    }));

  if (!points.length) return null;

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap="20%">
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: "#9ca3af" }}
          tickLine={false}
          interval={Math.floor(points.length / 10)}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#9ca3af" }}
          tickLine={false}
          axisLine={false}
          unit="h"
          width={28}
        />
        <Tooltip
          formatter={(value: number, name: string) => [`${value}h`, name.charAt(0).toUpperCase() + name.slice(1)]}
          contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #e5e7eb" }}
        />
        <Legend
          wrapperStyle={{ fontSize: 12 }}
          formatter={(value) => value.charAt(0).toUpperCase() + value.slice(1)}
        />
        <Bar dataKey="deep"  stackId="sleep" fill={STAGE_COLORS.deep}  name="deep"  radius={[0, 0, 0, 0]} />
        <Bar dataKey="rem"   stackId="sleep" fill={STAGE_COLORS.rem}   name="rem" />
        <Bar dataKey="light" stackId="sleep" fill={STAGE_COLORS.light} name="light" />
        <Bar dataKey="awake" stackId="sleep" fill={STAGE_COLORS.awake} name="awake" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// Single-day sleep stage breakdown (used in Today card)
export function SleepStageBreakdown({ summary }: {
  summary: {
    sleep_score: number | null;
    sleep_deep_seconds: number | null;
    sleep_light_seconds: number | null;
    sleep_rem_seconds: number | null;
    sleep_awake_seconds: number | null;
  }
}) {
  const stages = [
    { key: "deep",  label: "Deep",  secs: summary.sleep_deep_seconds,  color: STAGE_COLORS.deep },
    { key: "rem",   label: "REM",   secs: summary.sleep_rem_seconds,   color: STAGE_COLORS.rem },
    { key: "light", label: "Light", secs: summary.sleep_light_seconds, color: STAGE_COLORS.light },
    { key: "awake", label: "Awake", secs: summary.sleep_awake_seconds, color: STAGE_COLORS.awake },
  ];

  const total = stages.reduce((s, st) => s + (st.secs ?? 0), 0);
  if (!total) return null;

  const fmtMins = (s: number | null) => {
    if (!s) return "—";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <div>
      {/* Score */}
      {summary.sleep_score != null && (
        <div style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "#6b7280" }}>Sleep score</span>
          <SleepScoreBadge score={summary.sleep_score} />
        </div>
      )}

      {/* Stage bar */}
      <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", marginBottom: 10 }}>
        {stages.map((st) => {
          const pct = ((st.secs ?? 0) / total) * 100;
          return pct > 0 ? (
            <div key={st.key} style={{ width: `${pct}%`, background: st.color }} />
          ) : null;
        })}
      </div>

      {/* Stage labels */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px" }}>
        {stages.map((st) => st.secs != null && st.secs > 0 ? (
          <div key={st.key} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
            <div style={{ width: 9, height: 9, borderRadius: 2, background: st.color, flexShrink: 0 }} />
            <span style={{ color: "#374151" }}>
              <strong>{st.label}</strong> {fmtMins(st.secs)}
            </span>
          </div>
        ) : null)}
      </div>
    </div>
  );
}

function SleepScoreBadge({ score }: { score: number }) {
  const color = score >= 80 ? "#065f46" : score >= 60 ? "#92400e" : "#7f1d1d";
  const bg    = score >= 80 ? "#d1fae5" : score >= 60 ? "#fef3c7" : "#fee2e2";
  return (
    <span style={{ padding: "2px 10px", borderRadius: 999, background: bg, color, fontWeight: 700, fontSize: 14 }}>
      {score.toFixed(0)}
    </span>
  );
}
