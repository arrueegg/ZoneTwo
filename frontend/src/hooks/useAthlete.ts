import { useState, useEffect } from "react";
import api from "../api/client";

const ATHLETE_ID_KEY = "zonetwo_athlete_id";
const ATHLETE_NAME_KEY = "zonetwo_athlete_name";

export function useAthlete() {
  const [athleteId, setAthleteId] = useState<string | null>(
    () => localStorage.getItem(ATHLETE_ID_KEY)
  );
  const [name, setName] = useState<string | null>(
    () => localStorage.getItem(ATHLETE_NAME_KEY)
  );

  useEffect(() => {
    // Pick up athlete_id from URL after Strava OAuth redirect
    const params = new URLSearchParams(window.location.search);
    const id = params.get("athlete_id");
    const n = params.get("name");
    if (id) {
      localStorage.setItem(ATHLETE_ID_KEY, id);
      setAthleteId(id);
    }
    if (n) {
      localStorage.setItem(ATHLETE_NAME_KEY, n);
      setName(n);
    }
    if (id || n) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Verify the stored athlete ID still exists in the backend.
  // If the DB was reset, clear localStorage so the user sees the connect prompt.
  useEffect(() => {
    if (!athleteId) return;
    api.get(`/athlete/${athleteId}`).catch((err) => {
      if (err?.response?.status === 404) {
        logout();
      }
    });
  }, [athleteId]);

  function logout() {
    localStorage.removeItem(ATHLETE_ID_KEY);
    localStorage.removeItem(ATHLETE_NAME_KEY);
    setAthleteId(null);
    setName(null);
  }

  return { athleteId, name, logout };
}
