from fastapi import APIRouter

router = APIRouter()

@router.get("/search")
async def search_courses(q: str | None = None, radius_miles: int = 10):
    return {"items": [], "query": q, "radius_miles": radius_miles}
