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

const NAV_STYLE: React.CSSProperties = {
  display: "flex",
  gap: 24,
  padding: "12px 24px",
  borderBottom: "1px solid #e5e7eb",
  fontFamily: "sans-serif",
  fontSize: 14,
  alignItems: "center",
};

function App() {
  const athlete = useAthlete();

  return (
    <AthleteContext.Provider value={athlete}>
      <BrowserRouter>
        <nav style={NAV_STYLE}>
          <strong style={{ marginRight: 8 }}>ZoneTwo</strong>
          <NavLink to="/" end style={navStyle}>Dashboard</NavLink>
          <NavLink to="/activities" style={navStyle}>Activities</NavLink>
          <NavLink to="/preparation" style={navStyle}>Preparation</NavLink>
          <NavLink to="/wellness" style={navStyle}>Wellness</NavLink>
          <NavLink to="/coach" style={navStyle}>Coach</NavLink>
          <NavLink to="/settings" style={navStyle}>Settings</NavLink>
          {athlete.name && (
            <span style={{ marginLeft: "auto", color: "#6b7280" }}>
              {athlete.name}
            </span>
          )}
        </nav>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/activities" element={<Activities />} />
          <Route path="/activities/:activityId" element={<ActivityDetail />} />
          <Route path="/preparation" element={<Preparation />} />
          <Route path="/wellness" element={<Wellness />} />
          <Route path="/coach" element={<Coach />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </BrowserRouter>
    </AthleteContext.Provider>
  );
}

function navStyle({ isActive }: { isActive: boolean }): React.CSSProperties {
  return { color: isActive ? "#3B8BD4" : "#374151", textDecoration: "none" };
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
