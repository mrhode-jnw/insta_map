"""Simple password protection via a signed session cookie."""
import hmac

from fastapi import APIRouter, Form, Request
from fastapi.responses import RedirectResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import settings
from app.web import templates

PUBLIC_PATHS = ("/login", "/static/")

router = APIRouter()


class RequireLogin(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if not any(path == p or path.startswith(p) for p in PUBLIC_PATHS) and not request.session.get("auth"):
            if request.headers.get("HX-Request"):
                resp = RedirectResponse("/login", status_code=303)
                resp.headers["HX-Redirect"] = "/login"
                return resp
            return RedirectResponse(f"/login?next={request.url.path}", status_code=303)
        return await call_next(request)


def check_password(candidate: str) -> bool:
    if not settings.app_password:
        return False
    return hmac.compare_digest(candidate.encode(), settings.app_password.encode())


@router.get("/login")
def login_form(request: Request, next: str = "/"):
    return templates.TemplateResponse(
        request, "login.html", {"next": next, "error": None, "configured": bool(settings.app_password)}
    )


@router.post("/login")
def login(request: Request, password: str = Form(...), next: str = Form("/")):
    if check_password(password):
        request.session["auth"] = True
        target = next if next.startswith("/") and not next.startswith("//") else "/"
        return RedirectResponse(target, status_code=303)
    return templates.TemplateResponse(
        request,
        "login.html",
        {"next": next, "error": "Falsches Passwort.", "configured": bool(settings.app_password)},
        status_code=401,
    )


@router.post("/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/login", status_code=303)
