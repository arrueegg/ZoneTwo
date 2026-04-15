import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import api from "../api/client";
import type { Activity, ActivityTrack, TrackPoint } from "../api/client";

// Leaflet CSS must be loaded globally — injected once here
function injectLeafletCss() {
  if (document.getElementById("leaflet-css")) return;
  const link = document.createElement("link");
  link.id = "leaflet-css";
  link.rel = "stylesheet";
  link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  document.head.appendChild(link);
}

// ── formatting helpers ────────────────────────────────────────────────────────

function fmtPace(sec_km: number | null | undefined): string {
  if (!sec_km) return "—";
  const min = Math.floor(sec_km / 60);
  const sec = Math.round(sec_km % 60);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function fmtDuration(sec: number | null | undefined): string {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

function fmtDist(m: number | null | undefined): string {
  if (!m) return "—";
  return `${(m / 1000).toFixed(1)} km`;
}

// ── GPS map component (lazy-loads Leaflet) ────────────────────────────────────

function GpsMap({ points }: { points: TrackPoint[] }) {
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    injectLeafletCss();
    import("leaflet").then((L) => {
      const container = document.getElementById("activity-map") as HTMLDivElement;
      if (!container || (container as any)._leaflet_id) return;

      const lats = points.map((p) => p.lat);
      const lons = points.map((p) => p.lon);
      const minLat = Math.min(...lats), maxLat = Math.max(...lats);
      const minLon = Math.min(...lons), maxLon = Math.max(...lons);

      const map = L.map(container).fitBounds([
        [minLat, minLon],
        [maxLat, maxLon],
      ]);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      const latLons = points.map((p) => [p.lat, p.lon] as [number, number]);
      L.polyline(latLons, { color: "#3b82f6", weight: 3, opacity: 0.85 }).addTo(map);

      // Start / end markers
      if (latLons.length > 0) {
        const greenDot = L.circleMarker(latLons[0], { radius: 6, color: "#16a34a", fillColor: "#16a34a", fillOpacity: 1 });
        const redDot   = L.circleMarker(latLons[latLons.length - 1], { radius: 6, color: "#dc2626", fillColor: "#dc2626", fillOpacity: 1 });
        greenDot.addTo(map).bindTooltip("Start");
        redDot.addTo(map).bindTooltip("Finish");
      }

      setMapReady(true);
    });
  }, [points]);

  return (
    <div id="activity-map" style={{ height: 360, borderRadius: 10, border: "1px solid #e5e7eb", background: "#f0f4f8" }}>
      {!mapReady && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#9ca3af", fontSize: 14 }}>
          Loading map…
        </div>
      )}
    </div>
  );
}

// ── intraday charts ───────────────────────────────────────────────────────────

function buildChartData(points: TrackPoint[]) {
  // Downsample to ~500 points for performance
  const step = Math.max(1, Math.floor(points.length / 500));
  const sampled = points.filter((_, i) => i % step === 0);

  // Compute cumulative distance from lat/lon
  let cumDist = 0;
  return sampled.map((p, i) => {
    if (i > 0) {
      const prev = sampled[i - 1];
      const dlat = (p.lat - prev.lat) * 111320;
      const dlon = (p.lon - prev.lon) * 111320 * Math.cos(prev.lat * Math.PI / 180);
      cumDist += Math.sqrt(dlat * dlat + dlon * dlon);
    }
    return {
      dist: Math.round(cumDist / 100) / 10,   // km, 1 decimal
      hr: p.hr ?? null,
      ele: p.ele ?? null,
      pace: p.pace_sec_km ?? null,
      cadence: p.cadence ?? null,
    };
  });
}

const tick = { fontSize: 11, fill: "#9ca3af" };

