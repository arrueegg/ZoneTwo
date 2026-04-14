import type { Anomaly, Correlation } from "../hooks/useAnalysis";

interface Props {
  anomalies: Anomaly[];
  correlations: Correlation[];
}

export function InsightsPanel({ anomalies, correlations }: Props) {
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

      {correlations.length > 0 && (
        <div>
          <h3 style={H3}>Your Personal Patterns</h3>
          <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 12 }}>
            Based on your last {correlations[0]?.n ?? "—"} days of data.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {correlations.map((c, i) => {
              const strength = Math.abs(c.r);
              const barColor = strength > 0.5 ? "#6366f1" : strength > 0.3 ? "#f59e0b" : "#d1d5db";
              return (
                <div key={i} style={{
                  padding: "12px 14px",
                  background: "#f9fafb",
                  borderRadius: 6,
                  fontSize: 14,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontWeight: 600, color: "#374151" }}>{c.label}</span>
                    <span style={{ fontSize: 12, color: "#6b7280" }}>r = {c.r > 0 ? "+" : ""}{c.r}</span>
                  </div>
                  {/* Correlation bar */}
                  <div style={{ background: "#e5e7eb", borderRadius: 4, height: 6, marginBottom: 8 }}>
                    <div style={{
                      height: 6,
                      borderRadius: 4,
                      background: barColor,
                      width: `${strength * 100}%`,
                    }} />
                  </div>
                  <p style={{ margin: 0, color: "#4b5563", lineHeight: 1.5 }}>{c.interpretation}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {anomalies.length === 0 && correlations.length === 0 && (
        <p style={{ color: "#9ca3af", fontSize: 14 }}>
          Not enough data yet — insights will appear after a few weeks of tracking.
        </p>
      )}
    </div>
  );
}

const H3: React.CSSProperties = {
  fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 10,
};
