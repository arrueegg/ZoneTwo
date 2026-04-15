from sqlalchemy import Column, String, Float, Date, UniqueConstraint

from database import Base


class DailyMetrics(Base):
    """Pre-computed ATL/CTL/TSB snapshot per athlete per day."""

    __tablename__ = "daily_metrics"
    __table_args__ = (UniqueConstraint("athlete_id", "date", name="uq_athlete_date"),)

    id = Column(String, primary_key=True)   # f"{athlete_id}_{date}"
    athlete_id = Column(String, nullable=False, index=True)
    date = Column(Date, nullable=False)

    # Core load metrics
    daily_tss = Column(Float, default=0.0)
    ctl = Column(Float)                     # Chronic Training Load (fitness)
    atl = Column(Float)                     # Acute Training Load (fatigue)
    tsb = Column(Float)                     # Training Stress Balance (form)

    # Composite score
    readiness_score = Column(Float)         # 0–100, computed from wellness signals

    # Wellness — from Garmin
    hrv_rmssd = Column(Float)           # lastNightAvg HRV (ms)
    resting_hr = Column(Float)
    sleep_hours = Column(Float)         # total sleep in hours
    body_battery_high = Column(Float)   # peak body battery during the day
    body_battery_low = Column(Float)    # lowest body battery
    body_battery_wake = Column(Float)   # body battery at wake time
    steps = Column(Float)
    stress_avg = Column(Float)
    spo2_avg = Column(Float)
    respiration_avg = Column(Float)

    # Sleep stages (from Garmin sleep data)
    sleep_score = Column(Float)          # Garmin overall sleep quality score (0–100)
    sleep_deep_seconds = Column(Float)
    sleep_light_seconds = Column(Float)
    sleep_rem_seconds = Column(Float)
    sleep_awake_seconds = Column(Float)  # awake time during sleep window

    # Garmin-derived performance metrics
    training_status = Column(String)     # e.g. "PRODUCTIVE", "MAINTAINING", "RECOVERY"
    endurance_score = Column(Float)
    training_readiness_score = Column(Float)        # Garmin combined readiness (0–100)
    training_readiness_description = Column(String) # e.g. "READY", "FAIR", "NOT_READY"
