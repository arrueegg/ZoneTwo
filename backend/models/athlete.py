from sqlalchemy import Column, String, Integer, Float, DateTime, JSON
from sqlalchemy.sql import func

from database import Base


class Athlete(Base):
    __tablename__ = "athletes"

    id = Column(String, primary_key=True)  # e.g. "strava_12345678"
    name = Column(String, nullable=False)
    email = Column(String)
    gender = Column(String)  # "M" or "F"
    age = Column(Integer)
    weight_kg = Column(Float)
    max_hr = Column(Integer)
    threshold_hr = Column(Integer)  # lactate threshold HR for TSS calculation
    weekly_km = Column(Float)       # recent weekly volume, updated on sync
    vo2max = Column(Float)
    fitness_age = Column(Integer)
    race_predictions = Column(JSON)  # {\"5k\": secs, \"10k\": secs, ...}

    # Training goals
    goal = Column(String)           # e.g. "marathon sub-3:30"
    target_race = Column(String)    # e.g. "Boston 2025"
    target_ctl = Column(Integer)    # target fitness (CTL) to display as goal line on PMC

    # Strava OAuth tokens
    strava_athlete_id = Column(String, unique=True)
    strava_access_token = Column(String)
    strava_refresh_token = Column(String)
    strava_token_expires_at = Column(Integer)
    last_strava_sync = Column(DateTime)

    # Garmin (unofficial, session-based)
    garmin_email = Column(String)
    garmin_password_encrypted = Column(String)  # encrypted with SECRET_KEY

    # Cached AI weekly summary (regenerated at most once per week)
    ai_summary = Column(String)
    ai_summary_generated_at = Column(DateTime)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
