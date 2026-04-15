from sqlalchemy import Column, String, Float, Integer, DateTime, JSON

from database import Base


class Activity(Base):
    __tablename__ = "activities"

    id = Column(String, primary_key=True)   # e.g. "strava_123456"
    athlete_id = Column(String, nullable=False, index=True)
    source = Column(String)                  # "strava" or "garmin"
    sport_type = Column(String)              # run, ride, swim, etc.
    start_time = Column(DateTime, nullable=False)  # TimescaleDB partition key

    duration_sec = Column(Integer)
    distance_m = Column(Float)
    elevation_m = Column(Float)

    # Heart rate
    avg_hr = Column(Float)
    max_hr = Column(Float)
    hr_zones = Column(JSON)                 # {"z1": 300, "z2": 1200, ...} seconds per zone

    # Performance
    avg_pace_sec_km = Column(Float)
    normalized_power = Column(Float)         # for cycling with power meter
    tss = Column(Float)                      # Training Stress Score

    # Training effect
    aerobic_effect = Column(Float)          # Garmin aerobic training effect (0–5)
    anaerobic_effect = Column(Float)        # Garmin anaerobic training effect (0–5)
    training_effect_label = Column(String)  # e.g. "BASE", "TEMPO", "THRESHOLD"
    avg_cadence = Column(Float)             # steps/min (run) or rpm (ride)
    vo2max_estimated = Column(Float)        # per-activity VO2max estimate from Garmin

    # Enriched from Garmin
    hrv_rmssd = Column(Float)               # morning HRV reading on activity date
    sleep_score = Column(Float)
    body_battery = Column(Float)

    raw_data = Column(JSON)                 # original API response
