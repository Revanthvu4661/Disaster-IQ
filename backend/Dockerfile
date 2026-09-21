# DisasterIQ backend.
#
# Slim CPU image: the TF-IDF candidates train and serve without torch. To serve
# the DistilBERT bundle, build with `--build-arg INSTALL_ML=true` and mount or
# copy `backend/model/distilbert_artifact`.
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    DISASTERIQ_ENV=production

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt backend/requirements-ml.txt ./backend/
ARG INSTALL_ML=false
RUN pip install --upgrade pip \
    && pip install -r backend/requirements.txt \
    && if [ "$INSTALL_ML" = "true" ]; then pip install -r backend/requirements-ml.txt; fi

COPY backend ./backend

# The ETL cache and the model bundle are generated at runtime (or mounted).
VOLUME ["/app/backend/data", "/app/backend/model"]

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=5 \
    CMD curl -fsS http://localhost:8000/health || exit 1

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
