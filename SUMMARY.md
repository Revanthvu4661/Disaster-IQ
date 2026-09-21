# DisasterIQ — Project Summary Document

> Auto-updated by Kiro on every file save/create/delete.  
> Last updated: **2026-09-22 01:25**

---

## Project Overview

**DisasterIQ** is a full-stack Disaster Management Analytics & Prediction Platform.  
It ingests real Figure-Eight disaster response data (~26,000 messages), surfaces interactive
analytics, classifies incoming messages across 35 disaster categories, scores how
life-threatening each one is, and turns the result into a prioritised action plan.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend API | FastAPI + uvicorn (Python) |
| ETL / Storage | pandas → SQLite |
| ML Model | distilbert (chosen by a six-candidate benchmark) |
| Recommendations | YAML rule table (category rules, severity escalations, event overlays) |
| Frontend | React 19 + Vite + Tailwind v4 + Recharts + Leaflet |

---

## How to Run

### Backend (from the project root)
```bash
pip install -r backend/requirements-dev.txt
python -m backend.etl                       # build the SQLite cache
python -m backend.model.train_model --fast  # train a model
python -m uvicorn backend.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**

---

## Live File Tree

> 48 backend files · 41 frontend files

```
├── backend/
│   ├── data/
│   │   ├── disaster.db  (6.7 MB)
│   │   ├── disaster_categories.csv  (11.3 MB)
│   │   ├── disaster_messages.csv  (4.8 MB)
│   │   └── recommendation_rules.yaml  (13.9 KB)
│   ├── model/
│   │   ├── distilbert_artifact/
│   │   │   ├── config.json  (2.2 KB)
│   │   │   ├── model.safetensors  (516.3 MB)
│   │   │   ├── tokenizer.json  (2.8 MB)
│   │   │   └── tokenizer_config.json  (367 B)
│   │   ├── disaster_model.joblib  (57.2 MB)
│   │   ├── evaluate.py  (5.2 KB)
│   │   ├── predictors.py  (18.7 KB)
│   │   └── train_model.py  (10.5 KB)
│   ├── routers/
│   │   ├── __init__.py  (0 B)
│   │   ├── analytics.py  (4.1 KB)
│   │   ├── hazards.py  (1.0 KB)
│   │   ├── model.py  (1.9 KB)
│   │   ├── predict.py  (8.2 KB)
│   │   └── recommend.py  (3.0 KB)
│   ├── services/
│   │   ├── __init__.py  (0 B)
│   │   ├── analytics.py  (17.2 KB)
│   │   ├── events.py  (4.6 KB)
│   │   ├── hazards.py  (7.2 KB)
│   │   ├── incident.py  (1.5 KB)
│   │   ├── language.py  (8.3 KB)
│   │   ├── model_service.py  (12.6 KB)
│   │   ├── recommend.py  (10.3 KB)
│   │   ├── severity.py  (3.9 KB)
│   │   └── text.py  (1.9 KB)
│   ├── tests/
│   │   ├── __init__.py  (0 B)
│   │   ├── conftest.py  (2.0 KB)
│   │   ├── test_analytics_service.py  (4.3 KB)
│   │   ├── test_api.py  (14.7 KB)
│   │   ├── test_etl_events.py  (4.3 KB)
│   │   ├── test_language.py  (3.7 KB)
│   │   ├── test_model_service.py  (5.4 KB)
│   │   ├── test_recommend.py  (5.5 KB)
│   │   └── test_severity.py  (3.9 KB)
│   ├── __init__.py  (0 B)
│   ├── config.py  (2.5 KB)
│   ├── Dockerfile  (1.1 KB)
│   ├── etl.py  (8.2 KB)
│   ├── main.py  (3.3 KB)
│   ├── rate_limit.py  (1.6 KB)
│   ├── requirements-dev.txt  (48 B)
│   ├── requirements-ml.txt  (369 B)
│   ├── requirements.txt  (487 B)
│   ├── schemas.py  (10.5 KB)
│   └── state.py  (3.9 KB)
├── docs/
│   ├── screenshots/
│   │   ├── about-desktop.png  (348.6 KB)
│   │   ├── about-mobile.png  (165.8 KB)
│   │   ├── dashboard-desktop.png  (584.7 KB)
│   │   ├── dashboard-light.png  (585.6 KB)
│   │   ├── dashboard-mobile.png  (128.9 KB)
│   │   ├── hazards-desktop.png  (667.2 KB)
│   │   ├── hazards-mobile.png  (170.7 KB)
│   │   ├── insights-desktop.png  (480.1 KB)
│   │   ├── insights-mobile.png  (149.0 KB)
│   │   ├── model-desktop.png  (434.3 KB)
│   │   ├── model-mobile.png  (120.8 KB)
│   │   ├── predict-desktop.png  (819.8 KB)
│   │   ├── predict-mobile.png  (108.3 KB)
│   │   ├── triage-desktop.png  (508.4 KB)
│   │   └── triage-mobile.png  (142.5 KB)
│   ├── DECISIONS.md  (3.7 KB)
│   ├── metrics.json  (10.2 KB)
│   └── PLAN.md  (2.8 KB)
├── frontend/
│   ├── public/
│   │   └── favicon.svg  (352 B)
│   ├── scripts/
│   │   └── screenshots.mjs  (4.3 KB)
│   ├── src/
│   │   ├── api/
│   │   │   └── client.js  (4.0 KB)
│   │   ├── components/
│   │   │   ├── charts/
│   │   │   │   ├── Charts.jsx  (6.3 KB)
│   │   │   │   └── Heatmap.jsx  (4.8 KB)
│   │   │   ├── ChartCard.jsx  (3.8 KB)
│   │   │   ├── CommandPalette.jsx  (4.4 KB)
│   │   │   ├── CommandPalette.test.jsx  (2.6 KB)
│   │   │   ├── KpiCard.jsx  (3.0 KB)
│   │   │   ├── SeverityGauge.jsx  (3.0 KB)
│   │   │   ├── ui.jsx  (4.4 KB)
│   │   │   └── ui.test.jsx  (2.6 KB)
│   │   ├── context/
│   │   │   ├── ThemeContext.jsx  (2.1 KB)
│   │   │   ├── ThemeContext.test.jsx  (2.0 KB)
│   │   │   └── ToastContext.jsx  (2.3 KB)
│   │   ├── hooks/
│   │   │   └── useApi.js  (1.8 KB)
│   │   ├── lib/
│   │   │   ├── download.js  (2.7 KB)
│   │   │   ├── format.js  (1.9 KB)
│   │   │   └── format.test.js  (2.0 KB)
│   │   ├── pages/
│   │   │   ├── About.jsx  (5.7 KB)
│   │   │   ├── Dashboard.jsx  (13.5 KB)
│   │   │   ├── Hazards.jsx  (8.4 KB)
│   │   │   ├── Insights.jsx  (11.6 KB)
│   │   │   ├── Model.jsx  (9.7 KB)
│   │   │   ├── NotFound.jsx  (448 B)
│   │   │   ├── Predict.jsx  (14.0 KB)
│   │   │   ├── Predict.test.jsx  (4.8 KB)
│   │   │   └── Triage.jsx  (15.2 KB)
│   │   ├── styles/
│   │   │   └── tokens.css  (4.4 KB)
│   │   ├── test/
│   │   │   └── setup.js  (558 B)
│   │   ├── App.jsx  (5.9 KB)
│   │   ├── index.css  (16.0 KB)
│   │   ├── main.jsx  (531 B)
│   │   └── navigation.js  (878 B)
│   ├── Dockerfile  (460 B)
│   ├── eslint.config.js  (943 B)
│   ├── index.html  (389 B)
│   ├── nginx.conf  (397 B)
│   ├── package-lock.json  (160.0 KB)
│   ├── package.json  (1.2 KB)
│   └── vite.config.js  (1.3 KB)
├── docker-compose.yml  (1.2 KB)
├── Makefile  (1.7 KB)
├── MODEL_CARD.md  (8.1 KB)
├── pytest.ini  (115 B)
├── README.md  (12.6 KB)
└── update_summary.py  (12.1 KB)
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Readiness, row count, model status |
| GET | `/api/analytics/summary-stats` | KPIs, sparklines and deltas |
| GET | `/api/analytics/category-distribution` | All 35 categories sorted by count |
| GET | `/api/analytics/volume-by-event` | Volume per inferred disaster event |
| GET | `/api/analytics/volume-by-genre` | Volume per source genre |
| GET | `/api/analytics/event-category-mix` | Need mix per event |
| GET | `/api/analytics/genre-event-matrix` | Genre x event heatmap |
| GET | `/api/analytics/category-cooccurrence` | Co-occurrence matrix and top pairs |
| GET | `/api/analytics/needs-bundles` | Frequent category combinations |
| GET | `/api/analytics/top-terms/{category}` | Distinctive terms per category |
| GET | `/api/analytics/data-quality` | Duplicates, noise, imbalance |
| GET | `/api/analytics/search?q=` | Keyword in context |
| POST | `/api/predict` | Classify one message with severity, explanation and plan |
| POST | `/api/predict/batch`, `/api/predict/batch-csv` | Batch triage |
| POST | `/api/recommend` | Prioritised action plan |
| GET | `/api/model/performance` | Test metrics per label and the benchmark |
| GET | `/api/hazards` | Live USGS / EONET / GDACS feeds |

