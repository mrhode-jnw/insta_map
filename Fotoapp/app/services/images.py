"""Storing originals, creating thumbnails, preparing images for the API."""
import base64
import hashlib
import io
from pathlib import Path

import httpx
from PIL import Image as PILImage

from app.config import settings

THUMB_LONG_EDGE = 640
API_LONG_EDGE = 1568
USER_AGENT = "Sehschule/1.0 (private study app)"
EXT_BY_FORMAT = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp", "TIFF": ".tif", "GIF": ".gif"}


class ImageImportError(Exception):
    pass


def download(url: str, timeout: float = 60.0) -> bytes:
    try:
        resp = httpx.get(url, headers={"User-Agent": USER_AGENT}, follow_redirects=True, timeout=timeout)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise ImageImportError(f"Download fehlgeschlagen: {exc}") from exc
    return resp.content


def store_original(data: bytes) -> tuple[str, str]:
    """Save bytes unchanged and create a thumbnail. Returns (file_path, thumb_path) relative to data_dir."""
    try:
        img = PILImage.open(io.BytesIO(data))
        img.load()
    except Exception as exc:  # Pillow raises various exception types
        raise ImageImportError("Datei ist kein lesbares Bild.") from exc

    digest = hashlib.sha256(data).hexdigest()[:16]
    ext = EXT_BY_FORMAT.get(img.format or "", ".img")
    settings.images_dir.mkdir(parents=True, exist_ok=True)
    settings.thumbs_dir.mkdir(parents=True, exist_ok=True)

    original = settings.images_dir / f"{digest}{ext}"
    if not original.exists():
        original.write_bytes(data)

    thumb = settings.thumbs_dir / f"{digest}.jpg"
    if not thumb.exists():
        t = _rgb(img)
        t.thumbnail((THUMB_LONG_EDGE, THUMB_LONG_EDGE))
        t.save(thumb, "JPEG", quality=85)

    return (
        str(original.relative_to(settings.data_dir)),
        str(thumb.relative_to(settings.data_dir)),
    )


def for_api(file_path: str) -> tuple[str, str]:
    """Return (media_type, base64) of the image scaled to max. 1568 px long edge."""
    img = PILImage.open(settings.data_dir / file_path)
    img = _rgb(img)
    img.thumbnail((API_LONG_EDGE, API_LONG_EDGE))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=88)
    return "image/jpeg", base64.standard_b64encode(buf.getvalue()).decode("ascii")


def delete_files(*rel_paths: str) -> None:
    for rel in rel_paths:
        p = settings.data_dir / rel
        if p.is_file():
            p.unlink()


def _rgb(img: PILImage.Image) -> PILImage.Image:
    if img.mode in ("RGB", "L"):
        return img.convert("RGB")
    if img.mode in ("I;16", "I;16B", "I"):
        return img.point(lambda v: v / 256).convert("RGB")
    return img.convert("RGB")


def resolve(rel_path: str) -> Path:
    return settings.data_dir / rel_path
