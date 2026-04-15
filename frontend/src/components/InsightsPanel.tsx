import type { Anomaly } from "../hooks/useAnalysis";

interface Props {
  anomalies: Anomaly[];
}

export function InsightsPanel({ anomalies }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {anomalies.length > 0 && (
        <div>
          <h3 style={H3}>Today's Flags</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {anomalies.map((a, i) => (
              <div key={i} style={{
                borderLeft: "4px solid #ef4444",
                padding: "10px 14px",
                background: "#fff7f7",
                borderRadius: "0 6px 6px 0",
                fontSize: 14,
              }}>
                <span style={{ fontWeight: 600, marginRight: 8 }}>{a.label}</span>
                {a.message}
                <span style={{ marginLeft: 8, fontSize: 12, color: "#9ca3af" }}>
                  (z={a.z_score > 0 ? "+" : ""}{a.z_score})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {anomalies.length === 0 && (
        <p style={{ color: "#9ca3af", fontSize: 14 }}>
          No flags right now.
        </p>
      )}
    </div>
  );
}

const H3: React.CSSProperties = {
  fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 10,
};