---

## ML Model

- **Serving model:** `distilbert`, trained 2026-09-21T19:12:56+00:00
- **Split:** 15,592 train / 5,198 validation / 5,198 test (seed 42)
- **Decision rule:** one threshold per label, tuned on the validation split only
- **Severity:** weighted noisy-OR over life-threatening categories, scored 0-100
- **Test macro F1:** **0.4763** (micro 0.6797, macro PR-AUC 0.4554)

### Candidate benchmark (test split)

| Model | Macro F1 | Micro F1 | Macro F1 at 0.5 |
|---|---|---|---|
| distilbert | 0.4763 | 0.6797 | 0.3894 |
| tfidf_linearsvc_wordchar | 0.4578 | 0.6709 | 0.3116 |
| tfidf_logreg_word | 0.4508 | 0.6570 | 0.4337 |
| minilm_logreg | 0.4456 | 0.6681 | 0.3528 |
| tfidf_logreg_wordchar | 0.4454 | 0.6472 | 0.4381 |
| ensemble_sgd_cnb | 0.4171 | 0.6250 | 0.4097 |

### Strongest labels (test split)

| Category | F1 | Support |
|---|---|---|
| related | 0.903 | 3,987 |
| earthquake | 0.815 | 503 |
| weather_related | 0.789 | 1,446 |
| aid_related | 0.775 | 2,205 |
| food | 0.770 | 615 |
| request | 0.702 | 926 |
| water | 0.699 | 338 |

