import { useState } from "react";
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
  return `${(m / 1000).toFixed(2)} km`;
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
  return iso.slice(0, 10);
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

// ── HR zones mini-bar ─────────────────────────────────────────────────────────

const ZONE_COLORS = ["#93c5fd", "#6ee7b7", "#fde68a", "#fca5a5", "#f87171"];

function HrZoneBar({ zones }: { zones: Record<string, number> | null }) {
  if (!zones) return <span style={{ color: "#9ca3af" }}>—</span>;
  const keys = ["z1", "z2", "z3", "z4", "z5"];
  const total = keys.reduce((s, k) => s + (zones[k] ?? 0), 0);
  if (!total) return <span style={{ color: "#9ca3af" }}>—</span>;

  return (
    <div style={{ display: "flex", height: 12, width: 80, borderRadius: 4, overflow: "hidden" }}>
      {keys.map((k, i) => {
        const pct = ((zones[k] ?? 0) / total) * 100;
        return pct > 0 ? (
          <div
            key={k}
            title={`Z${i + 1}: ${Math.round(pct)}%`}
            style={{ width: `${pct}%`, background: ZONE_COLORS[i] }}
          />
        ) : null;
      })}
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
      <Stat label="This week" value={`${count} activit${count === 1 ? "y" : "ies"}`} />
      {totalDist > 0 && <Stat label="Distance" value={`${(totalDist / 1000).toFixed(1)} km`} />}
      <Stat label="Time" value={fmtDuration(totalTime)} />
      {totalTSS > 0 && <Stat label="TSS" value={totalTSS.toFixed(0)} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontWeight: 700, color: "#111", marginTop: 2 }}>{value}</div>
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

const ALL_SPORTS = ["run", "trail_run", "ride", "virtual_ride", "swim", "walk", "hiking", "strength", "other"];

export function Activities() {
  const { athleteId } = useAthleteContext();
  const [sportFilter, setSportFilter] = useState<string>("");

  const { data: activities = [], isLoading } = useActivities({
    athleteId: athleteId ?? "",
    sportType: sportFilter || undefined,
    limit: 200,
  });

  if (!athleteId) {
    return (
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "48px 16px", fontFamily: "sans-serif", textAlign: "center" }}>
        <p style={{ color: "#6b7280" }}>Connect your account in <a href="/settings">Settings</a> to see activities.</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px", fontFamily: "sans-serif" }}>
      <h1 style={{ marginBottom: 4 }}>Activities</h1>
      <p style={{ color: "#6b7280", marginBottom: 20 }}>Last 200 activities</p>

      {/* Filter bar */}
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

      {/* Weekly summary */}
      <WeeklySummary activities={activities} />

      {!isLoading && activities.length === 0 && (
        <p style={{ color: "#9ca3af", fontSize: 14 }}>
          No activities yet. Trigger a sync from <a href="/settings">Settings</a>.
        </p>
      )}

      {(isLoading || activities.length > 0) && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                <th style={TH}>Date</th>
                <th style={TH}>Type</th>
                <th style={TH}>Distance</th>
                <th style={TH}>Time</th>
                <th style={TH}>Avg HR</th>
                <th style={TH}>Pace</th>
                <th style={{ ...TH, minWidth: 90 }}>HR Zones</th>
                <th style={TH}>Elev.</th>
                <th style={TH}>TSS</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <SkeletonTableRows rows={8} cols={9} />
              ) : activities.map((a) => (
                <tr key={a.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={TD}>{fmtDate(a.start_time)}</td>
                  <td style={TD}>
                    <span style={{ marginRight: 4 }}>{SPORT_ICON[a.sport_type] ?? "⚡"}</span>
                    {SPORT_LABEL[a.sport_type] ?? a.sport_type}
                  </td>
                  <td style={TD}>{fmtDist(a.distance_m)}</td>
                  <td style={TD}>{fmtDuration(a.duration_sec)}</td>
                  <td style={TD}>{a.avg_hr != null ? `${Math.round(a.avg_hr)}` : "—"}</td>
                  <td style={TD}>{["run", "trail_run", "walk", "hiking"].includes(a.sport_type) ? fmtPace(a.avg_pace_sec_km) : "—"}</td>
                  <td style={{ ...TD, verticalAlign: "middle" }}>
                    <HrZoneBar zones={a.hr_zones} />
                  </td>
                  <td style={TD}>{a.elevation_m != null ? `${Math.round(a.elevation_m)}m` : "—"}</td>
                  <td style={{ ...TD, fontWeight: a.tss != null ? 600 : 400, color: a.tss != null ? "#374151" : "#9ca3af" }}>
                    {a.tss != null ? a.tss.toFixed(0) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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

const TH: React.CSSProperties = {
  padding: "6px 10px", textAlign: "left", color: "#6b7280",
  fontWeight: 600, fontSize: 11, whiteSpace: "nowrap",
};
const TD: React.CSSProperties = { padding: "8px 10px", whiteSpace: "nowrap" };
