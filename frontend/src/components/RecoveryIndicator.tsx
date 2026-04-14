interface Props {
  hrv: number | null;
  hrv7DayAvg: number | null;
  restingHR: number | null;
  sleepScore: number | null;
  sleepUnit?: "h" | "score";
  bodyBatteryHigh?: number | null;
  bodyBatteryWake?: number | null;
  stress?: number | null;
}

type Status = "ready" | "normal" | "tired";

const STATUS_CONFIG: Record<Status, { label: string; color: string; bg: string }> = {
  ready: { label: "Ready", color: "#065f46", bg: "#d1fae5" },
  normal: { label: "Normal", color: "#92400e", bg: "#fef3c7" },
  tired: { label: "Tired", color: "#7f1d1d", bg: "#fee2e2" },
};

function getHrvStatus(hrv: number, avg: number): Status {
  if (hrv > avg * 1.05) return "ready";
  if (hrv < avg * 0.95) return "tired";
  return "normal";
}

export function RecoveryIndicator({
  hrv, hrv7DayAvg, restingHR, sleepScore,
  sleepUnit = "score", bodyBatteryHigh, bodyBatteryWake, stress,
}: Props) {
  const status: Status =
    hrv != null && hrv7DayAvg != null ? getHrvStatus(hrv, hrv7DayAvg) : "normal";
  const { label, color, bg } = STATUS_CONFIG[status];

  return (
    <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
      <div style={{ padding: "6px 14px", borderRadius: 999, background: bg, color, fontWeight: 600, fontSize: 14 }}>
        {label}
      </div>
      <Metric label="HRV" value={hrv != null ? `${hrv.toFixed(0)} ms` : "—"} />
      <Metric label="7d avg HRV" value={hrv7DayAvg != null ? `${hrv7DayAvg.toFixed(0)} ms` : "—"} />
      <Metric label="Resting HR" value={restingHR != null ? `${restingHR.toFixed(0)} bpm` : "—"} />
      <Metric
        label="Sleep"
        value={sleepScore != null ? (sleepUnit === "h" ? `${sleepScore.toFixed(1)} h` : `${sleepScore.toFixed(0)}`) : "—"}
      />
      {bodyBatteryWake != null && <Metric label="Battery at wake" value={`${bodyBatteryWake}`} />}
      {bodyBatteryHigh != null && <Metric label="Battery peak" value={`${bodyBatteryHigh}`} />}
      {stress != null && <Metric label="Avg stress" value={`${stress.toFixed(0)}`} />}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "#111" }}>{value}</div>
    </div>
  );
}
