"""
Rounds API — start a round, score each hole, finish, list history,
hard-delete (cascades to scores + shots).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Course, Hole, Round, Score, User
from routes.auth import get_current_user

router = APIRouter()


# ─── Schemas ────────────────────────────────────────────────────────────────
class StartRoundRequest(BaseModel):
    course_id: int
    tee_colour: str = "white"


class HoleScoreRequest(BaseModel):
    hole_number: int
    strokes: int
    putts: Optional[int] = None
    fairway_hit: Optional[bool] = None
    green_in_regulation: Optional[bool] = None
    penalty_strokes: int = 0


class HoleScoreOut(BaseModel):
    hole_number: int
    strokes: int
    putts: Optional[int] = None
    fairway_hit: Optional[bool] = None
    green_in_regulation: Optional[bool] = None
    penalty_strokes: int = 0


class RoundOut(BaseModel):
    id: int
    course_id: int
    course_name: str
    started_at: datetime
    finished_at: Optional[datetime] = None
    is_complete: bool
    tee_colour: str
    total_strokes: int
    course_par: int
    score_to_par: int
    handicap_differential: Optional[float] = None
    scores: list[HoleScoreOut] = []


def _round_to_out(round_: Round, course: Course, scores_by_hole: dict[int, Score], hole_number_by_id: dict[int, int]) -> RoundOut:
    score_list: list[HoleScoreOut] = []
    total = 0
    for hole_id, sc in scores_by_hole.items():
        n = hole_number_by_id.get(hole_id)
        if n is None:
            continue
        total += sc.strokes
        score_list.append(
            HoleScoreOut(
                hole_number=n,
                strokes=sc.strokes,
                putts=sc.putts,
                fairway_hit=sc.fairway_hit,
                green_in_regulation=sc.green_in_regulation,
                penalty_strokes=sc.penalty_strokes,
            )
        )
    score_list.sort(key=lambda s: s.hole_number)
    return RoundOut(
        id=round_.id,
        course_id=course.id,
        course_name=course.name,
        started_at=round_.started_at,
        finished_at=round_.finished_at,
        is_complete=round_.is_complete,
        tee_colour=round_.tee_colour,
        total_strokes=total,
        course_par=course.par,
        score_to_par=total - course.par if total else 0,
        handicap_differential=round_.handicap_differential,
        scores=score_list,
    )


async def _load_round(db: AsyncSession, round_id: int, user: User) -> tuple[Round, Course, dict[int, Score], dict[int, int]]:
    round_ = await db.get(Round, round_id)
    if round_ is None or round_.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Round not found")
    course = await db.get(Course, round_.course_id)
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found")

    holes_res = await db.execute(select(Hole).where(Hole.course_id == course.id))
    hole_number_by_id = {h.id: h.number for h in holes_res.scalars().all()}

    scores_res = await db.execute(select(Score).where(Score.round_id == round_.id))
    scores_by_hole = {s.hole_id: s for s in scores_res.scalars().all()}
    return round_, course, scores_by_hole, hole_number_by_id


# ─── Routes ─────────────────────────────────────────────────────────────────
@router.post("/", response_model=RoundOut, status_code=201)
async def start_round(
    payload: StartRoundRequest,
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    course = await db.get(Course, payload.course_id)
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found")
    round_ = Round(
        user_id=current.id,
        course_id=course.id,
        tee_colour=payload.tee_colour,
    )
    db.add(round_)
    await db.commit()
    await db.refresh(round_)
    _, course, scores_by_hole, hole_number_by_id = await _load_round(db, round_.id, current)
    return _round_to_out(round_, course, scores_by_hole, hole_number_by_id)


@router.get("/", response_model=list[RoundOut])
async def list_my_rounds(
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    res = await db.execute(
        select(Round).where(Round.user_id == current.id).order_by(Round.started_at.desc())
    )
    out: list[RoundOut] = []
    for r in res.scalars().all():
        _, course, scores_by_hole, hole_number_by_id = await _load_round(db, r.id, current)
        out.append(_round_to_out(r, course, scores_by_hole, hole_number_by_id))
    return out


@router.get("/{round_id}", response_model=RoundOut)
async def get_round(
    round_id: int,
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    round_, course, scores_by_hole, hole_number_by_id = await _load_round(db, round_id, current)
    return _round_to_out(round_, course, scores_by_hole, hole_number_by_id)


@router.put("/{round_id}/score", response_model=RoundOut)
async def upsert_hole_score(
    round_id: int,
    payload: HoleScoreRequest,
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    round_ = await db.get(Round, round_id)
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

    existing = await db.execute(
        select(Score).where(Score.round_id == round_.id, Score.hole_id == hole.id)
    )
    score = existing.scalar_one_or_none()
    if score is None:
        score = Score(
            round_id=round_.id,
            hole_id=hole.id,
            strokes=payload.strokes,
        )
        db.add(score)
    else:
        score.strokes = payload.strokes
    score.putts = payload.putts
    score.fairway_hit = payload.fairway_hit
    score.green_in_regulation = payload.green_in_regulation
    score.penalty_strokes = payload.penalty_strokes
    await db.commit()

    _, course, scores_by_hole, hole_number_by_id = await _load_round(db, round_id, current)
    return _round_to_out(round_, course, scores_by_hole, hole_number_by_id)


@router.post("/{round_id}/finish", response_model=RoundOut)
async def finish_round(
    round_id: int,
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    round_, course, scores_by_hole, hole_number_by_id = await _load_round(db, round_id, current)
    round_.is_complete = True
    round_.finished_at = datetime.now(timezone.utc)
    # WHS handicap differential — placeholder (course rating may be None)
    if course.course_rating and course.slope_rating:
        gross = sum(s.strokes for s in scores_by_hole.values())
        if gross > 0:
            round_.handicap_differential = (
                113 / course.slope_rating
            ) * (gross - course.course_rating)
    await db.commit()
    await db.refresh(round_)
    _, course, scores_by_hole, hole_number_by_id = await _load_round(db, round_id, current)
    return _round_to_out(round_, course, scores_by_hole, hole_number_by_id)


@router.delete("/{round_id}", status_code=204)
async def delete_round(
    round_id: int,
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Hard-delete the round and (via FK cascade) its scores and shots."""
    round_ = await db.get(Round, round_id)
    if round_ is None or round_.user_id != current.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Round not found")
    await db.delete(round_)
    await db.commit()
    return None
