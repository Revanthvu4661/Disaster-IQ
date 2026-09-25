# DisasterIQ developer commands.
#
#   make setup     install backend and frontend dependencies
#   make data      fetch the sources, clean them and rebuild the SQLite store
#   make verify    print the stored figures for well-known disasters
#   make dev       run the API and the UI together
#   make test      backend pytest + frontend vitest
#   make up        run the whole stack in Docker

PY ?= python
NPM ?= npm

.PHONY: help setup data data-refresh verify flood-data flood-current flood-report hazard-data dev dev-api dev-web test test-backend \
        test-frontend coverage lint build up down clean

help:
	@echo "setup  data  data-refresh  verify  flood-data  flood-current  flood-report  hazard-data  dev  test  coverage  lint  build  up  down  clean"

setup:
	$(PY) -m pip install -r backend/requirements-dev.txt
	cd frontend && $(NPM) install

data:
	$(PY) -m backend.data_pipeline

data-refresh:
	$(PY) -m backend.data_pipeline --refresh

verify:
	$(PY) -m backend.data_pipeline --verify

# Level 2/3 (Kerala flood risk): fetch and build features; refresh the latest
# NASA POWER days only; print the model evaluation.
flood-data:
	$(PY) -m backend.flood_pipeline

flood-current:
	$(PY) -m backend.flood_pipeline --current

flood-report:
	$(PY) -m backend.services.flood_risk

# Earthquake and cyclone counts per Indian state (USGS, IBTrACS, census).
hazard-data:
	$(PY) -m backend.hazard_pipeline

dev-api:
	$(PY) -m uvicorn backend.main:app --reload --port 8000 --timeout-keep-alive 75

dev-web:
	cd frontend && $(NPM) run dev

# Runs the API in the background and the UI in the foreground.
dev:
	$(PY) -m uvicorn backend.main:app --port 8000 & \
	cd frontend && $(NPM) run dev

test: test-backend test-frontend

test-backend:
	$(PY) -m pytest

test-frontend:
	cd frontend && $(NPM) run test

coverage:
	$(PY) -m pytest --cov=backend/services --cov=backend/data_pipeline --cov-report=term-missing
	cd frontend && $(NPM) run test:coverage

lint:
	cd frontend && $(NPM) run lint

build:
	cd frontend && $(NPM) run build

up:
	docker compose up --build

down:
	docker compose down

clean:
	rm -f backend/data/disasters.db
	rm -rf frontend/dist
