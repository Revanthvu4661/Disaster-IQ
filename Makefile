# DisasterIQ developer commands.
#
#   make setup     install backend and frontend dependencies
#   make etl       rebuild the SQLite cache from the raw CSVs
#   make train     run the model benchmark and save the best bundle
#   make dev       run the API and the UI together
#   make test      backend pytest + frontend vitest
#   make up        run the whole stack in Docker

PY ?= python
NPM ?= npm

.PHONY: help setup setup-ml etl train train-fast dev dev-api dev-web test test-backend \
        test-frontend coverage lint build up down clean

help:
	@echo "setup  setup-ml  etl  train  train-fast  dev  test  coverage  lint  build  up  down  clean"

setup:
	$(PY) -m pip install -r backend/requirements-dev.txt
	cd frontend && $(NPM) install

setup-ml:
	$(PY) -m pip install -r backend/requirements-ml.txt

etl:
	$(PY) -m backend.etl

train:
	$(PY) -m backend.model.train_model

train-fast:
	$(PY) -m backend.model.train_model --fast

dev-api:
	$(PY) -m uvicorn backend.main:app --reload --port 8000

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
	$(PY) -m pytest --cov=backend/services --cov=backend/model --cov-report=term-missing
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
	rm -f backend/data/disaster.db
	rm -rf backend/model/*.joblib backend/model/distilbert_artifact frontend/dist
