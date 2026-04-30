"""
SQLAlchemy 2.x models for Birdie.

Notes:
- All location columns use PostGIS Geometry types with SRID 4326 (WGS84).
- Round → Score / Shot use ON DELETE CASCADE so a hard-delete of a round
  also wipes its scores and shots, which is what the user wants for cleanup.
- The first registered user is auto-promoted to admin in routes/auth.py.
"""
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase, relationship
from geoalchemy2 import Geometry


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


# ─── Users ──────────────────────────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    full_name = Column(String(120), nullable=False, default="")
    hashed_password = Column(String(255), nullable=False)
    is_admin = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True)
    handicap_index = Column(Float, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)

    rounds = relationship("Round", back_populates="user", cascade="all, delete-orphan")


# ─── Courses & Holes ────────────────────────────────────────────────────────
class Course(Base):
    __tablename__ = "courses"

    id = Column(Integer, primary_key=True)
    osm_id = Column(String(64), unique=True, nullable=True, index=True)
    name = Column(String(255), nullable=False)
    city = Column(String(120), nullable=True)
    country = Column(String(120), nullable=True)
    location = Column(Geometry("POINT", srid=4326), nullable=True)
    total_holes = Column(Integer, nullable=False, default=18)
    par = Column(Integer, nullable=False, default=72)
    course_rating = Column(Float, nullable=True)
    slope_rating = Column(Float, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)

    holes = relationship(
        "Hole",
        back_populates="course",
        cascade="all, delete-orphan",
        order_by="Hole.number",
    )
    rounds = relationship("Round", back_populates="course")


class Hole(Base):
    __tablename__ = "holes"

    id = Column(Integer, primary_key=True)
    course_id = Column(Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True)
    number = Column(Integer, nullable=False)
    par = Column(Integer, nullable=False, default=4)
    handicap_index = Column(Integer, nullable=True)
    distance_yards = Column(Integer, nullable=True)

    tee_location = Column(Geometry("POINT", srid=4326), nullable=True)
    pin_location = Column(Geometry("POINT", srid=4326), nullable=True)
    hole_line = Column(Geometry("LINESTRING", srid=4326), nullable=True)
    fairway_polygon = Column(Geometry("POLYGON", srid=4326), nullable=True)
    green_polygon = Column(Geometry("POLYGON", srid=4326), nullable=True)

    course = relationship("Course", back_populates="holes")


# ─── Rounds, Scores, Shots ──────────────────────────────────────────────────
class Round(Base):
    __tablename__ = "rounds"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    course_id = Column(Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True)
    started_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    is_complete = Column(Boolean, nullable=False, default=False)
    tee_colour = Column(String(20), nullable=False, default="white")
    handicap_differential = Column(Float, nullable=True)
    notes = Column(Text, nullable=True)

    user = relationship("User", back_populates="rounds")
    course = relationship("Course", back_populates="rounds")
    scores = relationship(
        "Score",
        back_populates="round",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    shots = relationship(
        "Shot",
        back_populates="round",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class Score(Base):
    __tablename__ = "scores"

    id = Column(Integer, primary_key=True)
    round_id = Column(Integer, ForeignKey("rounds.id", ondelete="CASCADE"), nullable=False, index=True)
    hole_id = Column(Integer, ForeignKey("holes.id", ondelete="CASCADE"), nullable=False, index=True)
    strokes = Column(Integer, nullable=False)
    putts = Column(Integer, nullable=True)
    fairway_hit = Column(Boolean, nullable=True)
    green_in_regulation = Column(Boolean, nullable=True)
    penalty_strokes = Column(Integer, nullable=False, default=0)
    notes = Column(Text, nullable=True)

    round = relationship("Round", back_populates="scores")


class Shot(Base):
    __tablename__ = "shots"

    id = Column(Integer, primary_key=True)
    round_id = Column(Integer, ForeignKey("rounds.id", ondelete="CASCADE"), nullable=False, index=True)
    hole_id = Column(Integer, ForeignKey("holes.id", ondelete="CASCADE"), nullable=False, index=True)
    shot_number = Column(Integer, nullable=False)
    location = Column(Geometry("POINT", srid=4326), nullable=False)
    landing_location = Column(Geometry("POINT", srid=4326), nullable=True)
    club = Column(String(20), nullable=True)
    shot_type = Column(String(20), nullable=True)
    distance_yards = Column(Float, nullable=True)
    is_penalty = Column(Boolean, nullable=False, default=False)
    recorded_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)

    round = relationship("Round", back_populates="shots")
