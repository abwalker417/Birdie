from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import settings
from routes.auth import router as auth_router
from routes.courses import router as courses_router
from routes.rounds import router as rounds_router
from routes.shots import router as shots_router

app = FastAPI(title="Birdie API", docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
@app.get("/api/health")
async def health():
    return {"status": "ok"}
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(courses_router, prefix="/api/courses", tags=["courses"])
app.include_router(rounds_router, prefix="/api/rounds", tags=["rounds"])
app.include_router(shots_router, prefix="/api/shots", tags=["shots"])
