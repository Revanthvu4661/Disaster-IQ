# DisasterIQ

Analyse, predict and recommend on disaster response messages.

DisasterIQ ingests the Figure-Eight disaster response corpus (~26,000 real
messages from the Haiti earthquake, the Chile earthquake, the Pakistan floods
and Superstorm Sandy), classifies an incoming message across 35 need
categories, scores how life-threatening it is, explains which words drove each
label, and turns the result into a prioritised action plan for named response
teams.

| | |
|---|---|
| Test macro F1 | **0.4763** (previous model: 0.405) |
| Serving model | fine-tuned multilingual DistilBERT, chosen by a six-candidate benchmark |
| Decision rule | one tuned threshold per label, fitted on a validation split only |
| API | FastAPI, 24 endpoints, every response typed with pydantic |
| Tests | 147 backend tests (93% coverage on services), 33 frontend tests |

Full metrics and limitations: [MODEL_CARD.md](MODEL_CARD.md). Design decisions:
[docs/DECISIONS.md](docs/DECISIONS.md).

![Dashboard](docs/screenshots/dashboard-desktop.png)

---

## Quick start

You need **Python 3.11+** and **Node 18+**. From the project root:

```bash
pip install -r backend/requirements-dev.txt
python -m backend.etl                          # build the SQLite cache (~20 s)
python -m backend.model.train_model --fast     # train a model (~6 min, CPU only)
python -m uvicorn backend.main:app --port 8000
```

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. The API docs are at <http://localhost:8000/docs>.

If you skip the training step the API trains a model on first start and logs
its progress; the UI will show "Model unavailable" until it finishes.

### With Docker

```bash
docker compose up --build
```

UI on <http://localhost:5173>, API on <http://localhost:8000>. The API trains a
model on first start into a named volume, so later starts are fast. To build the
image with torch and serve a DistilBERT bundle, run
`INSTALL_ML=true docker compose up --build`.

### With make

```bash
make setup     # install backend and frontend dependencies
make etl       # rebuild the SQLite cache
make train     # full benchmark (needs a GPU for the transformer candidates)
make dev       # API and UI together
make test      # pytest + vitest
```

---

## Architecture

```mermaid
flowchart TB
    subgraph Data
        CSV[disaster_messages.csv<br/>disaster_categories.csv]
        DB[(SQLite<br/>messages + derived columns)]
    end

    subgraph ETL["backend/etl.py"]
        CLEAN[dedupe ids and messages<br/>parse 36 labels<br/>flag related=2 as noise]
        EVENT["services/events.py<br/>keyword + id-range event inference"]
    end

    subgraph Model["backend/model"]
        TRAIN[train_model.py<br/>60/20/20 split<br/>class balancing<br/>6-candidate benchmark]
        TUNE[evaluate.py<br/>per-label thresholds<br/>tuned on validation]
        BUNDLE[(disaster_model.joblib<br/>predictor + explainer<br/>thresholds + metrics)]
    end

    subgraph API["backend/main.py - FastAPI"]
        WARM[startup: precompute analytics<br/>load rules, load model]
        RA[/api/analytics/*]
        RP[/api/predict, /predict/batch]
        RR[/api/recommend]
        RM[/api/model/*]
        RH[/api/hazards]
    end

    subgraph Services["backend/services"]
        SEV[severity.py<br/>weighted noisy-OR]
        REC[recommend.py<br/>YAML rule table]
        LANG[language.py<br/>detect + translate]
        ANA[analytics.py<br/>cached aggregates]
        HAZ[hazards.py<br/>USGS / EONET / GDACS]
    end

    subgraph UI["frontend - React + Vite"]
        DASH[Dashboard]
        INS[Insights]
        PRED[Predict]
        TRI[Triage Inbox]
        HAZP[Live Hazards]
        MOD[Model]
    end

    CSV --> CLEAN --> EVENT --> DB
    DB --> TRAIN --> TUNE --> BUNDLE
    DB --> ANA --> WARM
    BUNDLE --> WARM
    WARM --> RA & RP & RR & RM & RH
    RP --> SEV & LANG
    RP --> REC
    RR --> REC
    RH --> HAZ
    RA --> DASH & INS
    RP --> PRED & TRI
    RM --> MOD
    RH --> HAZP
```

### Request flow for one prediction

1. `language.py` detects the language and translates to English when a backend
   is reachable; if not, the multilingual model classifies the original text.
2. The model returns 35 probabilities, each compared with its own tuned
   threshold.
