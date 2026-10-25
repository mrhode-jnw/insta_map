PY ?= python3
VENV = .venv
BIN = $(VENV)/bin

.PHONY: install dev migrate seed test

install:
	$(PY) -m venv $(VENV)
	$(BIN)/pip install -r requirements.txt
	@test -f .env || (cp .env.example .env && echo ".env angelegt – bitte APP_PASSWORD, SECRET_KEY und ANTHROPIC_API_KEY eintragen.")

migrate:
	$(BIN)/alembic upgrade head

dev: migrate
	$(BIN)/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

seed: migrate
	$(BIN)/python -m app.seed

test:
	$(BIN)/pytest -q
