function fmtTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const RACE_ORDER = [
  { key: "5k",            label: "5 km" },
  { key: "10k",           label: "10 km" },
  { key: "half_marathon", label: "Half Marathon" },
  { key: "marathon",      label: "Marathon" },
];

// Garmin uses various key formats
function findTime(preds: Record<string, number>, key: string): number | null {
  const variants = [key, key.replace("_", ""), key.toUpperCase(), key.replace("_", " ")];
  for (const v of variants) {
    if (preds[v] != null) return preds[v];
  }
  // fuzzy match: contains the base word
  const base = key.replace("_", "");
  const found = Object.entries(preds).find(([k]) => k.toLowerCase().replace(/[^a-z0-9]/g, "") === base.toLowerCase());
  return found ? found[1] : null;
}

interface Props {
  predictions: Record<string, number>;
  vo2max?: number | null;
  fitnessAge?: number | null;
}

export function RacePredictions({ predictions, vo2max, fitnessAge }: Props) {
  const races = RACE_ORDER.map((r) => ({ ...r, secs: findTime(predictions, r.key) }))
    .filter((r) => r.secs != null);

  if (!races.length && !vo2max && !fitnessAge) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
      {races.map(({ label, secs }) => (
        <div key={label} style={{
          flex: "1 1 140px", padding: "14px 16px",
          background: "#f9fafb", borderRadius: 8, border: "1px solid #e5e7eb",
          textAlign: "center",
        }}>
          <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
            {label}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#111", fontVariantNumeric: "tabular-nums" }}>
            {fmtTime(secs!)}
          </div>
        </div>
      ))}
      {vo2max != null && (
        <div style={{
          flex: "1 1 120px", padding: "14px 16px",
          background: "#eff6ff", borderRadius: 8, border: "1px solid #bfdbfe",
          textAlign: "center",
        }}>
          <div style={{ fontSize: 11, color: "#3b82f6", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
            VO₂max
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#1d4ed8" }}>{vo2max}</div>
        </div>
      )}
      {fitnessAge != null && (
        <div style={{
          flex: "1 1 120px", padding: "14px 16px",
          background: "#f0fdf4", borderRadius: 8, border: "1px solid #bbf7d0",
          textAlign: "center",
        }}>
          <div style={{ fontSize: 11, color: "#16a34a", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
            Fitness Age
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#15803d" }}>{fitnessAge}</div>
        </div>
      )}
    </div>
  );
}
