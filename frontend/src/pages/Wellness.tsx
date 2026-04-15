import { useAthleteContext } from "../main";
import { useWellness } from "../hooks/useWellness";
import { useAnalysis } from "../hooks/useAnalysis";
import { useMetricsSummary } from "../hooks/useMetrics";
import { WellnessCharts } from "../components/WellnessCharts";
import { ReadinessChart } from "../components/ReadinessChart";
import { RecoveryIndicator } from "../components/RecoveryIndicator";
import { WeeklySummaryTable } from "../components/WeeklySummaryTable";
import { InsightsPanel } from "../components/InsightsPanel";
import { ZoneDistributionChart } from "../components/ZoneDistributionChart";
import { SleepChart, SleepStageBreakdown } from "../components/SleepChart";
import { SkeletonRecovery, SkeletonChart } from "../components/Skeleton";

const today = new Date().toISOString().slice(0, 10);
const ninetyDaysAgo = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);

export function Wellness() {
  const { athleteId } = useAthleteContext();
  const { data: wellness = [], isLoading } = useWellness(athleteId ?? "", ninetyDaysAgo, today);
  const { data: summary, isLoading: summaryLoading } = useMetricsSummary(athleteId ?? "");
  const { data: analysis } = useAnalysis(athleteId ?? "");

  if (!athleteId) {
    return (
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "48px 16px", fontFamily: "sans-serif", textAlign: "center" }}>
        <p style={{ color: "#6b7280" }}>Connect your Garmin account in <a href="/settings">Settings</a> to see wellness data.</p>
      </div>
    );
  }

  const recentHrv = wellness.slice(-7).map((d) => d.hrv_rmssd).filter((v): v is number => v != null);
  const hrv7DayAvg = recentHrv.length > 0
    ? recentHrv.reduce((a, b) => a + b, 0) / recentHrv.length
    : null;

  const hasSummary = summary && Object.keys(summary).length > 0;

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px", fontFamily: "sans-serif" }}>
      <h1 style={{ marginBottom: 4 }}>Wellness</h1>
      <p style={{ color: "#6b7280", marginBottom: 32 }}>Last 90 days · Garmin Connect</p>

      {/* Today snapshot */}
      <Section title="Today">
        {summaryLoading ? (
          <SkeletonRecovery />
        ) : hasSummary ? (
          <>
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
            {/* Readiness scores */}
          <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: "8px 24px", alignItems: "center" }}>
            {summary.readiness_score != null && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "#6b7280" }}>Readiness</span>
                <ReadinessBadge score={summary.readiness_score} />
              </div>
            )}
            {summary.training_readiness_score != null && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "#6b7280" }}>
                  Garmin Readiness
                  {summary.training_readiness_description && (
                    <span style={{ marginLeft: 4, fontStyle: "italic" }}>
                      ({summary.training_readiness_description.toLowerCase().replace(/_/g, " ")})
                    </span>
                  )}
                </span>
                <ReadinessBadge score={summary.training_readiness_score} />
              </div>
            )}
          </div>

          {/* Sleep stages breakdown for today */}
          {(summary.sleep_deep_seconds != null || summary.sleep_rem_seconds != null) && (
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 8 }}>Last night's sleep</div>
              <SleepStageBreakdown summary={summary} />
            </div>
          )}
          </>
        ) : (
          <p style={{ color: "#9ca3af", fontSize: 14 }}>No data yet.</p>
        )}
      </Section>

      {/* Readiness trend */}
      {(isLoading || wellness.some((d) => d.readiness_score != null)) && (
        <Section title="Readiness Score (90 days)">
          {isLoading ? <SkeletonChart height={220} /> : <ReadinessChart data={wellness} />}
        </Section>
      )}

      {/* Insights */}
      {analysis && (
        <Section title="Insights">
          <InsightsPanel
            anomalies={analysis.anomalies}
            correlations={analysis.correlations}
          />
        </Section>
      )}

      {/* Weekly summary table */}
      {analysis?.weekly_summary?.length ? (
        <Section title="Weekly Trends">
          <WeeklySummaryTable weeks={analysis.weekly_summary} />
        </Section>
      ) : null}

      {/* Sleep stages trend */}
      {(isLoading || wellness.some((d) => d.sleep_deep_seconds != null)) && (
        <Section title="Sleep Stages (last 60 days)">
          {isLoading ? <SkeletonChart height={220} /> : <SleepChart data={wellness} />}
        </Section>
      )}

      {/* HR zone distribution */}
      {athleteId && (
        <Section title="HR Zone Distribution (last 12 weeks)">
          <ZoneDistributionChart athleteId={athleteId} />
        </Section>
      )}

      {/* Raw charts */}
      <Section title="All Metrics">
        {isLoading ? <SkeletonChart height={300} /> : <WellnessCharts data={wellness} />}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 40 }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 14, color: "#111" }}>{title}</h2>
      {children}
    </div>
  );
}

function ReadinessBadge({ score }: { score: number }) {
  const color = score >= 70 ? "#065f46" : score >= 50 ? "#92400e" : "#7f1d1d";
  const bg    = score >= 70 ? "#d1fae5" : score >= 50 ? "#fef3c7" : "#fee2e2";
  return (
    <span style={{ padding: "4px 14px", borderRadius: 999, background: bg, color, fontWeight: 700, fontSize: 18 }}>
      {score.toFixed(0)}
    </span>
  );
}
