import { useState, useEffect } from "react";
import { useAthleteContext } from "../main";
import api from "../api/client";

const ATHLETE_ID_KEY = "zonetwo_athlete_id";
const ATHLETE_NAME_KEY = "zonetwo_athlete_name";

interface AthleteProfile {
  threshold_hr: number | null;
  max_hr: number | null;
  goal: string | null;
  target_race: string | null;
  target_ctl: number | null;
  strava_connected: boolean;
  garmin_connected: boolean;
  garmin_email: string | null;
}

export function Settings() {
  const { athleteId, name, logout } = useAthleteContext();
  const [profile, setProfile] = useState<AthleteProfile>({
    threshold_hr: null,
    max_hr: null,
    goal: null,
    target_race: null,
    target_ctl: null,
    strava_connected: false,
    garmin_connected: false,
    garmin_email: null,
  });
  const [saved, setSaved] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [garminEmail, setGarminEmail] = useState("");
  const [garminPassword, setGarminPassword] = useState("");
  const [garminStatus, setGarminStatus] = useState<"idle" | "loading" | "error">("idle");
  const [garminError, setGarminError] = useState("");

  useEffect(() => {
    if (!athleteId) return;
    api.get(`/athlete/${athleteId}`).then(({ data }) => {
      setProfile({
        threshold_hr: data.threshold_hr ?? null,
        max_hr: data.max_hr ?? null,
        goal: data.goal ?? null,
        target_race: data.target_race ?? null,
        target_ctl: data.target_ctl ?? null,
        strava_connected: data.strava_connected ?? false,
        garmin_connected: data.garmin_connected ?? false,
        garmin_email: data.garmin_email ?? null,
      });
    });
  }, [athleteId]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    await api.patch(`/athlete/${athleteId}`, profile);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleGarminConnect(e: React.FormEvent) {
    e.preventDefault();
    setGarminStatus("loading");
    setGarminError("");
    try {
      if (athleteId) {
        // Already have an account (via Strava) — just add Garmin credentials
        await api.post(`/athlete/${athleteId}/garmin`, {
          email: garminEmail,
          password: garminPassword,
        });
        setProfile((p) => ({ ...p, garmin_connected: true, garmin_email: garminEmail }));
      } else {
        // No account yet — create one via Garmin login
        const { data } = await api.post("/auth/garmin/login", {
          email: garminEmail,
          password: garminPassword,
        });
        localStorage.setItem(ATHLETE_ID_KEY, data.athlete_id);
        localStorage.setItem(ATHLETE_NAME_KEY, data.name);
        // Reload so the context picks up the new athlete
        window.location.href = "/";
      }
      setGarminPassword("");
      setGarminStatus("idle");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Connection failed";
      setGarminError(msg);
      setGarminStatus("error");
    }
  }

  async function handleGarminDisconnect() {
    await api.delete(`/athlete/${athleteId}/garmin`);
    setProfile((p) => ({ ...p, garmin_connected: false, garmin_email: null }));
  }

  async function handleSync() {
    if (!athleteId) return;
    setSyncing(true);
    setSyncMsg("");
    try {
      await api.post(`/athlete/${athleteId}/sync`);
      setSyncMsg("Sync started — data will update in the background.");
    } catch {
      setSyncMsg("Sync failed. Check the backend logs.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "24px 16px", fontFamily: "sans-serif" }}>
      <h1 style={{ marginBottom: 24 }}>Settings</h1>

      <Section title="Strava">
        {profile.strava_connected ? (
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontSize: 14, color: "#065f46", background: "#d1fae5", padding: "6px 12px", borderRadius: 999, fontWeight: 600 }}>
              ✓ Connected{name ? ` as ${name}` : ""}
            </span>
            <button onClick={logout} style={ghostBtn}>Disconnect</button>
          </div>
        ) : (
          <>
            <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 12 }}>
              Connect your Strava account to start syncing activity data.
            </p>
            <button
              onClick={() => { window.location.href = "/api/auth/strava/login"; }}
              style={{ background: "#FC4C02", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", cursor: "pointer", fontWeight: 600, fontSize: 14 }}
            >
              Connect Strava
            </button>
          </>
        )}
      </Section>

      <Section title={athleteId ? "Garmin Connect" : "Sign in with Garmin"}>
        {!athleteId && (
          <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 12 }}>
            No Strava account? You can sign in using your Garmin Connect credentials instead.
          </p>
        )}
        {profile.garmin_connected ? (
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontSize: 14, color: "#065f46", background: "#d1fae5", padding: "6px 12px", borderRadius: 999, fontWeight: 600 }}>
              ✓ Connected{profile.garmin_email ? ` as ${profile.garmin_email}` : ""}
            </span>
            <button onClick={handleGarminDisconnect} style={ghostBtn}>Disconnect</button>
          </div>
        ) : (
          <form onSubmit={handleGarminConnect} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ fontSize: 13, color: "#6b7280", margin: 0 }}>
              Uses your Garmin Connect login to pull HRV, sleep, and wellness data.
              Your password is encrypted before storage.
            </p>
            <Field
              label="Garmin email"
              value={garminEmail}
              onChange={setGarminEmail}
              placeholder="you@example.com"
            />
            <Field
              label="Garmin password"
              value={garminPassword}
              onChange={setGarminPassword}
              type="password"
              placeholder="••••••••"
            />
            {garminStatus === "error" && (
              <p style={{ fontSize: 13, color: "#dc2626", margin: 0 }}>{garminError}</p>
            )}
            <div>
              <button
                type="submit"
                disabled={garminStatus === "loading"}
                style={{ ...primaryBtn, opacity: garminStatus === "loading" ? 0.6 : 1 }}
              >
                {garminStatus === "loading" ? "Connecting…" : "Connect Garmin"}
              </button>
            </div>
          </form>
        )}
      </Section>

      {athleteId && (
        <Section title="Sync Data">
          <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 12 }}>
            Pull the latest activities and wellness data from your connected sources.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={handleSync} disabled={syncing} style={{ ...primaryBtn, opacity: syncing ? 0.6 : 1 }}>
              {syncing ? "Starting…" : "Sync Now"}
            </button>
            {syncMsg && <span style={{ fontSize: 13, color: syncMsg.includes("failed") ? "#dc2626" : "#065f46" }}>{syncMsg}</span>}
          </div>
        </Section>
      )}

      {athleteId && (
        <Section title="Training Profile">
          <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field
              label="Threshold HR (bpm)"
              hint="Your lactate threshold heart rate — used to calculate TSS"
              value={profile.threshold_hr ?? ""}
              onChange={(v) => setProfile((p) => ({ ...p, threshold_hr: v ? parseInt(v) : null }))}
              type="number"
              placeholder="e.g. 168"
            />
            <Field
              label="Max HR (bpm)"
              value={profile.max_hr ?? ""}
              onChange={(v) => setProfile((p) => ({ ...p, max_hr: v ? parseInt(v) : null }))}
              type="number"
              placeholder="e.g. 192"
            />
            <Field
              label="Goal"
              value={profile.goal ?? ""}
              onChange={(v) => setProfile((p) => ({ ...p, goal: v || null }))}
              placeholder="e.g. sub-3:30 marathon"
            />
            <Field
              label="Target Race"
              value={profile.target_race ?? ""}
              onChange={(v) => setProfile((p) => ({ ...p, target_race: v || null }))}
              placeholder="e.g. Boston 2026"
            />
            <Field
              label="Target CTL (fitness goal)"
              hint="Sets a goal line on the Performance Management Chart"
              value={profile.target_ctl ?? ""}
              onChange={(v) => setProfile((p) => ({ ...p, target_ctl: v ? parseInt(v) : null }))}
              type="number"
              placeholder="e.g. 70"
            />
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button type="submit" style={primaryBtn}>Save</button>
              {saved && <span style={{ fontSize: 13, color: "#065f46" }}>✓ Saved</span>}
            </div>
          </form>
        </Section>
      )}
    </div>
  );
}

function Field({
  label, hint, value, onChange, type = "text", placeholder,
}: {
  label: string;
  hint?: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4, color: "#374151" }}>
        {label}
      </label>
      {hint && <p style={{ fontSize: 12, color: "#9ca3af", margin: "0 0 4px" }}>{hint}</p>}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, boxSizing: "border-box" }}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>{title}</h2>
      {children}
    </div>
  );
}

const ghostBtn: React.CSSProperties = {
  background: "none", border: "1px solid #d1d5db", borderRadius: 6,
  padding: "6px 12px", cursor: "pointer", fontSize: 13, color: "#374151",
};

const primaryBtn: React.CSSProperties = {
  background: "#3B8BD4", color: "#fff", border: "none", borderRadius: 6,
  padding: "8px 18px", cursor: "pointer", fontWeight: 600, fontSize: 14,
};