Full per-label numbers and limitations: `MODEL_CARD.md`.

---

## Dataset

- **Source:** Figure-Eight (now Appen)
- **Events:** Haiti earthquake · Chile earthquake · Pakistan floods · Superstorm Sandy
- **Raw rows:** 26,248 rows (26,180 unique ids)
- **After cleaning:** 26,175 messages; 187 rows flagged `related=2` and excluded from stats
- **Labels:** 36 categories → 35 active (child_alone has 0 positives)
- **Events:** inferred from keywords and id ranges; ~46 % remain "Other"

---

## UI Pages

| Page | What it does |
|---|---|
| Dashboard (`/`) | KPI cards with sparklines, category distribution with drill-down, event comparison, genre x event and co-occurrence heatmaps |
| Insights (`/insights`) | Term explorer, needs bundles, message length, urgent vocabulary, keyword in context, data quality |
| Predict (`/predict`) | Severity gauge, triggered labels with tuned thresholds, highlighted evidence, action timeline, copyable incident summary |
| Triage Inbox (`/triage`) | Paste or upload CSV, severity-sorted queue with filters, top 10 urgent, resource demand forecast, CSV export |
| Live Hazards (`/hazards`) | USGS / EONET / GDACS on a Leaflet map, India filter, offline state |
| Model (`/model`) | Candidate comparison, sortable per-label metrics, PR and threshold curves |
| About (`/about`) | Data, pipeline, rule table and limitations |

Dark and light themes, a command palette (Ctrl+K) and a mobile bottom nav are
available on every page.

---

## Change Log

| Date | Change |
|---|---|
| 2026-09-22 | Upgrade to DisasterIQ 2.0 |
| 2026-09-22 | Project files updated |
| 2026-09-21 | Project files updated |
| 2026-09-21 | Initial summary generation |
| 2026-09-21 | Initial build — ETL, ML model, FastAPI, React dashboard complete |
