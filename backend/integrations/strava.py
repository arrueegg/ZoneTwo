from urllib.parse import urlencode
from datetime import datetime
from typing import Any

import httpx

from config import settings

STRAVA_AUTH_URL = "https://www.strava.com/oauth/authorize"
STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token"
STRAVA_API_BASE = "https://www.strava.com/api/v3"

SCOPES = "activity:read_all,profile:read_all"


def get_auth_url(athlete_id: str) -> str:
    params = {
        "client_id": settings.strava_client_id,
        "redirect_uri": settings.strava_redirect_uri,
        "response_type": "code",
        "scope": SCOPES,
        "state": athlete_id,
    }
    return f"{STRAVA_AUTH_URL}?{urlencode(params)}"


async def exchange_code(code: str) -> dict[str, Any]:
    """Exchange auth code for access + refresh tokens."""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            STRAVA_TOKEN_URL,
            data={
                "client_id": settings.strava_client_id,
                "client_secret": settings.strava_client_secret,
                "code": code,
                "grant_type": "authorization_code",
            },
        )
        response.raise_for_status()
        return response.json()


async def refresh_access_token(refresh_token: str) -> dict[str, Any]:
    """Get a new access token using the stored refresh token."""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            STRAVA_TOKEN_URL,
            data={
                "client_id": settings.strava_client_id,
                "client_secret": settings.strava_client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
        )
        response.raise_for_status()
        return response.json()


async def fetch_athlete_profile(access_token: str) -> dict[str, Any]:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{STRAVA_API_BASE}/athlete",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        response.raise_for_status()
        return response.json()


async def fetch_activities(
    access_token: str, after: int | None = None, page: int = 1
) -> list[dict[str, Any]]:
    """
    Fetch paginated activities from Strava.
    after: Unix timestamp — only return activities after this time (for incremental sync).
    """
    params: dict[str, Any] = {"per_page": 200, "page": page}
    if after is not None:
        params["after"] = after

    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{STRAVA_API_BASE}/athlete/activities",
            headers={"Authorization": f"Bearer {access_token}"},
            params=params,
        )
        response.raise_for_status()
        return response.json()


def normalize_activity(raw: dict[str, Any], athlete_id: str) -> dict[str, Any]:
    """
    Map a raw Strava activity to our unified Activity schema.
    Returns a dict ready for DB upsert.
    """
    start_time = datetime.fromisoformat(raw["start_date"].replace("Z", "+00:00"))

    hr_zones: dict[str, int] | None = None
    if raw.get("laps"):
        # Strava doesn't provide HR zone breakdown at the summary level;
        # this would require a separate detail call — left as a future enhancement.
        pass

    return {
        "id": f"strava_{raw['id']}",
        "athlete_id": athlete_id,
        "source": "strava",
        "sport_type": raw.get("sport_type", raw.get("type", "unknown")).lower(),
        "start_time": start_time,
        "duration_sec": raw.get("moving_time"),
        "distance_m": raw.get("distance"),
        "elevation_m": raw.get("total_elevation_gain"),
        "avg_hr": raw.get("average_heartrate"),
        "max_hr": raw.get("max_heartrate"),
        "hr_zones": hr_zones,
        "avg_pace_sec_km": _pace_from_speed(raw.get("average_speed")),
        "normalized_power": raw.get("weighted_average_watts"),
        "tss": None,  # calculated separately
        "raw_data": raw,
    }


def _pace_from_speed(speed_m_s: float | None) -> float | None:
    """Convert m/s to seconds per km."""
    if not speed_m_s or speed_m_s == 0:
        return None
    return 1000 / speed_m_s