3. `severity.py` combines the life-threatening categories with a weighted
   noisy-OR, so one confident signal escalates instead of being averaged away.
4. The explainer (a linear TF-IDF model) attributes the prediction to specific
   n-grams, which the UI highlights inline.
5. `recommend.py` matches the prediction against the rule table and returns a
   prioritised plan with teams, resources and urgency.

---

## Screens

| | |
|---|---|
| **Dashboard** - KPI cards with sparklines, clickable category drill-down, event comparison, genre x event and co-occurrence heatmaps | ![Dashboard](docs/screenshots/dashboard-desktop.png) |
| **Predict** - severity gauge, triggered labels with confidence, highlighted evidence, recommended action timeline | ![Predict](docs/screenshots/predict-desktop.png) |
| **Triage Inbox** - paste or upload a CSV, sort by severity, filter, export, resource demand forecast | ![Triage](docs/screenshots/triage-desktop.png) |
| **Insights** - term explorer, needs bundles, urgent vocabulary, keyword in context, data quality | ![Insights](docs/screenshots/insights-desktop.png) |
| **Model** - candidate comparison, per-label metrics, PR and threshold curves | ![Model](docs/screenshots/model-desktop.png) |
| **Live Hazards** - USGS, EONET and GDACS on a map, with an India filter and an offline state | ![Hazards](docs/screenshots/hazards-desktop.png) |

Light theme and 360px-wide captures of every page are in
[docs/screenshots](docs/screenshots).

Regenerate them with both servers running:

```bash
cd frontend && node scripts/screenshots.mjs http://localhost:5173 ../docs/screenshots
```

---

## API reference

Base URL `http://localhost:8000`. Interactive docs at `/docs`.

### Health

| Method | Path | Description |
|---|---|---|
| GET | `/` , `/health` | Readiness, row count, whether the model loaded |

### Analytics (served from the startup cache)

| Method | Path | Description |
|---|---|---|
| GET | `/api/analytics/summary-stats` | KPIs, sparklines and deltas |
| GET | `/api/analytics/category-distribution` | Count and share per category |
| GET | `/api/analytics/top-categories?limit=&needs_only=` | Top N for the bar chart |
| GET | `/api/analytics/volume-by-event` | Volume per inferred event, with provenance |
| GET | `/api/analytics/volume-by-genre` | Volume per source genre |
| GET | `/api/analytics/event-category-mix` | Need mix per event, as shares |
| GET | `/api/analytics/genre-event-matrix` | Genre x event heatmap |
| GET | `/api/analytics/category-cooccurrence` | Full matrix, Jaccard and top pairs |
| GET | `/api/analytics/needs-bundles?limit=` | Frequent category combinations |
| GET | `/api/analytics/message-length` | Length histogram and per-genre medians |
| GET | `/api/analytics/top-terms/{category}` | Distinctive terms for a category |
| GET | `/api/analytics/urgent-terms?limit=` | Vocabulary of urgent messages |
| GET | `/api/analytics/data-quality` | Duplicates, noise, imbalance, empties |
| GET | `/api/analytics/search?q=&category=&event=` | Keyword in context |

### Prediction and recommendation

| Method | Path | Description |
|---|---|---|
| POST | `/api/predict` | Classify one message with severity, explanation and plan |
| POST | `/api/predict/batch` | Triage up to 500 messages, sorted by severity |
| POST | `/api/predict/batch-csv` | The same from a CSV upload |
| POST | `/api/recommend` | Plan from a message or from explicit probabilities |
| GET | `/api/recommend/rules` | The rule table that drives the plans |

### Model and hazards

| Method | Path | Description |
|---|---|---|
| GET | `/api/model/info` | Serving model, training date, library versions |
| GET | `/api/model/performance` | Test metrics, per label, plus the benchmark |
| GET | `/api/model/curves/{category}` | PR curve and F1 by threshold |
| GET | `/api/model/global-terms/{category}` | Highest-weight features |
| GET | `/api/model/categories` | Categories with their tuned thresholds |
| GET | `/api/hazards?india_only=&source=&refresh=` | Live hazards, cached 10 minutes |

Example:

```bash
curl -s localhost:8000/api/predict \
  -H 'Content-Type: application/json' \
  -d '{"message":"We are trapped under a collapsed building and need water"}' \
  | python -m json.tool
```

