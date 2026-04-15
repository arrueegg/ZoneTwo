from sqlalchemy import Column, String, DateTime, JSON

from database import Base


class ActivityTrack(Base):
    """GPS track + intraday sensor data for a single activity."""

    __tablename__ = "activity_tracks"

    activity_id = Column(String, primary_key=True)  # matches Activity.id
    downloaded_at = Column(DateTime, nullable=False)

    # Array of {lat, lon, ele, time, hr, cadence, pace_sec_km} objects
    # Sampled at ~1-second resolution from the Garmin GPX export.
    points = Column(JSON, nullable=False)

    # Per-km (or per-mile) splits from Garmin
    splits = Column(JSON)  # [{distance_m, duration_sec, avg_hr, avg_pace, elevation_gain}]
