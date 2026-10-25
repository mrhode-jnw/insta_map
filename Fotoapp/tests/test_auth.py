from fastapi.testclient import TestClient

from app.main import app


def test_redirects_to_login_without_session():
    c = TestClient(app)
    r = c.get("/images", follow_redirects=False)
    assert r.status_code == 303
    assert r.headers["location"].startswith("/login")


def test_media_is_protected():
    c = TestClient(app)
    r = c.get("/media/images/x.jpg", follow_redirects=False)
    assert r.status_code == 303


def test_wrong_password():
    c = TestClient(app)
    r = c.post("/login", data={"password": "falsch"}, follow_redirects=False)
    assert r.status_code == 401


def test_login_and_open_redirect_guard():
    c = TestClient(app)
    r = c.post("/login", data={"password": "geheim", "next": "//evil.example"}, follow_redirects=False)
    assert r.headers["location"] == "/"
    assert c.get("/").status_code == 200