function IntradayCharts({ points }: { points: TrackPoint[] }) {
  const data = buildChartData(points);
  const hasHr      = data.some((d) => d.hr != null);
  const hasEle     = data.some((d) => d.ele != null);
  const hasPace    = data.some((d) => d.pace != null);
  const hasCadence = data.some((d) => d.cadence != null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {hasEle && (
        <ChartCard title="Elevation">
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="eleGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#a78bfa" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="dist" tick={tick} unit=" km" />
              <YAxis tick={tick} unit=" m" width={40} />
              <Tooltip formatter={(v: number) => [`${v.toFixed(0)} m`, "Elevation"]} labelFormatter={(v) => `${v} km`} />
              <Area dataKey="ele" stroke="#7c3aed" fill="url(#eleGrad)" strokeWidth={1.5} dot={false} connectNulls name="Elevation" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {hasHr && (
        <ChartCard title="Heart Rate">
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="dist" tick={tick} unit=" km" />
              <YAxis tick={tick} unit=" bpm" domain={["auto", "auto"]} width={44} />
              <Tooltip formatter={(v: number) => [`${v} bpm`, "HR"]} labelFormatter={(v) => `${v} km`} />
              <Line dataKey="hr" stroke="#ef4444" strokeWidth={1.5} dot={false} connectNulls name="HR" />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {hasPace && (
        <ChartCard title="Pace">
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="dist" tick={tick} unit=" km" />
              <YAxis
                tick={tick}
                reversed
                domain={["auto", "auto"]}
                width={44}
                tickFormatter={(v) => fmtPace(v)}
              />
              <Tooltip
                formatter={(v: number) => [fmtPace(v), "Pace"]}
                labelFormatter={(v) => `${v} km`}
              />
              <Line dataKey="pace" stroke="#3b82f6" strokeWidth={1.5} dot={false} connectNulls name="Pace" />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {hasCadence && (
        <ChartCard title="Cadence">
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="dist" tick={tick} unit=" km" />
              <YAxis tick={tick} unit=" spm" domain={["auto", "auto"]} width={44} />
              <Tooltip formatter={(v: number) => [`${v} spm`, "Cadence"]} labelFormatter={(v) => `${v} km`} />
              <Line dataKey="cadence" stroke="#f59e0b" strokeWidth={1.5} dot={false} connectNulls name="Cadence" />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      )}
    </div>
  );
}

// ── splits table ──────────────────────────────────────────────────────────────

function SplitsTable({ splits }: { splits: ActivityTrack["splits"] }) {
  if (!splits.length) return null;

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
            {["Split", "Distance", "Time", "Pace", "Avg HR", "Elev. +", "Cadence"].map((h) => (
              <th key={h} style={{ padding: "6px 10px", textAlign: "left", color: "#6b7280", fontWeight: 600, fontSize: 11, whiteSpace: "nowrap" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {splits.map((s, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #f3f4f6", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
              <td style={TD}>{i + 1}</td>
              <td style={TD}>{fmtDist(s.distance_m)}</td>
              <td style={TD}>{fmtDuration(s.duration_sec)}</td>
              <td style={{ ...TD, fontWeight: 600 }}>{fmtPace(s.avg_pace_sec_km)}</td>
              <td style={TD}>{s.avg_hr != null ? `${Math.round(s.avg_hr)} bpm` : "—"}</td>
              <td style={TD}>{s.elevation_gain_m != null ? `${Math.round(s.elevation_gain_m)} m` : "—"}</td>
              <td style={TD}>{s.avg_cadence != null ? `${Math.round(s.avg_cadence)} spm` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TD: React.CSSProperties = { padding: "8px 10px", whiteSpace: "nowrap" };

// ── stat tiles ────────────────────────────────────────────────────────────────

function StatRow({ activity: a }: { activity: Activity }) {
  const isRun = ["run", "trail_run", "walk", "hiking"].includes(a.sport_type);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 24 }}>
      {a.distance_m != null     && <Tile label="Distance"   value={fmtDist(a.distance_m)} />}
      {a.duration_sec != null   && <Tile label="Time"       value={fmtDuration(a.duration_sec)} />}
      {a.avg_hr != null         && <Tile label="Avg HR"     value={`${Math.round(a.avg_hr)} bpm`} />}
      {a.max_hr != null         && <Tile label="Max HR"     value={`${Math.round(a.max_hr)} bpm`} />}
      {isRun && a.avg_pace_sec_km != null && <Tile label="Avg Pace" value={`${fmtPace(a.avg_pace_sec_km)}/km`} />}
      {a.elevation_m != null    && <Tile label="Elevation"  value={`${Math.round(a.elevation_m)} m`} />}
      {a.avg_cadence != null    && <Tile label="Cadence"    value={`${Math.round(a.avg_cadence)} spm`} />}
      {a.tss != null            && <Tile label="TSS"        value={a.tss.toFixed(0)} bold />}
      {a.normalized_power != null && <Tile label="NP"       value={`${Math.round(a.normalized_power)} W`} />}
      {a.vo2max_estimated != null && <Tile label="VO₂max est." value={a.vo2max_estimated.toFixed(1)} />}
    </div>
  );
}

function Tile({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 16px", minWidth: 90, textAlign: "center" }}>
      <div style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: bold ? 700 : 600, color: "#111" }}>{value}</div>
    </div>
  );
}

function TrainingEffectTile({ aerobic, anaerobic, label }: { aerobic?: number | null; anaerobic?: number | null; label?: string | null }) {
  if (aerobic == null && anaerobic == null) return null;
  const tier = Math.round(aerobic ?? 0);
  const colors: Record<number, { bg: string; color: string }> = {
    1: { bg: "#f3f4f6", color: "#6b7280" },
    2: { bg: "#dbeafe", color: "#1d4ed8" },
    3: { bg: "#d1fae5", color: "#065f46" },
    4: { bg: "#fef3c7", color: "#92400e" },
    5: { bg: "#fee2e2", color: "#991b1b" },
  };
  const { bg, color } = colors[Math.min(5, Math.max(1, tier))];
  return (
    <div style={{ background: bg, border: "1px solid transparent", borderRadius: 8, padding: "10px 16px", minWidth: 110, textAlign: "center" }}>
      <div style={{ fontSize: 10, color, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2, fontWeight: 600 }}>Training Effect</div>
      {aerobic != null && <div style={{ fontSize: 13, color }}><strong>Aerobic</strong> {aerobic.toFixed(1)}</div>}
      {anaerobic != null && <div style={{ fontSize: 13, color }}><strong>Anaerobic</strong> {anaerobic.toFixed(1)}</div>}
      {label && <div style={{ fontSize: 11, color, marginTop: 2, opacity: 0.8 }}>{label.replace(/_/g, " ")}</div>}
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 8 }}>{title}</h3>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: "#111" }}>{title}</h2>
      {children}
    </div>
  );
}

const SPORT_ICON: Record<string, string> = {
  run: "🏃", trail_run: "🏔", ride: "🚴", virtual_ride: "💻",
  swim: "🏊", walk: "🚶", hiking: "⛰", strength: "🏋",
};

export function ActivityDetail() {
  const { activityId } = useParams<{ activityId: string }>();

  const { data: activity, isLoading: actLoading } = useQuery<Activity>({
    queryKey: ["activity", activityId],
    queryFn: async () => {
      const { data } = await api.get(`/activities/${activityId}`);
      return data;
    },
    enabled: Boolean(activityId),
  });

  const { data: track, isLoading: trackLoading, error: trackError } = useQuery<ActivityTrack>({
    queryKey: ["activity-track", activityId],
    queryFn: async () => {
      const { data } = await api.get(`/activities/${activityId}/track`);
      return data;
    },
    enabled: Boolean(activityId),
    retry: false, // Don't retry 404s — activity may not have GPS data
  });

  if (actLoading) {
    return <div style={{ padding: 48, textAlign: "center", color: "#9ca3af" }}>Loading…</div>;
  }
  if (!activity) {
    return <div style={{ padding: 48, textAlign: "center", color: "#9ca3af" }}>Activity not found.</div>;
  }

  const dateStr = activity.start_time
    ? new Date(activity.start_time).toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
    : "";

  const hasGps = track && track.points.some((p) => p.lat != null);

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px", fontFamily: "sans-serif" }}>
      {/* Back link */}
      <Link to="/activities" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none" }}>
        ← Activities
      </Link>

      {/* Header */}
      <div style={{ marginTop: 12, marginBottom: 24 }}>
        <h1 style={{ marginBottom: 4, fontSize: 22 }}>
          {SPORT_ICON[activity.sport_type] ?? "⚡"}{" "}
          {activity.sport_type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
        </h1>
        <p style={{ color: "#6b7280", margin: 0 }}>{dateStr}</p>
      </div>

      {/* Stats */}
      <StatRow activity={activity} />
      <TrainingEffectTile aerobic={activity.aerobic_effect} anaerobic={activity.anaerobic_effect} label={activity.training_effect_label} />

      {/* GPS Map */}
      {trackLoading && (
        <Section title="Map">
          <div style={{ height: 360, borderRadius: 10, background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af" }}>
            Downloading GPS track…
          </div>
        </Section>
      )}
      {hasGps && (
        <Section title="Map">
          <GpsMap points={track.points} />
        </Section>
      )}
      {!trackLoading && !hasGps && !trackError && (
        <p style={{ color: "#9ca3af", fontSize: 13, marginBottom: 24 }}>No GPS data available for this activity.</p>
      )}

      {/* Intraday charts */}
      {hasGps && track.points.length > 10 && (
        <Section title="Activity breakdown">
          <IntradayCharts points={track.points} />
        </Section>
      )}

      {/* Splits */}
      {track && track.splits.length > 0 && (
        <Section title={`Splits (${track.splits.length})`}>
          <SplitsTable splits={track.splits} />
        </Section>
      )}
    </div>
  );
}
