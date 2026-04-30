"""
Courses API — search nearby courses, import from OSM, expose hole geometry,
and admin endpoints to edit holes (point-and-line editor).
"""
from __future__ import annotations

import math
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from geoalchemy2.shape import from_shape, to_shape
from pydantic import BaseModel, Field
from shapely.geometry import LineString, Point, Polygon, mapping
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Course, Hole, User
from routes.auth import get_current_user, require_admin

router = APIRouter()

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OVERPASS_HEADERS = {
    "User-Agent": "BirdieGolfTracker/1.0 (self-hosted)",
    "Accept": "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
}


# ─── Schemas ────────────────────────────────────────────────────────────────
class CourseOut(BaseModel):
    id: Optional[int] = None
    osm_id: Optional[str] = None
    name: str
    city: Optional[str] = None
    country: Optional[str] = None
    total_holes: int = 18
    par: int = 72
    course_rating: Optional[float] = None
    slope_rating: Optional[float] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    is_imported: bool = False


class HoleOut(BaseModel):
    id: int
    number: int
    par: int
    handicap_index: Optional[int] = None
    distance_yards: Optional[int] = None
    tee_geojson: Optional[dict] = None
    pin_geojson: Optional[dict] = None
    hole_line_geojson: Optional[dict] = None
    fairway_geojson: Optional[dict] = None
    green_geojson: Optional[dict] = None


class HolePatch(BaseModel):
    par: Optional[int] = Field(default=None, ge=2, le=7)
    handicap_index: Optional[int] = Field(default=None, ge=1, le=18)
    tee_lat: Optional[float] = None
    tee_lng: Optional[float] = None
    pin_lat: Optional[float] = None
    pin_lng: Optional[float] = None


# ─── Helpers ────────────────────────────────────────────────────────────────
def _course_to_out(c: Course) -> CourseOut:
    lat = lng = None
    if c.location is not None:
        pt = to_shape(c.location)
        lat, lng = pt.y, pt.x
    return CourseOut(
        id=c.id,
        osm_id=c.osm_id,
        name=c.name,
        city=c.city,
        country=c.country,
        total_holes=c.total_holes,
        par=c.par,
        course_rating=c.course_rating,
        slope_rating=c.slope_rating,
        lat=lat,
        lng=lng,
        is_imported=True,
    )


def _hole_to_out(h: Hole) -> HoleOut:
    def gj(g):
        return mapping(to_shape(g)) if g is not None else None
    return HoleOut(
        id=h.id,
        number=h.number,
        par=h.par,
        handicap_index=h.handicap_index,
        distance_yards=h.distance_yards,
        tee_geojson=gj(h.tee_location),
        pin_geojson=gj(h.pin_location),
        hole_line_geojson=gj(h.hole_line),
        fairway_geojson=gj(h.fairway_polygon),
        green_geojson=gj(h.green_polygon),
    )


def _overpass_query(lat: float, lng: float, radius_m: int) -> str:
    return f"""
[out:json][timeout:30];
(
  way["leisure"="golf_course"](around:{radius_m},{lat},{lng});
  relation["leisure"="golf_course"](around:{radius_m},{lat},{lng});
);
out tags center bb;
"""


async def _fetch_osm_courses(lat: float, lng: float, radius_m: int) -> list[dict]:
    query = _overpass_query(lat, lng, radius_m)
    async with httpx.AsyncClient(timeout=35) as client:
        resp = await client.post(OVERPASS_URL, data={"data": query}, headers=OVERPASS_HEADERS)
        resp.raise_for_status()
    elements = resp.json().get("elements", [])
    out = []
    for el in elements:
        tags = el.get("tags", {}) or {}
        if tags.get("leisure") != "golf_course":
            continue
        # Resolve a centre
        clat = clng = None
        if "center" in el:
            clat, clng = el["center"]["lat"], el["center"]["lon"]
        elif "bounds" in el:
            b = el["bounds"]
            clat = (b["minlat"] + b["maxlat"]) / 2
            clng = (b["minlon"] + b["maxlon"]) / 2
        if clat is None:
            continue
        out.append(
            {
                "osm_id": f"{el['type']}/{el['id']}",
                "name": tags.get("name", "Unknown course"),
                "city": tags.get("addr:city"),
                "country": tags.get("addr:country"),
                "lat": clat,
                "lng": clng,
            }
        )
    return out


