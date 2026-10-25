"""FastAPI application entry point."""
import secrets
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect
from starlette.middleware.sessions import SessionMiddleware

from app import auth
from app.config import BASE_DIR, settings
from app.db import SessionLocal, engine
from app.routes import analysis, history, learn, library
from app.seed import ensure_chapters



@asynccontextmanager
async def lifespan(_app: FastAPI):
    # The ten proposed chapters exist from the start; their content is filled from sources.
    with SessionLocal() as db:
        if inspect(engine).has_table("chapters"):
            ensure_chapters(db)
    yield


app = FastAPI(title="Sehschule", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)

# Order matters: the session middleware must wrap the login check.
app.add_middleware(auth.RequireLogin)
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.secret_key or secrets.token_hex(32),
    session_cookie="sehschule",
    max_age=60 * 60 * 24 * 30,
    same_site="lax",
)

app.mount("/static", StaticFiles(directory=str(BASE_DIR / "app" / "static")), name="static")


@app.get("/media/{kind}/{name}")
def media(kind: str, name: str):
    """Serve stored images (behind the login, unlike /static)."""
    if kind not in ("images", "thumbs") or "/" in name or name.startswith("."):
        raise HTTPException(404)
    path = settings.data_dir / kind / name
    if not path.is_file():
        raise HTTPException(404)
    return FileResponse(path, headers={"Cache-Control": "private, max-age=86400"})


app.include_router(auth.router)
app.include_router(library.router)
app.include_router(analysis.router)
app.include_router(learn.router)
app.include_router(history.router)
