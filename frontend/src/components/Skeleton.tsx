const shimmer: React.CSSProperties = {
  background: "linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)",
  backgroundSize: "200% 100%",
  animation: "skeleton-shimmer 1.4s ease-in-out infinite",
  borderRadius: 6,
};

// Inject the keyframe once via a style tag in the document head
if (typeof document !== "undefined" && !document.getElementById("skeleton-style")) {
  const style = document.createElement("style");
  style.id = "skeleton-style";
  style.textContent = `@keyframes skeleton-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`;
  document.head.appendChild(style);
}

export function Skeleton({ width = "100%", height = 16, style }: {
  width?: string | number;
  height?: string | number;
  style?: React.CSSProperties;
}) {
  return <div style={{ ...shimmer, width, height, ...style }} />;
}

/** A block of stacked skeleton lines, like a paragraph placeholder. */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "65%" : "100%"} height={14} />
      ))}
    </div>
  );
}

/** Placeholder for a chart area. */
export function SkeletonChart({ height = 220 }: { height?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Skeleton width="100%" height={height} style={{ borderRadius: 8 }} />
      <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
        {[60, 80, 50, 70, 55].map((w, i) => (
          <Skeleton key={i} width={w} height={10} />
        ))}
      </div>
    </div>
  );
}

/** Placeholder rows for a table. */
export function SkeletonTableRows({ rows = 6, cols = 7 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} style={{ padding: "10px 10px" }}>
              <Skeleton width={c === 0 ? 70 : 50} height={12} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Placeholder for the RecoveryIndicator card grid. */
export function SkeletonRecovery() {
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} style={{ flex: "1 1 120px", padding: "14px 16px", background: "#f9fafb", borderRadius: 8 }}>
          <Skeleton width={60} height={10} style={{ marginBottom: 10 }} />
          <Skeleton width={80} height={22} />
        </div>
      ))}
    </div>
  );
}
