import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";

interface SummaryResponse {
  summary: string | null;
  generated_at: string | null;
  stale: boolean;
}

interface Props {
  athleteId: string;
}

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

  const { mutate: generate, isPending } = useMutation({
    mutationFn: async () => {
      const { data } = await api.post("/recommendations/weekly-summary", null, {
        params: { athlete_id: athleteId },
      });
      return data;
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

  if (isLoading) return null;

  const hasSummary = data?.summary && !data.stale;
  const generatedDate = data?.generated_at ? new Date(data.generated_at).toLocaleDateString() : null;

  return (
    <div style={{
      background: "#fafafa", border: "1px solid #e5e7eb", borderRadius: 8,
      padding: "16px 20px",
    }}>
      {hasSummary ? (
        <>
          <p style={{
            margin: "0 0 12px", fontSize: 14, lineHeight: 1.7, color: "#374151",
            whiteSpace: "pre-wrap",
          }}>
            {data!.summary}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {generatedDate && (
              <span style={{ fontSize: 12, color: "#9ca3af" }}>Generated {generatedDate}</span>
            )}
            <button
              onClick={() => generate()}
              disabled={isPending}
              style={ghostBtn}
            >
              {isPending ? "Generating…" : "Refresh"}
            </button>
          </div>
        </>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <p style={{ margin: 0, fontSize: 14, color: "#6b7280" }}>
            {data?.stale && data.summary
              ? "Your weekly summary is over 7 days old."
              : "No weekly summary yet — generate one to get AI coaching feedback."}
          </p>
          <button
            onClick={() => generate()}
            disabled={isPending}
            style={primaryBtn}
          >
            {isPending ? "Generating…" : "Generate"}
          </button>
        </div>
      )}
      {error && <p style={{ margin: "8px 0 0", fontSize: 13, color: "#dc2626" }}>{error}</p>}
    </div>
  );
}

const ghostBtn: React.CSSProperties = {
  background: "none", border: "1px solid #d1d5db", borderRadius: 6,
  padding: "5px 12px", cursor: "pointer", fontSize: 12, color: "#374151",
};
const primaryBtn: React.CSSProperties = {
  background: "#3B8BD4", color: "#fff", border: "none", borderRadius: 6,
  padding: "7px 16px", cursor: "pointer", fontWeight: 600, fontSize: 13,
  whiteSpace: "nowrap",
};
