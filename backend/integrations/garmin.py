"""
Garmin Connect API integration.

NOTE: Garmin's Health API requires approval via the Garmin Developer Program:
https://developer.garmin.com/gc-developer-program/overview/

Until approved, this module cannot be used in production. The interface is defined
here so that other services can program against it, with actual requests stubbed out.
"""

from datetime import date
from typing import Any

import httpx

from config import settings

GARMIN_BASE = "https://apis.garmin.com"

# Shared OAuth2 client — populated after token exchange
_access_token: str | None = None


def set_access_token(token: str) -> None:
    global _access_token
    _access_token = token


def _auth_headers() -> dict[str, str]:
    if not _access_token:
        raise RuntimeError("Garmin access token not set — complete OAuth flow first")
    return {"Authorization": f"Bearer {_access_token}"}


async def fetch_hrv_data(
    user_id: str, start: date, end: date
) -> list[dict[str, Any]]:
    """Fetch HRV (RMSSD) readings for a date range."""
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{GARMIN_BASE}/wellness-api/rest/heartRateVariability/{user_id}",
            headers=_auth_headers(),
            params={"startDate": start.isoformat(), "endDate": end.isoformat()},
        )
        response.raise_for_status()
        return response.json()


async def fetch_daily_wellness(
    user_id: str, start: date, end: date
) -> list[dict[str, Any]]:
    """Fetch sleep score, stress, and body battery for a date range."""
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{GARMIN_BASE}/wellness-api/rest/dailies/{user_id}",
            headers=_auth_headers(),
            params={"startDate": start.isoformat(), "endDate": end.isoformat()},
        )
        response.raise_for_status()
        return response.json()


async def fetch_activity_details(activity_id: str) -> dict[str, Any]:
    """Fetch detailed biometric data for a specific activity."""
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{GARMIN_BASE}/activity-service/activity/{activity_id}/details",
            headers=_auth_headers(),
        )
        response.raise_for_status()
        return response.json()
