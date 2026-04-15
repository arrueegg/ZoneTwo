import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import { SkeletonText } from "./Skeleton";

interface SummarySections {
  week_summary: string;
  training_recommendation: string;
  recovery_insight: string;
}

interface SummaryResponse {
  sections: SummarySections | null;
  generated_at: string | null;
  stale: boolean;
}

interface Props {
  athleteId: string;
}

const SECTIONS: { key: keyof SummarySections; label: string; accent: string; bg: string }[] = [
  { key: "week_summary",            label: "Week in review",      accent: "#6366f1", bg: "#f5f3ff" },
  { key: "training_recommendation", label: "Next week",           accent: "#0891b2", bg: "#ecfeff" },
  { key: "recovery_insight",        label: "Recovery",            accent: "#059669", bg: "#f0fdf4" },
];

export function AiWeeklySummary({ athleteId }: Props) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");

  const { data, isLoading } = useQuery<SummaryResponse>({
    queryKey: ["weekly-summary", athleteId],
    queryFn: async () => {
      const { data } = await api.get("/recommendations/weekly-summary", {
        params: { athlete_id: athleteId },
      });
      return data;
    },
    enabled: Boolean(athleteId),
  });

  const { mutate: generate, isPending } = useMutation<SummaryResponse, unknown, boolean>({
    mutationFn: async (force: boolean) => {
      const { data } = await api.post("/recommendations/weekly-summary", null, {
        params: { athlete_id: athleteId, force },
      });
      return data as SummaryResponse;
    },
    onSuccess: (result) => {
      queryClient.setQueryData(["weekly-summary", athleteId], result);
      setError("");
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Failed to generate summary");
    },
  });

  if (isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {SECTIONS.map((s) => (
          <div key={s.key} style={{ padding: "14px 16px", background: s.bg, borderRadius: 8, borderLeft: `3px solid ${s.accent}` }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: s.accent, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {s.label}
            </div>
            <SkeletonText lines={2} />
          </div>
        ))}
      </div>
    );
  }

  const sections = data?.sections;
  const hasSections = sections && (sections.week_summary || sections.training_recommendation || sections.recovery_insight);
  const generatedDate = data?.generated_at
    ? new Date(data.generated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;

  if (!hasSections) {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 16,
        padding: "16px 20px", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8,
      }}>
        <p style={{ margin: 0, fontSize: 14, color: "#6b7280", flex: 1 }}>
          Generate your first weekly coaching debrief — powered by Llama 3.
        </p>
        <GenerateButton loading={isPending} onClick={() => generate(false)} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {SECTIONS.map(({ key, label, accent, bg }) => {
          const text = sections[key];
          if (!text) return null;
          return (
            <div key={key} style={{
              padding: "14px 16px",
              background: bg,
              borderRadius: 8,
              borderLeft: `3px solid ${accent}`,
            }}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: accent,
                textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6,
              }}>
                {label}
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                {text.replace(/\*\*/g, "").split("\n").map((line) => line.trim()).filter(Boolean).map((line, i) => (
                  <li key={i} style={{ fontSize: 14, lineHeight: 1.6, color: "#374151", paddingLeft: line.startsWith("•") ? 0 : 12 }}>
                    {line.startsWith("•") ? (
                      <span><span style={{ color: accent, marginRight: 8, fontWeight: 700 }}>•</span>{line.slice(1).trim()}</span>
                    ) : line}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
        {generatedDate && (
          <span style={{ fontSize: 12, color: "#9ca3af" }}>
            {data!.stale ? `Last generated ${generatedDate} — refresh for latest` : `Generated ${generatedDate}`}
          </span>
        )}
        <GenerateButton loading={isPending} onClick={() => generate(true)} label="Refresh" />
      </div>

      {error && <p style={{ margin: "8px 0 0", fontSize: 13, color: "#dc2626" }}>{error}</p>}
    </div>
  );
}

function GenerateButton({ loading, onClick, label = "Generate" }: {
  loading: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        background: loading ? "#e5e7eb" : "#6366f1",
        color: loading ? "#9ca3af" : "#fff",
        border: "none", borderRadius: 6,
        padding: "7px 16px", cursor: loading ? "default" : "pointer",
        fontWeight: 600, fontSize: 13, whiteSpace: "nowrap",
        transition: "background 0.15s",
      }}
    >
      {loading ? "Generating…" : label}
    </button>
  );
}
