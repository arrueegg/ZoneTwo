from sqlalchemy import Column, String, Float, Integer, Date, DateTime
from sqlalchemy.sql import func

from database import Base


class TrainingEvent(Base):
    """User-created event or target run used for preparation planning."""

    __tablename__ = "training_events"

    id = Column(String, primary_key=True)
    athlete_id = Column(String, nullable=False, index=True)

    name = Column(String, nullable=False)
    event_date = Column(Date, nullable=False, index=True)
    event_type = Column(String, nullable=False, default="race")
    target_distance_km = Column(Float)
    target_time_sec = Column(Float)
    priority = Column(String, nullable=False, default="B")
    notes = Column(String)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class PlannedWorkout(Base):
    """Persisted planned workout generated from or edited within a preparation plan."""

    __tablename__ = "planned_workouts"

    id = Column(String, primary_key=True)
    event_id = Column(String, nullable=False, index=True)
    athlete_id = Column(String, nullable=False, index=True)

    week = Column(Integer, nullable=False)
    planned_date = Column(Date, nullable=False, index=True)
    workout_type = Column(String, nullable=False)
    title = Column(String, nullable=False)
    description = Column(String)
    distance_km = Column(Float)
    status = Column(String, nullable=False, default="planned")
    notes = Column(String)
    sort_order = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
