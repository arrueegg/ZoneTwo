import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import api from "../api/client";
import type { Activity, ActivityTrack, TrackPoint } from "../api/client";
import { HelpTerm } from "../components/Help";

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
  const totalSec = Math.round(sec);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

function fmtDist(m: number | null | undefined): string {
  if (!m) return "—";
  return `${(m / 1000).toFixed(1)} km`;
}

function distanceM(a: Pick<TrackPoint, "lat" | "lon">, b: Pick<TrackPoint, "lat" | "lon">): number {
  const dlat = (b.lat - a.lat) * 111320;
  const dlon = (b.lon - a.lon) * 111320 * Math.cos(a.lat * Math.PI / 180);
  return Math.sqrt(dlat * dlat + dlon * dlon);
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

type ChartPoint = {
  dist: number;
  hr: number | null;
  ele: number | null;
  pace: number | null;
  cadence: number | null;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function localMedian(values: Array<number | null>, index: number, radius: number): number | null {
  const nearby = values
    .slice(Math.max(0, index - radius), Math.min(values.length, index + radius + 1))
    .filter((v): v is number => v != null);

  return nearby.length >= 3 ? median(nearby) : null;
}

function removeCadenceOutliers(values: Array<number | null>): Array<number | null> {
  const plausible = values.filter((value): value is number => value != null && value >= 30 && value <= 260);
  if (plausible.length < 8) {
    return values.map((value) => value != null && value >= 30 && value <= 260 ? value : null);
  }

  const sorted = [...plausible].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = Math.max(1, q3 - q1);
  const low = Math.max(30, q1 - iqr * 2.5);
  const high = Math.min(260, q3 + iqr * 2.5);

  return values.map((value, i) => {
    if (value == null || value < low || value > high) return null;

    const localMedianValue = localMedian(values, i, 3);
    if (localMedianValue == null) return value;

    return Math.abs(value - localMedianValue) > Math.max(18, localMedianValue * 0.14) ? null : value;
  });
}

function isSustainedPaceJump(values: Array<number | null>, boundary: number): boolean {
  const before = values.slice(Math.max(0, boundary - 5), boundary).filter((v): v is number => v != null);
  const after = values.slice(boundary, Math.min(values.length, boundary + 5)).filter((v): v is number => v != null);

  if (before.length < 3 || after.length < 3) return false;

  const beforeMedian = median(before);
  const afterMedian = median(after);
  const delta = Math.abs(beforeMedian - afterMedian);
  const relativeDelta = delta / Math.max(1, Math.min(beforeMedian, afterMedian));

  return delta > 30 && relativeDelta > 0.10;
}

function smoothPace(points: ChartPoint[]): Array<number | null> {
  const values = points.map((p) => p.pace);
  const despiked = values.map((value, i) => {
    if (value == null) return null;

    const localMedianValue = localMedian(values, i, 3);
    if (localMedianValue == null) return value;

    const delta = Math.abs(value - localMedianValue);
    const relativeDelta = delta / Math.max(1, localMedianValue);

    return delta > 45 && relativeDelta > 0.16 ? localMedianValue : value;
  });

  const boundaries = despiked.map((_, i) => i > 0 && isSustainedPaceJump(despiked, i));
  const smoothingDistanceKm = 0.2;

  return despiked.map((value, i) => {
    if (value == null) return null;

    let start = i;
    while (start > 0 && !boundaries[start] && points[i].dist - points[start - 1].dist <= smoothingDistanceKm) {
      start -= 1;
    }

    let end = i;
    while (end < despiked.length - 1 && !boundaries[end + 1] && points[end + 1].dist - points[i].dist <= smoothingDistanceKm) {
      end += 1;
    }

    let total = 0;
    let weightTotal = 0;
    for (let j = start; j <= end; j += 1) {
      const pace = despiked[j];
      if (pace == null) continue;

      const distance = Math.abs(points[j].dist - points[i].dist);
      const weight = Math.max(0.2, 1 - distance / smoothingDistanceKm);
      total += pace * weight;
      weightTotal += weight;
    }

    return weightTotal > 0 ? Math.round(total / weightTotal) : value;
  });
}

function buildChartData(points: TrackPoint[]) {
  // Downsample to ~500 points for performance
  const step = Math.max(1, Math.floor(points.length / 500));
  const sampled = points.filter((_, i) => i % step === 0);

  // Compute cumulative distance from lat/lon
  let cumDist = 0;
  const data: ChartPoint[] = sampled.map((p, i) => {
    if (i > 0) {
      const prev = sampled[i - 1];
      cumDist += distanceM(prev, p);
    }
    return {
      dist: Math.round(cumDist) / 1000,
      hr: p.hr ?? null,
      ele: p.ele ?? null,
      pace: p.pace_sec_km ?? null,
      cadence: p.cadence ?? null,
    };
  });

  const smoothedPace = smoothPace(data);
  const cleanedCadence = removeCadenceOutliers(data.map((d) => d.cadence));
  return data.map((d, i) => ({ ...d, pace: smoothedPace[i], cadence: cleanedCadence[i] }));
}

const tick = { fontSize: 11, fill: "#9ca3af" };

function fmtChartKm(value: number | string): string {
  return Number(value).toFixed(1);
}

function fmtChartKmTooltip(value: number | string): string {
  return `${Number(value).toFixed(2)} km`;
}

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
              <XAxis dataKey="dist" tick={tick} unit=" km" tickFormatter={fmtChartKm} />
              <YAxis tick={tick} unit=" m" width={40} />
              <Tooltip formatter={(v: number) => [`${v.toFixed(0)} m`, "Elevation"]} labelFormatter={fmtChartKmTooltip} />
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
              <XAxis dataKey="dist" tick={tick} unit=" km" tickFormatter={fmtChartKm} />
              <YAxis tick={tick} unit=" bpm" domain={["auto", "auto"]} width={44} />
              <Tooltip formatter={(v: number) => [`${v} bpm`, "HR"]} labelFormatter={fmtChartKmTooltip} />
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
              <XAxis dataKey="dist" tick={tick} unit=" km" tickFormatter={fmtChartKm} />
              <YAxis
                tick={tick}
                reversed
                domain={["auto", "auto"]}
                width={44}
                tickFormatter={(v) => fmtPace(v)}
              />
              <Tooltip
                formatter={(v: number) => [fmtPace(v), "Pace"]}
                labelFormatter={fmtChartKmTooltip}
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
              <XAxis dataKey="dist" tick={tick} unit=" km" tickFormatter={fmtChartKm} />
              <YAxis tick={tick} unit=" spm" domain={["auto", "auto"]} width={44} />
              <Tooltip formatter={(v: number) => [`${v} spm`, "Cadence"]} labelFormatter={fmtChartKmTooltip} />
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
                <HelpTerm>{h}</HelpTerm>
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
  const isCycling = ["ride", "virtual_ride"].includes(a.sport_type);
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
      {isCycling && a.normalized_power != null && <Tile label="NP" value={`${Math.round(a.normalized_power)} W`} />}
      {a.vo2max_estimated != null && <Tile label="VO₂max est." value={a.vo2max_estimated.toFixed(1)} />}
    </div>
  );
}

function Tile({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 16px", minWidth: 90, textAlign: "center" }}>
      <div style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
        <HelpTerm>{label}</HelpTerm>
      </div>
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
      <div style={{ fontSize: 10, color, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2, fontWeight: 600 }}>
        <HelpTerm>Training Effect</HelpTerm>
      </div>
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
      <h3 style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 8 }}><HelpTerm>{title}</HelpTerm></h3>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: "#111" }}><HelpTerm>{title}</HelpTerm></h2>
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
        <Section title="Splits">
          <SplitsTable splits={track.splits} />
        </Section>
      )}
    </div>
  );
}
