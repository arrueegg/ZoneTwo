import { useActivities } from "../hooks/useActivities";
import { useAthleteContext } from "../main";

function formatPace(sec_km: number | null): string {
  if (!sec_km) return "—";
  const min = Math.floor(sec_km / 60);
  const sec = Math.round(sec_km % 60);
  return `${min}:${sec.toString().padStart(2, "0")} /km`;
}

function formatDistance(meters: number | null): string {
  if (!meters) return "—";
  return `${(meters / 1000).toFixed(2)} km`;
}

function formatDuration(sec: number | null): string {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

export function Activities() {
  const { athleteId } = useAthleteContext();
  const { data: activities = [], isLoading } = useActivities({ athleteId: athleteId ?? "", limit: 100 });

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px", fontFamily: "sans-serif" }}>
      <h1 style={{ marginBottom: 24 }}>Activities</h1>
      {isLoading && <p>Loading…</p>}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #e5e7eb" }}>
            <th style={TH}>Date</th>
            <th style={TH}>Type</th>
            <th style={TH}>Distance</th>
            <th style={TH}>Duration</th>
            <th style={TH}>Avg HR</th>
            <th style={TH}>Pace</th>
            <th style={TH}>TSS</th>
          </tr>
        </thead>
        <tbody>
          {activities.map((a) => (
            <tr key={a.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
              <td style={TD}>{a.start_time?.slice(0, 10)}</td>
              <td style={TD}>{a.sport_type}</td>
              <td style={TD}>{formatDistance(a.distance_m)}</td>
              <td style={TD}>{formatDuration(a.duration_sec)}</td>
              <td style={TD}>{a.avg_hr != null ? `${a.avg_hr.toFixed(0)} bpm` : "—"}</td>
              <td style={TD}>{formatPace(a.avg_pace_sec_km)}</td>
              <td style={TD}>{a.tss != null ? a.tss.toFixed(1) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TH: React.CSSProperties = { padding: "6px 10px", color: "#6b7280", fontWeight: 600 };
const TD: React.CSSProperties = { padding: "8px 10px" };
