import { useQuery } from "@tanstack/react-query";
import { TrainingLoadChart } from "../components/TrainingLoadChart";
import { RecoveryIndicator } from "../components/RecoveryIndicator";
import { RecommendationFeed } from "../components/RecommendationFeed";
import { ReadinessChart } from "../components/ReadinessChart";
import { InsightsPanel } from "../components/InsightsPanel";
import { useTrainingLoad, useMetricsSummary } from "../hooks/useMetrics";
import { useWellness } from "../hooks/useWellness";
import { useAnalysis } from "../hooks/useAnalysis";
import { useAthleteContext } from "../main";
import api, { Insight } from "../api/client";

const today = new Date().toISOString().slice(0, 10);
const ninetyDaysAgo = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);

export function Dashboard() {
  const { athleteId } = useAthleteContext();

  const { data: loadData = [], isLoading: loadLoading } = useTrainingLoad(athleteId ?? "", ninetyDaysAgo, today);
  const { data: wellness = [] } = useWellness(athleteId ?? "", ninetyDaysAgo, today);
  const { data: summary } = useMetricsSummary(athleteId ?? "");
  const { data: analysis } = useAnalysis(athleteId ?? "");
  const { data: insights = [] } = useQuery<Insight[]>({
    queryKey: ["insights", athleteId],
    queryFn: async () => {
      const { data } = await api.get("/recommendations/insights", { params: { athlete_id: athleteId } });
      return data;
    },
    enabled: Boolean(athleteId),
  });

  if (!athleteId) {
    return (
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "48px 16px", fontFamily: "sans-serif", textAlign: "center" }}>
        <p style={{ color: "#6b7280" }}>Connect your account in <a href="/settings">Settings</a> to get started.</p>
      </div>
    );
  }

  const recentHrv = wellness.slice(-7).map((d) => d.hrv_rmssd).filter((v): v is number => v != null);
  const hrv7DayAvg = recentHrv.length > 0 ? recentHrv.reduce((a, b) => a + b, 0) / recentHrv.length : null;
  const hasSummary = summary && Object.keys(summary).length > 0;
  const hasTrainingLoad = loadData.some((d) => d.ctl != null);

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px", fontFamily: "sans-serif" }}>
      <h1 style={{ marginBottom: 4 }}>ZoneTwo</h1>
      <p style={{ color: "#6b7280", marginBottom: 32 }}>Training Analytics</p>

      {/* Today */}
      {hasSummary && (
        <Section title="Today">
          <div style={{ display: "flex", gap: 32, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 280 }}>
              <RecoveryIndicator
                hrv={summary.hrv_rmssd ?? null}
                hrv7DayAvg={hrv7DayAvg}
                restingHR={summary.resting_hr ?? null}
                sleepScore={summary.sleep_hours ?? null}
                sleepUnit="h"
                bodyBatteryHigh={summary.body_battery_high ?? null}
                bodyBatteryWake={summary.body_battery_wake ?? null}
                stress={summary.stress_avg ?? null}
              />
            </div>
            {summary.readiness_score != null && (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                  Readiness
                </div>
                <ReadinessBadge score={summary.readiness_score} />
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Anomaly flags */}
      {analysis?.anomalies?.length ? (
        <Section title="Flags">
          <InsightsPanel anomalies={analysis.anomalies} correlations={[]} />
        </Section>
      ) : null}

      {/* Readiness trend */}
      {wellness.some((d) => d.readiness_score != null) && (
        <Section title="Readiness (90 days)">
          <ReadinessChart data={wellness} />
        </Section>
      )}

      {/* PMC */}
      <Section title={hasTrainingLoad ? "Performance Management Chart (90 days)" : "Training Load — no data yet"}>
        {loadLoading ? <p>Loading…</p> : hasTrainingLoad ? (
          <>
            <TrainingLoadChart data={loadData} />
            <div style={{ display: "flex", gap: 24, marginTop: 12, fontSize: 14, color: "#374151" }}>
              <Stat label="CTL (fitness)" value={summary?.ctl?.toFixed(1)} />
              <Stat label="ATL (fatigue)" value={summary?.atl?.toFixed(1)} />
              <Stat label="TSB (form)"    value={summary?.tsb?.toFixed(1)} />
            </div>
          </>
        ) : (
          <p style={{ color: "#9ca3af", fontSize: 14 }}>
            Set your threshold HR in <a href="/settings">Settings</a> to calculate TSS from activities.
          </p>
        )}
      </Section>

      {/* Coaching insights */}
      {insights.length > 0 && (
        <Section title="Coaching Insights">
          <RecommendationFeed insights={insights} />
        </Section>
      )}

      {/* Correlations */}
      {analysis?.correlations?.length ? (
        <Section title="Your Patterns">
          <InsightsPanel anomalies={[]} correlations={analysis.correlations} />
        </Section>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 36 }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: "#111" }}>{title}</h2>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div>
      <span style={{ color: "#9ca3af" }}>{label}: </span>
      <strong>{value ?? "—"}</strong>
    </div>
  );
}

function ReadinessBadge({ score }: { score: number }) {
  const color = score >= 70 ? "#065f46" : score >= 50 ? "#92400e" : "#7f1d1d";
  const bg    = score >= 70 ? "#d1fae5" : score >= 50 ? "#fef3c7" : "#fee2e2";
  return (
    <span style={{ padding: "6px 18px", borderRadius: 999, background: bg, color, fontWeight: 700, fontSize: 22 }}>
      {score.toFixed(0)}
    </span>
  );
}
