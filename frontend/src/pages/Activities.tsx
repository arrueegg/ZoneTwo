import { useState } from "react";
import { Link } from "react-router-dom";
import { useActivities } from "../hooks/useActivities";
import { useAthleteContext } from "../main";
import type { Activity } from "../api/client";
import { SkeletonTableRows } from "../components/Skeleton";

// ── formatting helpers ────────────────────────────────────────────────────────

function fmtPace(sec_km: number | null): string {
  if (!sec_km) return "—";
  const min = Math.floor(sec_km / 60);
  const sec = Math.round(sec_km % 60);
  return `${min}:${sec.toString().padStart(2, "0")}/km`;
}

function fmtDist(m: number | null): string {
  if (!m) return "—";
  return `${(m / 1000).toFixed(1)} km`;
}

function fmtDuration(sec: number | null): string {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

// Returns the Monday of the ISO week containing `d`
function weekStart(iso: string): string {
  const d = new Date(iso);
  const day = d.getUTCDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function fmtWeekLabel(monday: string): string {
  const start = new Date(monday + "T00:00:00Z");
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${start.toLocaleDateString("en-GB", opts)} – ${end.toLocaleDateString("en-GB", opts)}`;
}

const SPORT_LABEL: Record<string, string> = {
  run: "Run", trail_run: "Trail", ride: "Ride", virtual_ride: "Virtual",
  swim: "Swim", walk: "Walk", hiking: "Hike", strength: "Strength",
  yoga: "Yoga", multi_sport: "Multi", other: "Other",
};

const SPORT_ICON: Record<string, string> = {
  run: "🏃", trail_run: "🏔", ride: "🚴", virtual_ride: "💻",
  swim: "🏊", walk: "🚶", hiking: "⛰", strength: "🏋",
  yoga: "🧘", multi_sport: "🏅", other: "⚡",
};

// ── HR zones ──────────────────────────────────────────────────────────────────

const ZONE_COLORS = ["#93c5fd", "#6ee7b7", "#fde68a", "#fca5a5", "#f87171"];
const ZONE_LABELS = ["Z1 Warm-Up", "Z2 Endurance", "Z3 Aerobic", "Z4 Threshold", "Z5 VO2max"];
const ZONE_KEYS   = ["z1", "z2", "z3", "z4", "z5"];

function HrZoneBar({ zones }: { zones: Record<string, number> | null }) {
  if (!zones) return <span style={{ color: "#9ca3af" }}>—</span>;
  const total = ZONE_KEYS.reduce((s, k) => s + (zones[k] ?? 0), 0);
  if (!total) return <span style={{ color: "#9ca3af" }}>—</span>;

  return (
    <div style={{ display: "flex", height: 12, width: 80, borderRadius: 4, overflow: "hidden" }}>
      {ZONE_KEYS.map((k, i) => {
        const pct = ((zones[k] ?? 0) / total) * 100;
        return pct > 0 ? (
          <div
            key={k}
            title={`${ZONE_LABELS[i]}: ${Math.round(pct)}%`}
            style={{ width: `${pct}%`, background: ZONE_COLORS[i] }}
          />
        ) : null;
      })}
    </div>
  );
}

function HrZoneBreakdown({ zones }: { zones: Record<string, number> | null }) {
  if (!zones) return null;
  const total = ZONE_KEYS.reduce((s, k) => s + (zones[k] ?? 0), 0);
  if (!total) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8 }}>
      {ZONE_KEYS.map((k, i) => {
        const secs = zones[k] ?? 0;
        if (!secs) return null;
        const pct = (secs / total) * 100;
        const min = Math.floor(secs / 60);
        return (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: ZONE_COLORS[i], flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: "#374151" }}>
              <strong>{ZONE_LABELS[i]}</strong>: {min}m ({Math.round(pct)}%)
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── expanded detail panel ────────────────────────────────────────────────────

const TE_COLOR: Record<number, { bg: string; color: string }> = {
  1: { bg: "#f3f4f6", color: "#6b7280" },
  2: { bg: "#dbeafe", color: "#1d4ed8" },
  3: { bg: "#d1fae5", color: "#065f46" },
  4: { bg: "#fef3c7", color: "#92400e" },
  5: { bg: "#fee2e2", color: "#991b1b" },
};

function TrainingEffectBadge({ label, value, type }: { label: string; value: number; type: "aerobic" | "anaerobic" }) {
  const tier = Math.min(5, Math.max(1, Math.round(value)));
  const { bg, color } = TE_COLOR[tier] ?? TE_COLOR[1];
  const descriptions: Record<number, string> = {
    1: "No benefit", 2: "Minor", 3: "Improving", 4: "Highly improving", 5: "Overreaching",
  };
  return (
    <div title={descriptions[tier]} style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "6px 12px", borderRadius: 8, background: bg, minWidth: 72,
    }}>
      <span style={{ fontSize: 10, color, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>
        {type === "aerobic" ? "Aerobic TE" : "Anaerobic TE"}
      </span>
      <span style={{ fontSize: 18, fontWeight: 700, color, lineHeight: 1.3 }}>{value.toFixed(1)}</span>
      {label && <span style={{ fontSize: 10, color, opacity: 0.8 }}>{label.replace(/_/g, " ")}</span>}
    </div>
  );
}

function ActivityDetail({ activity: a }: { activity: Activity }) {
  const isRunning = ["run", "trail_run", "walk", "hiking"].includes(a.sport_type);
  const isCycling = ["ride", "virtual_ride"].includes(a.sport_type);
  const showTrainingEffect = a.aerobic_effect != null || a.anaerobic_effect != null;

  return (
    <div style={{
      padding: "14px 20px 16px 48px",
      background: "#f8fafc",
      borderBottom: "1px solid #e5e7eb",
    }}>
      {/* Training effect badges */}
      {showTrainingEffect && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {a.aerobic_effect != null && (
            <TrainingEffectBadge label={a.training_effect_label ?? ""} value={a.aerobic_effect} type="aerobic" />
          )}
          {a.anaerobic_effect != null && (
            <TrainingEffectBadge label="" value={a.anaerobic_effect} type="anaerobic" />
          )}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 28px", fontSize: 13, color: "#374151" }}>
        {isRunning && a.avg_pace_sec_km != null && (
          <DetailStat label="Avg Pace" value={fmtPace(a.avg_pace_sec_km)} />
        )}
        {a.max_hr != null && <DetailStat label="Max HR" value={`${Math.round(a.max_hr)} bpm`} />}
        {a.avg_cadence != null && (
          <DetailStat
            label={isCycling ? "Cadence" : "Cadence"}
            value={`${Math.round(a.avg_cadence)} ${isCycling ? "rpm" : "spm"}`}
          />
        )}
        {a.elevation_m != null && <DetailStat label="Elevation" value={`${Math.round(a.elevation_m)} m`} />}
        {a.normalized_power != null && <DetailStat label="NP" value={`${Math.round(a.normalized_power)} W`} />}
        {a.vo2max_estimated != null && <DetailStat label="VO₂max est." value={a.vo2max_estimated.toFixed(1)} />}
        {a.hrv_rmssd != null && <DetailStat label="HRV (post)" value={`${Math.round(a.hrv_rmssd)} ms`} />}
        {a.body_battery != null && <DetailStat label="Body Battery" value={`${Math.round(a.body_battery)}`} />}
      </div>
      <HrZoneBreakdown zones={a.hr_zones} />
    </div>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span style={{ color: "#9ca3af", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label} </span>
      <strong>{value}</strong>
    </div>
  );
}

// ── weekly summary bar ────────────────────────────────────────────────────────

function WeeklySummary({ activities }: { activities: Activity[] }) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const recent = activities.filter((a) => (a.start_time ?? "") >= sevenDaysAgo);

  const totalTSS = recent.reduce((s, a) => s + (a.tss ?? 0), 0);
  const totalDist = recent.reduce((s, a) => s + (a.distance_m ?? 0), 0);
  const totalTime = recent.reduce((s, a) => s + (a.duration_sec ?? 0), 0);
  const count = recent.length;

  if (!count) return null;

  return (
    <div style={{
      display: "flex", gap: 32, padding: "14px 20px", background: "#f9fafb",
      borderRadius: 8, marginBottom: 24, fontSize: 14, flexWrap: "wrap",
    }}>
      <BarStat label="This week" value={`${count} activit${count === 1 ? "y" : "ies"}`} />
      {totalDist > 0 && <BarStat label="Distance" value={`${(totalDist / 1000).toFixed(1)} km`} />}
      <BarStat label="Time" value={fmtDuration(totalTime)} />
      {totalTSS > 0 && <BarStat label="TSS" value={totalTSS.toFixed(0)} />}
    </div>
  );
}

function BarStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontWeight: 700, color: "#111", marginTop: 2 }}>{value}</div>
    </div>
  );
}

// ── week group ────────────────────────────────────────────────────────────────

function WeekGroup({
  monday, activities, expandedId, onToggle,
}: {
  monday: string;
  activities: Activity[];
  expandedId: string | null;
  onToggle: (id: string) => void;
}) {
  const totalDist = activities.reduce((s, a) => s + (a.distance_m ?? 0), 0);
  const totalTime = activities.reduce((s, a) => s + (a.duration_sec ?? 0), 0);
  const totalTSS  = activities.reduce((s, a) => s + (a.tss ?? 0), 0);

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Week header */}
      <div style={{
        display: "flex", alignItems: "baseline", gap: 16,
        padding: "8px 0 6px", borderBottom: "2px solid #e5e7eb", marginBottom: 2,
      }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: "#111" }}>{fmtWeekLabel(monday)}</span>
        <span style={{ fontSize: 12, color: "#9ca3af" }}>
          {activities.length} activit{activities.length === 1 ? "y" : "ies"}
          {totalDist > 0 ? ` · ${(totalDist / 1000).toFixed(1)} km` : ""}
          {totalTime > 0 ? ` · ${fmtDuration(totalTime)}` : ""}
          {totalTSS  > 0 ? ` · ${totalTSS.toFixed(0)} TSS` : ""}
        </span>
      </div>

      {/* Activity rows */}
      {activities.map((a) => (
        <div key={a.id}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "110px 110px 80px 60px 60px 80px 90px 60px 50px 24px 28px",
              alignItems: "center",
              padding: "9px 0",
              borderBottom: "1px solid #f3f4f6",
              fontSize: 13,
              background: expandedId === a.id ? "#f0f9ff" : "transparent",
              transition: "background 0.1s",
            }}
          >
            <span style={{ color: "#374151", cursor: "pointer" }} onClick={() => onToggle(a.id)}>{fmtDate(a.start_time)}</span>
            <span style={{ cursor: "pointer" }} onClick={() => onToggle(a.id)}>
              <span style={{ marginRight: 4 }}>{SPORT_ICON[a.sport_type] ?? "⚡"}</span>
              {SPORT_LABEL[a.sport_type] ?? a.sport_type}
            </span>
            <span style={{ cursor: "pointer" }} onClick={() => onToggle(a.id)}>{fmtDist(a.distance_m)}</span>
            <span style={{ cursor: "pointer" }} onClick={() => onToggle(a.id)}>{fmtDuration(a.duration_sec)}</span>
            <span style={{ cursor: "pointer" }} onClick={() => onToggle(a.id)}>{a.avg_hr != null ? `${Math.round(a.avg_hr)} bpm` : "—"}</span>
            <span style={{ cursor: "pointer" }} onClick={() => onToggle(a.id)}>
              {["run", "trail_run", "walk", "hiking"].includes(a.sport_type)
                ? fmtPace(a.avg_pace_sec_km)
                : "—"}
            </span>
            <div style={{ display: "flex", alignItems: "center", cursor: "pointer" }} onClick={() => onToggle(a.id)}>
              <HrZoneBar zones={a.hr_zones} />
            </div>
            <span style={{ cursor: "pointer" }} onClick={() => onToggle(a.id)}>{a.elevation_m != null ? `${Math.round(a.elevation_m)}m` : "—"}</span>
            <span style={{ cursor: "pointer", fontWeight: a.tss != null ? 600 : 400, color: a.tss != null ? "#374151" : "#9ca3af" }} onClick={() => onToggle(a.id)}>
              {a.tss != null ? a.tss.toFixed(0) : "—"}
            </span>
            <span style={{ color: "#9ca3af", fontSize: 11, userSelect: "none", cursor: "pointer" }} onClick={() => onToggle(a.id)}>
              {expandedId === a.id ? "▲" : "▼"}
            </span>
            <Link
              to={`/activities/${a.id}`}
              title="View full detail"
              onClick={(e) => e.stopPropagation()}
              style={{ color: "#9ca3af", fontSize: 14, textDecoration: "none", display: "flex", alignItems: "center" }}
            >
              ↗
            </Link>
          </div>

          {expandedId === a.id && <ActivityDetail activity={a} />}
        </div>
      ))}
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

const ALL_SPORTS = ["run", "trail_run", "ride", "virtual_ride", "swim", "walk", "hiking", "strength", "other"];

export function Activities() {
  const { athleteId } = useAthleteContext();
  const [sportFilter, setSportFilter] = useState<string>("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: activities = [], isLoading } = useActivities({
    athleteId: athleteId ?? "",
    sportType: sportFilter || undefined,
    limit: 200,
  });

  function toggleExpanded(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  if (!athleteId) {
    return (
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "48px 16px", fontFamily: "sans-serif", textAlign: "center" }}>
        <p style={{ color: "#6b7280" }}>Connect your account in <a href="/settings">Settings</a> to see activities.</p>
      </div>
    );
  }

  // Group activities by ISO week (most recent first)
  const weekMap = new Map<string, Activity[]>();
  for (const a of activities) {
    if (!a.start_time) continue;
    const key = weekStart(a.start_time);
    if (!weekMap.has(key)) weekMap.set(key, []);
    weekMap.get(key)!.push(a);
  }
  const sortedWeeks = Array.from(weekMap.entries()).sort(([a], [b]) => b.localeCompare(a));

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px", fontFamily: "sans-serif" }}>
      <h1 style={{ marginBottom: 4 }}>Activities</h1>
      <p style={{ color: "#6b7280", marginBottom: 20 }}>Last 200 activities · click a row to expand</p>

      {/* Sport filter */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <FilterChip label="All" active={!sportFilter} onClick={() => setSportFilter("")} />
        {ALL_SPORTS.filter((s) => activities.some((a) => a.sport_type === s)).map((s) => (
          <FilterChip
            key={s}
            label={`${SPORT_ICON[s] ?? ""} ${SPORT_LABEL[s] ?? s}`}
            active={sportFilter === s}
            onClick={() => setSportFilter(sportFilter === s ? "" : s)}
          />
        ))}
      </div>

      {/* This-week summary bar */}
      <WeeklySummary activities={activities} />

      {/* Column header */}
      {(isLoading || activities.length > 0) && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "110px 110px 80px 60px 60px 80px 90px 60px 50px 24px 28px",
          padding: "0 0 6px",
          fontSize: 11, fontWeight: 600, color: "#9ca3af",
          textTransform: "uppercase", letterSpacing: "0.04em",
          borderBottom: "1px solid #e5e7eb", marginBottom: 4,
        }}>
          <span>Date</span>
          <span>Type</span>
          <span>Distance</span>
          <span>Time</span>
          <span>Avg HR</span>
          <span>Pace</span>
          <span>HR Zones</span>
          <span>Elev.</span>
          <span>TSS</span>
          <span />
          <span />
        </div>
      )}

      {isLoading && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody><SkeletonTableRows rows={8} cols={9} /></tbody>
        </table>
      )}

      {!isLoading && activities.length === 0 && (
        <p style={{ color: "#9ca3af", fontSize: 14 }}>
          No activities yet. Trigger a sync from <a href="/settings">Settings</a>.
        </p>
      )}

      {!isLoading && sortedWeeks.map(([monday, weekActivities]) => (
        <WeekGroup
          key={monday}
          monday={monday}
          activities={weekActivities}
          expandedId={expandedId}
          onToggle={toggleExpanded}
        />
      ))}
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "4px 12px", borderRadius: 999, fontSize: 12, cursor: "pointer",
        border: active ? "1px solid #3B8BD4" : "1px solid #e5e7eb",
        background: active ? "#eff6ff" : "#fff",
        color: active ? "#3B8BD4" : "#6b7280",
        fontWeight: active ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
}
