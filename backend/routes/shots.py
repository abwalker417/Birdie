"""
Shots API — log a shot (manual tap or GPS), list per hole, delete.

Distance from previous shot is computed via PostGIS ST_Distance with
coordinates inlined into SQL (asyncpg can't infer types for ST_GeomFromText
literal binds — that was the IndeterminateDatatypeError in the prior build).
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from geoalchemy2.shape import from_shape, to_shape
from pydantic import BaseModel
from shapely.geometry import Point
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Hole, Round, Shot, User
from routes.auth import get_current_user

router = APIRouter()

CLUBS = [
    "DR", "3W", "5W", "7W",
    "2i", "3i", "4i", "5i", "6i", "7i", "8i", "9i",
    "PW", "GW", "SW", "LW",
    "Putter",
]


# ─── Schemas ────────────────────────────────────────────────────────────────
class LogShotRequest(BaseModel):
    round_id: int
    hole_number: int
    lat: float
    lng: float
    club: Optional[str] = None
    shot_type: Optional[str] = None  # tee/fairway/chip/putt
    is_penalty: bool = False


class ShotOut(BaseModel):
    id: int
    shot_number: int
    hole_number: int
    lat: float
    lng: float
    club: Optional[str] = None
    shot_type: Optional[str] = None
    distance_yards: Optional[float] = None
    is_penalty: bool = False
    recorded_at: datetime


def _shot_to_out(shot: Shot, hole_number: int) -> ShotOut:
    pt = to_shape(shot.location)
    return ShotOut(
        id=shot.id,
        shot_number=shot.shot_number,
        hole_number=hole_number,
        lat=pt.y,
        lng=pt.x,
        club=shot.club,
        shot_type=shot.shot_type,
        distance_yards=shot.distance_yards,
        is_penalty=shot.is_penalty,
        recorded_at=shot.recorded_at,
    )


# ─── Routes ─────────────────────────────────────────────────────────────────
@router.get("/clubs")
def list_clubs(_: User = Depends(get_current_user)):
    return {"clubs": CLUBS}


@router.post("/", response_model=ShotOut, status_code=201)
async def log_shot(
    payload: LogShotRequest,
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    round_ = await db.get(Round, payload.round_id)
    if round_ is None or round_.user_id != current.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Round not found")
    if round_.is_complete:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Round is finished")

    hole_res = await db.execute(
        select(Hole).where(Hole.course_id == round_.course_id, Hole.number == payload.hole_number)
    )
    hole = hole_res.scalar_one_or_none()
    if hole is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hole not found")

    prior_res = await db.execute(
        select(Shot).where(Shot.round_id == round_.id, Shot.hole_id == hole.id).order_by(Shot.shot_number)
    )
    priors = list(prior_res.scalars().all())
    shot_number = len(priors) + 1

    distance_yards: Optional[float] = None
    if priors:
        prev = priors[-1]
        row = (
            await db.execute(
                text(
                    f"""
                    SELECT ST_Distance(
                      ST_SetSRID(ST_MakePoint({payload.lng}, {payload.lat}), 4326)::geography,
                      location::geography
                    ) * 1.09361 AS yards
                    FROM shots WHERE id = {prev.id}
                    """
                )
            )
        ).fetchone()
        if row and row.yards:
            distance_yards = round(float(row.yards), 1)
            prev.landing_location = from_shape(Point(payload.lng, payload.lat), srid=4326)
            prev.distance_yards = distance_yards

    shot = Shot(
        round_id=round_.id,
        hole_id=hole.id,
        shot_number=shot_number,
        location=from_shape(Point(payload.lng, payload.lat), srid=4326),
        club=payload.club,
        shot_type=payload.shot_type or ("tee" if shot_number == 1 else "fairway"),
        is_penalty=payload.is_penalty,
        distance_yards=distance_yards,
    )
    db.add(shot)
    await db.commit()
    await db.refresh(shot)
    return _shot_to_out(shot, payload.hole_number)


@router.get("/round/{round_id}/hole/{hole_number}", response_model=list[ShotOut])
async def list_shots_for_hole(
    round_id: int,
    hole_number: int,
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    round_ = await db.get(Round, round_id)
    if round_ is None or round_.user_id != current.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Round not found")
    hole_res = await db.execute(
        select(Hole).where(Hole.course_id == round_.course_id, Hole.number == hole_number)
    )
    hole = hole_res.scalar_one_or_none()
    if hole is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hole not found")
    res = await db.execute(
        select(Shot).where(Shot.round_id == round_id, Shot.hole_id == hole.id).order_by(Shot.shot_number)
    )
    return [_shot_to_out(s, hole_number) for s in res.scalars().all()]


@router.delete("/{shot_id}", status_code=204)
async def delete_shot(
    shot_id: int,
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    shot = await db.get(Shot, shot_id)
    if shot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Shot not found")
    round_ = await db.get(Round, shot.round_id)
    if round_ is None or round_.user_id != current.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your shot")
    await db.delete(shot)
    await db.commit()
    return None
