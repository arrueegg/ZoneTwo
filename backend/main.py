from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from database import create_tables
from routers import auth, activities, athlete, metrics, recommendations


@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_tables()
    yield


app = FastAPI(title="ZoneTwo Training Analytics", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(athlete.router)
app.include_router(activities.router)
app.include_router(metrics.router)
app.include_router(recommendations.router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