async def _fetch_osm_geometry(lat: float, lng: float, radius_m: int = 3000) -> list[dict]:
    """Fetch hole-related geometry around a course centre."""
    query = f"""
[out:json][timeout:30];
(
  way["leisure"="golf_hole"](around:{radius_m},{lat},{lng});
  way["golf"="hole"](around:{radius_m},{lat},{lng});
  way["golf"="tee"](around:{radius_m},{lat},{lng});
  way["golf"="green"](around:{radius_m},{lat},{lng});
  way["golf"="fairway"](around:{radius_m},{lat},{lng});
);
out geom;
"""
    async with httpx.AsyncClient(timeout=35) as client:
        try:
            resp = await client.post(OVERPASS_URL, data={"data": query}, headers=OVERPASS_HEADERS)
            resp.raise_for_status()
        except Exception:
            return []
    return resp.json().get("elements", [])


async def _import_holes(db: AsyncSession, course: Course, lat: float, lng: float) -> None:
    """
    Smart OSM hole parser:
      1. Pulls hole / tee / green / fairway elements within 3 km.
      2. Builds hole records from `leisure=golf_hole` / `golf=hole` ways
         (numbered or anonymous — anonymous ones get spatially walked from
         the course centre).
      3. If no hole ways exist but greens + tees do, pairs each green with
         its nearest tee polygon.
      4. Attaches matching green/fairway polygons.
      5. Computes `distance_yards` via PostGIS ST_Length on geography.
      6. Estimates par from distance when OSM didn't tag it.
      7. Falls back to a circular placeholder layout when OSM has nothing.
    """
    elements = await _fetch_osm_geometry(lat, lng)

    hole_lines: list[dict] = []
    tee_polys: list[Polygon] = []
    green_polys: list[Polygon] = []
    fairway_polys: list[Polygon] = []

    for el in elements:
        tags = el.get("tags", {}) or {}
        coords = [(n["lon"], n["lat"]) for n in (el.get("geometry") or [])]
        if len(coords) < 2:
            continue
        leisure = tags.get("leisure")
        golf = tags.get("golf")
        is_hole_line = leisure == "golf_hole" or golf == "hole"
        if is_hole_line:
            ref = tags.get("ref")
            try:
                number = int(ref) if ref else None
            except (TypeError, ValueError):
                number = None
            try:
                par = int(tags["par"]) if tags.get("par") else None
            except (TypeError, ValueError):
                par = None
            hole_lines.append(
                {"ref_number": number, "par": par, "line": LineString(coords)}
            )
        elif golf == "tee" and len(coords) >= 3:
            try:
                tee_polys.append(Polygon(coords))
            except Exception:
                pass
        elif golf == "green" and len(coords) >= 3:
            try:
                green_polys.append(Polygon(coords))
            except Exception:
                pass
        elif golf == "fairway" and len(coords) >= 3:
            try:
                fairway_polys.append(Polygon(coords))
            except Exception:
                pass

    course_pt = to_shape(course.location) if course.location is not None else Point(lng, lat)
    holes_built: list[dict] = []

    if hole_lines:
        numbered = [h for h in hole_lines if h["ref_number"]]
        unnumbered = [h for h in hole_lines if not h["ref_number"]]
        used_numbers = {h["ref_number"] for h in numbered}
        next_num = 1
        cursor_pt = course_pt
        while unnumbered:
            while next_num in used_numbers:
                next_num += 1
            best = min(
                unnumbered,
                key=lambda h: cursor_pt.distance(Point(h["line"].coords[0])),
            )
            best["ref_number"] = next_num
            used_numbers.add(next_num)
            unnumbered.remove(best)
            cursor_pt = Point(best["line"].coords[-1])
            next_num += 1

        for h in hole_lines:
            line = h["line"]
            holes_built.append(
                {
                    "number": h["ref_number"],
                    "par": h["par"],
                    "line": line,
                    "tee_pt": Point(line.coords[0]),
                    "pin_pt": Point(line.coords[-1]),
                }
            )
    elif green_polys and tee_polys:
        used = set()
        for green in green_polys:
            avail = [(i, t) for i, t in enumerate(tee_polys) if i not in used]
            if not avail:
                break
            i_best, tee = min(avail, key=lambda it: green.centroid.distance(it[1].centroid))
            used.add(i_best)
            tee_pt, pin_pt = tee.centroid, green.centroid
            holes_built.append(
                {
                    "number": None,
                    "par": None,
                    "line": LineString([(tee_pt.x, tee_pt.y), (pin_pt.x, pin_pt.y)]),
                    "tee_pt": tee_pt,
                    "pin_pt": pin_pt,
                }
            )
        if holes_built:
            ordered = []
            remaining = list(holes_built)
            cursor = course_pt
            while remaining:
                nxt = min(remaining, key=lambda h: cursor.distance(h["tee_pt"]))
                remaining.remove(nxt)
                ordered.append(nxt)
                cursor = nxt["pin_pt"]
            for i, h in enumerate(ordered, start=1):
                h["number"] = i
            holes_built = ordered

    if holes_built:
        holes_built = sorted(holes_built, key=lambda h: h["number"] or 999)[:18]
        total_par = 0
        for h in holes_built:
            line: LineString = h["line"]
            tee_pt: Point = h["tee_pt"]
            pin_pt: Point = h["pin_pt"]
            row = (
                await db.execute(
                    text(
                        f"SELECT ST_Length(ST_GeomFromText('{line.wkt}', 4326)::geography) * 1.09361 AS yards"
                    )
                )
            ).fetchone()
            distance_yards = int(round(row.yards)) if row and row.yards else None
            par = h.get("par")
            if not par:
                if distance_yards is None:
                    par = 4
                elif distance_yards < 250:
                    par = 3
                elif distance_yards < 500:
                    par = 4
                else:
                    par = 5
            green_poly = None
            if green_polys:
                inside = [g for g in green_polys if g.contains(pin_pt)]
                if inside:
                    green_poly = inside[0]
                else:
                    candidate = min(green_polys, key=lambda g: g.centroid.distance(pin_pt))
                    if candidate.centroid.distance(pin_pt) < 0.0005:
                        green_poly = candidate
            fairway_poly = None
            if fairway_polys:
                mid = line.interpolate(0.5, normalized=True)
                cand = min(fairway_polys, key=lambda f: f.centroid.distance(mid))
                if cand.centroid.distance(mid) < 0.001:
                    fairway_poly = cand
            db.add(
                Hole(
                    course_id=course.id,
                    number=h["number"],
                    par=par,
                    distance_yards=distance_yards,
                    tee_location=from_shape(tee_pt, srid=4326),
                    pin_location=from_shape(pin_pt, srid=4326),
                    hole_line=from_shape(line, srid=4326),
                    green_polygon=from_shape(green_poly, srid=4326) if green_poly else None,
                    fairway_polygon=from_shape(fairway_poly, srid=4326) if fairway_poly else None,
                )
            )
            total_par += par
        course.par = total_par
        course.total_holes = len(holes_built)
    else:
        # Last-resort placeholder: 18 holes in a ring around the centre.
        # The admin hole editor exists precisely for this case.
        par_seq = [4, 4, 3, 4, 5, 3, 4, 4, 5, 4, 3, 4, 5, 4, 3, 4, 4, 5]
        for i in range(18):
            angle = (i / 18) * 2 * math.pi
            offset = 0.0014  # ~150 m
            tee = Point(
                course_pt.x + offset * math.cos(angle),
                course_pt.y + offset * math.sin(angle),
            )
            pin_angle = angle + math.pi / 18
            pin = Point(
                course_pt.x + offset * 1.5 * math.cos(pin_angle),
                course_pt.y + offset * 1.5 * math.sin(pin_angle),
            )
            db.add(
                Hole(
                    course_id=course.id,
                    number=i + 1,
                    par=par_seq[i],
                    tee_location=from_shape(tee, srid=4326),
                    pin_location=from_shape(pin, srid=4326),
                )
            )
        course.par = sum(par_seq)
        course.total_holes = 18


