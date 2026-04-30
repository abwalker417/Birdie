"""
Birdie API entrypoint.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes import auth, courses, rounds, shots

app = FastAPI(
    title="Birdie API",
    description="Self-hosted golf GPS, scorecard, and shot tracker.",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

# CORS — relaxed for self-hosted local network use. nginx proxies /api/ to us
# from the same origin in production, so this mostly matters for `npm run dev`.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router,    prefix="/api/auth",    tags=["auth"])
app.include_router(courses.router, prefix="/api/courses", tags=["courses"])
app.include_router(rounds.router,  prefix="/api/rounds",  tags=["rounds"])
app.include_router(shots.router,   prefix="/api/shots",   tags=["shots"])


@app.get("/api/health")
def health():
    return {"status": "ok"}
