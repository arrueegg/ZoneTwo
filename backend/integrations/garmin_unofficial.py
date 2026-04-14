"""
Garmin Connect integration via the unofficial garminconnect library.
Uses email/password session auth — no API approval required.

This is suitable for personal use. It can break when Garmin changes internal
endpoints, but the library is actively maintained and recovers quickly.
"""

import asyncio
from datetime import date
from typing import Any

from garminconnect import Garmin, GarminConnectAuthenticationError


def _login(email: str, password: str) -> Garmin:
    """Create and authenticate a Garmin session (blocking)."""
    client = Garmin(email=email, password=password)
    client.login()
    return client


async def get_client(email: str, password: str) -> Garmin:
    """Async wrapper around the blocking login call."""
    return await asyncio.to_thread(_login, email, password)


async def fetch_daily_wellness(
    email: str, password: str, start: date, end: date
) -> list[dict[str, Any]]:
    """
    Fetch daily wellness summary for each day in the range.
    Returns a list of dicts keyed by date string.
    """
    client = await get_client(email, password)

    results = []
    current = start
    from datetime import timedelta

    while current <= end:
        day_str = current.isoformat()
        try:
            data = await asyncio.to_thread(
                client.get_stats, day_str
            )
            results.append({"date": day_str, "data": data})
        except Exception as exc:
            # Skip days with no data rather than aborting the whole range
            print(f"[garmin] No wellness data for {day_str}: {exc}")
        current += timedelta(days=1)

    return results


async def fetch_hrv(
    email: str, password: str, start: date, end: date
) -> list[dict[str, Any]]:
    """Fetch HRV summary for each day in the range."""
    client = await get_client(email, password)

    results = []
    current = start
    from datetime import timedelta

    while current <= end:
        day_str = current.isoformat()
        try:
            data = await asyncio.to_thread(
                client.get_hrv_data, day_str
            )
            results.append({"date": day_str, "data": data})
        except Exception as exc:
            print(f"[garmin] No HRV data for {day_str}: {exc}")
        current += timedelta(days=1)

    return results


SPORT_TYPE_MAP: dict[int, str] = {
    1: "run",
    2: "ride",
    3: "swim",
    4: "multi_sport",
    5: "hiking",
    13: "strength",
    26: "yoga",
    29: "walk",
    63: "virtual_ride",
    89: "trail_run",
}


async def fetch_activities(
    email: str, password: str, start: date, end: date
) -> list[dict[str, Any]]:
    """Fetch all activities in the date range from Garmin Connect."""
    client = await get_client(email, password)

    all_activities = []
    offset = 0
    limit = 100

    while True:
        batch = await asyncio.to_thread(client.get_activities, offset, limit)
        if not batch:
            break
        for activity in batch:
            # Parse activity date
            act_date_str = activity.get("startTimeLocal", "")[:10]
            try:
                act_date = date.fromisoformat(act_date_str)
            except ValueError:
                continue
            if act_date < start:
                # Activities are returned newest-first; stop once we pass the range
                return all_activities
            if act_date <= end:
                all_activities.append(activity)
        offset += limit

    return all_activities


def normalize_garmin_activity(raw: dict[str, Any], athlete_id: str) -> dict[str, Any]:
    """Map a raw Garmin activity summary to our unified Activity schema."""
    from datetime import datetime

    start_str = raw.get("startTimeGMT", raw.get("startTimeLocal", ""))
    try:
        start_time = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
    except ValueError:
        start_time = None

    sport_type = SPORT_TYPE_MAP.get(raw.get("sportTypeId", 0), "other")

    # HR zones: Garmin gives seconds in each zone
    hr_zones = {
        "z1": raw.get("hrTimeInZone_1"),
        "z2": raw.get("hrTimeInZone_2"),
        "z3": raw.get("hrTimeInZone_3"),
        "z4": raw.get("hrTimeInZone_4"),
        "z5": raw.get("hrTimeInZone_5"),
    }
    # Only include if at least one zone has data
    if not any(v for v in hr_zones.values()):
        hr_zones = None

    # Garmin's activityTrainingLoad is their TSS equivalent
    tss = raw.get("activityTrainingLoad")

    avg_speed = raw.get("averageSpeed")
    avg_pace = (1000 / avg_speed) if avg_speed and avg_speed > 0 else None

    return {
        "id": f"garmin_{raw['activityId']}",
        "athlete_id": athlete_id,
        "source": "garmin",
        "sport_type": sport_type,
        "start_time": start_time,
        "duration_sec": int(raw["duration"]) if raw.get("duration") else None,
        "distance_m": raw.get("distance"),
        "elevation_m": raw.get("elevationGain"),
        "avg_hr": raw.get("averageHR"),
        "max_hr": raw.get("maxHR"),
        "hr_zones": hr_zones,
        "avg_pace_sec_km": avg_pace,
        "normalized_power": raw.get("normPower") or raw.get("avgPower"),
        "tss": round(tss, 1) if tss else None,
        "raw_data": {k: v for k, v in raw.items() if not isinstance(v, (dict, list))},
    }


def extract_daily_metrics(wellness: dict[str, Any], hrv: dict[str, Any] | None) -> dict[str, Any]:
    """
    Pull the fields we care about from raw Garmin wellness + HRV responses.
    Returns a flat dict ready to merge into DailyMetrics.
    """
    result: dict[str, Any] = {}

    if wellness:
        result["resting_hr"] = wellness.get("restingHeartRate")

        sleep_secs = wellness.get("sleepingSeconds")
        result["sleep_hours"] = round(sleep_secs / 3600, 2) if sleep_secs else None

        result["body_battery_high"] = wellness.get("bodyBatteryHighestValue")
        result["body_battery_low"] = wellness.get("bodyBatteryLowestValue")
        result["body_battery_wake"] = wellness.get("bodyBatteryAtWakeTime")

        result["steps"] = wellness.get("totalSteps")
        result["stress_avg"] = wellness.get("averageStressLevel")
        result["spo2_avg"] = wellness.get("averageSpo2")
        result["respiration_avg"] = wellness.get("avgWakingRespirationValue")

    if hrv:
        hrv_summary = hrv.get("hrvSummary", {})
        result["hrv_rmssd"] = (
            hrv_summary.get("lastNightAvg")
            or hrv_summary.get("rmssd")
            or hrv_summary.get("lastNight5MinHigh")
        )

    return result
