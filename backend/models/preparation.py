from sqlalchemy import Column, String, Float, Date, DateTime
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
