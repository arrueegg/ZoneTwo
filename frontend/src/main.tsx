import React, { createContext, useContext } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dashboard } from "./pages/Dashboard";
import { Activities } from "./pages/Activities";
import { ActivityDetail } from "./pages/ActivityDetail";
import { Wellness } from "./pages/Wellness";
import { Settings } from "./pages/Settings";
import { Coach } from "./pages/Coach";
import { Preparation } from "./pages/Preparation";
import { useAthlete } from "./hooks/useAthlete";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1 },
  },
});

interface AthleteCtx {
  athleteId: string | null;
  name: string | null;
  logout: () => void;
}

export const AthleteContext = createContext<AthleteCtx>({
  athleteId: null,
  name: null,
  logout: () => {},
});

export function useAthleteContext() {
  return useContext(AthleteContext);
}

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/activities", label: "Activities" },
  { to: "/preparation", label: "Preparation" },
  { to: "/wellness", label: "Recovery" },
  { to: "/coach", label: "Coach" },
  { to: "/settings", label: "Settings" },
];

function App() {
  const athlete = useAthlete();

  return (
    <AthleteContext.Provider value={athlete}>
      <BrowserRouter>
        <div style={APP_SHELL}>
          <aside style={SIDEBAR}>
            <div style={BRAND_CARD}>
              <span style={BRAND_MARK}>Z2</span>
              <div>
                <strong style={{ display: "block", fontSize: 18 }}>ZoneTwo</strong>
                <span style={{ color: "#6b7280", fontSize: 12 }}>Training cockpit</span>
              </div>
            </div>
            <nav style={NAV_LIST}>
              {NAV_ITEMS.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} style={navStyle}>
                  {item.label}
                </NavLink>
              ))}
            </nav>
            {athlete.name && (
              <div style={ATHLETE_CARD}>
                <span style={{ color: "#6b7280", fontSize: 12 }}>Athlete</span>
                <strong>{athlete.name}</strong>
              </div>
            )}
          </aside>
          <div style={CONTENT_SHELL}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/activities" element={<Activities />} />
              <Route path="/activities/:activityId" element={<ActivityDetail />} />
              <Route path="/preparation" element={<Preparation />} />
              <Route path="/wellness" element={<Wellness />} />
              <Route path="/coach" element={<Coach />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </div>
        </div>
      </BrowserRouter>
    </AthleteContext.Provider>
  );
}

function navStyle({ isActive }: { isActive: boolean }): React.CSSProperties {
  return {
    color: isActive ? "#0f766e" : "#374151",
    textDecoration: "none",
    border: `1px solid ${isActive ? "#99f6e4" : "transparent"}`,
    borderLeft: `4px solid ${isActive ? "#14b8a6" : "transparent"}`,
    background: isActive ? "#f0fdfa" : "transparent",
    borderRadius: 8,
    padding: "10px 12px",
    fontWeight: isActive ? 700 : 600,
  };
}

const APP_SHELL: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  background: "linear-gradient(135deg, #f7fbff 0%, #f8fafc 42%, #f0fdfa 100%)",
  fontFamily: "sans-serif",
};

const SIDEBAR: React.CSSProperties = {
  width: 226,
  flex: "0 0 226px",
  minHeight: "100vh",
  padding: 16,
  borderRight: "1px solid #dbeafe",
  background: "rgba(255, 255, 255, 0.88)",
  boxSizing: "border-box",
  position: "sticky",
  top: 0,
  alignSelf: "flex-start",
};

const BRAND_CARD: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: 12,
  border: "1px solid #ccfbf1",
  borderRadius: 8,
  background: "#ffffff",
  marginBottom: 16,
};

const BRAND_MARK: React.CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 8,
  background: "linear-gradient(135deg, #14b8a6, #3B8BD4)",
  color: "#fff",
  display: "grid",
  placeItems: "center",
  fontWeight: 800,
};

const NAV_LIST: React.CSSProperties = {
  display: "grid",
  gap: 6,
  fontSize: 14,
};

const ATHLETE_CARD: React.CSSProperties = {
  marginTop: 18,
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: 12,
  display: "grid",
  gap: 4,
  background: "#fff",
};

const CONTENT_SHELL: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