# ─── Public routes ──────────────────────────────────────────────────────────
@router.get("/search", response_model=list[CourseOut])
async def search_courses(
    lat: float = Query(...),
    lng: float = Query(...),
    radius_m: int = Query(16093, ge=500, le=100000),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Search courses near a coordinate. Returns saved local courses first,
    then OSM results that haven't been imported yet.
    """
    point_wkt = f"SRID=4326;POINT({lng} {lat})"
    res = await db.execute(
        select(Course).where(
            func.ST_DWithin(
                Course.location,
                func.ST_GeomFromEWKT(point_wkt),
                radius_m / 111320.0,
            )
        ).limit(50)
    )
    local = [_course_to_out(c) for c in res.scalars().all()]
    local_osm_ids = {c.osm_id for c in local if c.osm_id}

    try:
        osm_results = await _fetch_osm_courses(lat, lng, radius_m)
    except Exception:
        osm_results = []
    osm_out = [
        CourseOut(
            osm_id=c["osm_id"],
            name=c["name"],
            city=c.get("city"),
            country=c.get("country"),
            lat=c["lat"],
            lng=c["lng"],
            is_imported=False,
        )
        for c in osm_results
        if c["osm_id"] not in local_osm_ids
    ]
    return local + osm_out


@router.post("/import/{osm_id:path}", response_model=CourseOut, status_code=201)
async def import_course(
    osm_id: str,
    lat: float = Query(...),
    lng: float = Query(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    existing = await db.execute(select(Course).where(Course.osm_id == osm_id))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Course already imported")

    osm_courses = await _fetch_osm_courses(lat, lng, radius_m=16093)
    matched = next((c for c in osm_courses if c["osm_id"] == osm_id), None)
    if matched is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found in OSM near those coordinates")

    course = Course(
        osm_id=matched["osm_id"],
        name=matched["name"],
        city=matched.get("city"),
        country=matched.get("country"),
        location=from_shape(Point(matched["lng"], matched["lat"]), srid=4326),
    )
    db.add(course)
    await db.flush()
    await _import_holes(db, course, matched["lat"], matched["lng"])
    await db.commit()
    await db.refresh(course)
    return _course_to_out(course)


@router.get("/{course_id}", response_model=CourseOut)
async def get_course(
    course_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    course = await db.get(Course, course_id)
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found")
    return _course_to_out(course)


@router.get("/{course_id}/holes", response_model=list[HoleOut])
async def list_holes(
    course_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    res = await db.execute(
        select(Hole).where(Hole.course_id == course_id).order_by(Hole.number)
    )
    return [_hole_to_out(h) for h in res.scalars().all()]


@router.get("/{course_id}/holes/{hole_number}/yardage")
async def yardage_to_pin(
    course_id: int,
    hole_number: int,
    lat: float = Query(...),
    lng: float = Query(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Live yards-to-pin via PostGIS ST_Distance on geography.
    Coordinates are inlined into the SQL string (not bound params) because
    asyncpg can't infer parameter types for ST_GeomFromText literals.
    """
    res = await db.execute(
        select(Hole).where(
            Hole.course_id == course_id,
            Hole.number == hole_number,
            Hole.pin_location.isnot(None),
        )
    )
    hole = res.scalar_one_or_none()
    if hole is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hole or pin not set")

    row = (
        await db.execute(
            text(
                f"""
                SELECT ST_Distance(
                  ST_SetSRID(ST_MakePoint({lng}, {lat}), 4326)::geography,
                  pin_location::geography
                ) * 1.09361 AS yards
                FROM holes WHERE id = {hole.id}
                """
            )
        )
    ).fetchone()
    return {"hole_number": hole_number, "yards": int(round(row.yards)) if row and row.yards else None}


# ─── Admin routes (hole editor) ─────────────────────────────────────────────
@router.patch("/{course_id}/holes/{hole_number}", response_model=HoleOut)
async def update_hole(
    course_id: int,
    hole_number: int,
    payload: HolePatch,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    res = await db.execute(
        select(Hole).where(Hole.course_id == course_id, Hole.number == hole_number)
    )
    hole = res.scalar_one_or_none()
    if hole is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hole not found")

    if payload.par is not None:
        hole.par = payload.par
    if payload.handicap_index is not None:
        hole.handicap_index = payload.handicap_index
    if payload.tee_lat is not None and payload.tee_lng is not None:
        hole.tee_location = from_shape(Point(payload.tee_lng, payload.tee_lat), srid=4326)
    if payload.pin_lat is not None and payload.pin_lng is not None:
        hole.pin_location = from_shape(Point(payload.pin_lng, payload.pin_lat), srid=4326)

    # Recompute hole_line + distance if both endpoints are set
    if hole.tee_location is not None and hole.pin_location is not None:
        tee = to_shape(hole.tee_location)
        pin = to_shape(hole.pin_location)
        line = LineString([(tee.x, tee.y), (pin.x, pin.y)])
        hole.hole_line = from_shape(line, srid=4326)
        row = (
            await db.execute(
                text(
                    f"SELECT ST_Length(ST_GeomFromText('{line.wkt}', 4326)::geography) * 1.09361 AS yards"
                )
            )
        ).fetchone()
        if row and row.yards:
            hole.distance_yards = int(round(row.yards))

    # Recompute course par as the sum of hole pars
    if payload.par is not None:
        all_holes = await db.execute(select(Hole).where(Hole.course_id == course_id))
        hole.course.par = sum(h.par for h in all_holes.scalars().all())

    await db.commit()
    await db.refresh(hole)
    return _hole_to_out(hole)


@router.put("/{course_id}/holes/{hole_number}/total_holes")
async def set_total_holes(
    course_id: int,
    total: int = Query(..., ge=1, le=27),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Trim or extend the hole list (admin only). Useful for 9-hole courses."""
    course = await db.get(Course, course_id)
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found")
    res = await db.execute(
        select(Hole).where(Hole.course_id == course_id).order_by(Hole.number)
    )
    holes = list(res.scalars().all())
    if total < len(holes):
        for h in holes[total:]:
            await db.delete(h)
    elif total > len(holes):
        # Add placeholder holes at the course centre
        course_pt = to_shape(course.location) if course.location is not None else Point(0, 0)
        for n in range(len(holes) + 1, total + 1):
            db.add(
                Hole(
                    course_id=course.id,
                    number=n,
                    par=4,
                    tee_location=from_shape(course_pt, srid=4326),
                    pin_location=from_shape(course_pt, srid=4326),
                )
            )
    course.total_holes = total
    await db.commit()
    return {"course_id": course_id, "total_holes": total}
