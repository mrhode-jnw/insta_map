import io
import os
import tempfile

import pytest

_tmp = tempfile.mkdtemp(prefix="sehschule-test-")
os.environ["SEHSCHULE_DATA_DIR"] = _tmp
os.environ["APP_PASSWORD"] = "geheim"
os.environ["SECRET_KEY"] = "test-secret"
os.environ["ANTHROPIC_API_KEY"] = ""

from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image as PILImage  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield


@pytest.fixture
def db():
    with SessionLocal() as session:
        yield session


@pytest.fixture
def client():
    c = TestClient(app)
    r = c.post("/login", data={"password": "geheim", "next": "/"}, follow_redirects=False)
    assert r.status_code == 303
    return c


def make_jpeg(size=(2400, 1600), color=(120, 90, 60)) -> bytes:
    buf = io.BytesIO()
    PILImage.new("RGB", size, color).save(buf, "JPEG")
    return buf.getvalue()
