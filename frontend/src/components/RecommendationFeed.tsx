import type { Insight } from "../api/client";

interface Props {
  insights: Insight[];
}

const TYPE_STYLES: Record<string, { border: string; icon: string }> = {
  warning: { border: "#f97316", icon: "⚠" },
  positive: { border: "#22c55e", icon: "✓" },
  info: { border: "#3b82f6", icon: "ℹ" },
};

export function RecommendationFeed({ insights }: Props) {
  if (insights.length === 0) {
    return <p style={{ color: "#9ca3af" }}>No insights yet — sync some activities first.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {insights.map((insight, i) => {
        const style = TYPE_STYLES[insight.type] ?? TYPE_STYLES.info;
        return (
          <div
            key={i}
            style={{
              borderLeft: `4px solid ${style.border}`,
              padding: "10px 14px",
              background: "#f9fafb",
              borderRadius: "0 6px 6px 0",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {style.icon} {insight.title}
            </div>
            <div style={{ fontSize: 14, color: "#374151" }}>{insight.body}</div>
          </div>
        );
      })}
    </div>
  );
}