```jsonc
{
  "severity": { "score": 100.0, "level": "critical", "contributors": [ /* ... */ ] },
  "event": "Other",
  "triggered_categories": ["related", "aid_related", "search_and_rescue", "water", "..."],
  "highlights": [ { "start": 12, "end": 19, "text": "trapped", "category": "aid_related" } ],
  "recommendation": {
    "immediate_count": 4,
    "actions": [
      {
        "action": "Dispatch a search and rescue team to the reported location",
        "agency": "Search and rescue",
        "urgency": "immediate",
        "resources": ["USAR team", "lifting and cutting equipment", "canine unit"],
        "rationale": "People are reported trapped or missing at the scene."
      }
    ]
  }
}
```

---

## Model results

Full detail, per-label numbers and honest limitations in
[MODEL_CARD.md](MODEL_CARD.md). Summary of the benchmark (test split, 5,198
messages, identical splits and tuning for every candidate):

| Model | Macro F1 | Micro F1 | Macro PR-AUC | Macro F1 at 0.5 |
|---|---|---|---|---|
| **distilbert** (serving) | **0.4763** | 0.6797 | 0.4554 | 0.3894 |
| tfidf_linearsvc_wordchar | 0.4578 | 0.6709 | 0.4294 | 0.3116 |
| tfidf_logreg_word | 0.4508 | 0.6570 | 0.4251 | 0.4337 |
| minilm_logreg | 0.4456 | 0.6681 | 0.4202 | 0.3528 |
| tfidf_logreg_wordchar | 0.4454 | 0.6472 | 0.4225 | 0.4381 |
| ensemble_sgd_cnb (previous design, tuned) | 0.4171 | 0.6250 | 0.3873 | 0.4097 |

The previous release reported 0.405 macro F1. The tuned version of that same
ensemble reaches 0.4171, so class balancing and per-label thresholds alone
account for part of the gain; DistilBERT adds the rest.

---

## Configuration

Copy `.env.example` to `.env` and adjust. Everything has a working default.

| Variable | Default | Purpose |
|---|---|---|
| `CORS_ORIGINS` | `http://localhost:5173,...` | Comma-separated allowed origins |
| `CORS_ALLOW_CREDENTIALS` | `true` | Ignored when the origin list is `*` |
| `DB_PATH` / `MODEL_PATH` / `RULES_PATH` | under `backend/` | Artifact locations |
| `AUTO_TRAIN` | `true` | Train on start when the bundle is missing or stale |
| `WARM_CACHE` | `true` | Precompute analytics at startup |
| `PREDICT_RATE_LIMIT` | `60/minute` | Per-client limit on `/api/predict` |
| `BATCH_RATE_LIMIT` / `BATCH_MAX_MESSAGES` | `10/minute` / `500` | Batch limits |
| `HAZARDS_ENABLED` / `HAZARDS_TTL_SECONDS` | `true` / `600` | Live feed proxy |
| `TRANSLATION_ENABLED` | `true` | Turn off to always classify the original text |
| `VITE_API_URL` | empty | API base for the frontend; empty uses the dev proxy |

---

## Project layout

```
backend/
  config.py            env-driven settings
  etl.py               CSV -> cleaned DataFrame -> SQLite
  main.py              app factory, middleware, startup warm-up
  schemas.py           pydantic request and response models
  state.py             shared corpus, analytics, model and rules
  routers/             analytics, predict, recommend, model, hazards
  services/            events, severity, analytics, recommend, explain,
                       language, hazards, incident, text
  model/               train_model.py, predictors.py, evaluate.py
  data/                raw CSVs, SQLite cache, recommendation_rules.yaml
  tests/               pytest suite
frontend/src/
  styles/tokens.css    design tokens, dark and light
  context/             theme and toast providers
  components/          shell primitives, charts, gauge, palette
  pages/               Dashboard, Insights, Predict, Triage, Hazards, Model, About
  scripts/             screenshot capture
docs/                  PLAN.md, DECISIONS.md, metrics.json, screenshots/
```

## Testing

```bash
python -m pytest                    # 147 tests
python -m pytest --cov=backend/services --cov-report=term
cd frontend && npm run test         # 33 tests
cd frontend && npm run lint
```

The backend suite runs against the real corpus and the real model bundle when
one is present; model-dependent tests skip cleanly when it is not.

## Credits

Dataset: Figure-Eight / Appen disaster response messages. Hazard feeds: USGS
earthquake catalogue, NASA EONET, GDACS. Map tiles: OpenStreetMap contributors.
Icons: Lucide. Charts: Recharts.

DisasterIQ is a decision-support prototype. It is not a warning system and must
not be used to decide that a message does not need a human.
