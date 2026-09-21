# DisasterIQ — Analytics & Prediction Platform

A full-stack web application that ingests real disaster response data, surfaces interactive analytics, and runs a trained ML model to classify incoming messages across 35 disaster categories.

---

## What's inside

| Layer | Stack |
|---|---|
| Backend API | FastAPI + uvicorn |
| ETL / data | pandas → SQLite |
| ML model | TF-IDF + SGD + ComplementNB ensemble (scikit-learn) |
| Frontend | React 19 + Vite + Tailwind CSS v4 + Recharts |

**Dataset:** Figure-Eight — ~26,000 messages from the Haiti earthquake, Chile earthquake, Pakistan floods, and Superstorm Sandy, labelled across 36 categories.

---

## Project structure

```
Disaster Management/
├── backend/
│   ├── data/
│   │   ├── disaster_messages.csv       # raw messages
│   │   ├── disaster_categories.csv     # raw labels
│   │   └── disaster.db                 # SQLite (auto-generated)
│   ├── model/
│   │   ├── train_model.py              # training script
│   │   └── disaster_model.joblib       # saved model (auto-generated)
│   ├── etl.py                          # load / clean / analytics helpers
│   ├── main.py                         # FastAPI app
│   ├── test_api.py                     # smoke-test script
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── api/client.js               # fetch wrappers for all endpoints
    │   ├── components/
    │   │   ├── CategoryBarChart.jsx
    │   │   ├── VolumeChart.jsx
    │   │   ├── KpiCard.jsx
    │   │   └── Spinner.jsx
    │   ├── pages/
    │   │   ├── Dashboard.jsx
    │   │   └── Predict.jsx
    │   ├── App.jsx
    │   ├── main.jsx
    │   └── index.css
    ├── index.html
    ├── vite.config.js
    └── package.json
```

---

## Quick start

You need **Python 3.10+** and **Node 18+**.

### 1 — Install Python dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 2 — Train the model (one-time, ~15 seconds)

The raw CSVs are already in `backend/data/`. Run:

```bash
cd backend
python model/train_model.py
```

This produces `backend/model/disaster_model.joblib` and prints a per-category F1 report.

> If `disaster.db` doesn't exist yet it will be created automatically on first run.

### 3 — Start the backend

```bash
cd backend
uvicorn main:app --reload --port 8000
```

API is now at `http://localhost:8000`. Interactive docs at `http://localhost:8000/docs`.

### 4 — Install frontend dependencies

```bash
cd frontend
npm install
```

### 5 — Start the frontend dev server

```bash
cd frontend
npm run dev
```

Open **http://localhost:5173** in your browser.

> The Vite dev server proxies all `/api/*` requests to `http://localhost:8000`, so no manual CORS setup is needed during development.

---

## API reference

All endpoints are served at `http://localhost:8000`.

### Analytics

| Method | Path | Description |
|---|---|---|
| GET | `/api/analytics/summary-stats` | KPI block — total messages, top categories, genre breakdown, urgent count |
| GET | `/api/analytics/category-distribution` | All 35 categories sorted by message count |
| GET | `/api/analytics/top-categories?limit=N` | Top N categories (default 15) |
| GET | `/api/analytics/volume-by-event` | Message volume by source genre (direct / news / social) |
| GET | `/api/analytics/category-cooccurrence?limit=N` | Top N co-occurring category pairs |

### Prediction

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/api/predict` | `{"message": "..."}` | Classify a message — returns confidence per category + severity score |

**Predict response shape:**
```json
{
  "message": "People need food and water after the earthquake",
  "predictions": [
    { "category": "food", "confidence": 0.94, "triggered": true },
    ...
  ],
  "severity": { "score": 38.1, "level": "high" },
  "triggered_count": 11,
  "model_macro_f1": 0.405
}
```

**Severity levels:** `low` · `medium` · `high` · `critical`

---

## ML model details

| Component | Choice | Reason |
|---|---|---|
| Vectoriser | TF-IDF (unigrams + bigrams, max 60k features, sublinear TF) | Fast, strong baseline for short text |
| Classifier A | SGDClassifier (modified Huber loss) | Approximates SVM, gives calibrated probabilities |
| Classifier B | ComplementNB | Excellent on imbalanced multi-label text |
| Ensemble | Weighted blend — SGD 60%, NB 40% | Better recall on rare categories |
| Output | MultiOutputClassifier over 35 categories | One binary head per label |

**Key per-category F1 scores** (test set, 20% split):

| Category | F1 |
|---|---|
| related | 0.880 |
| earthquake | 0.745 |
| weather_related | 0.714 |
| food | 0.685 |
| water | 0.671 |
| storm | 0.625 |
| direct_report | 0.595 |
| shelter | 0.581 |
| floods | 0.582 |
| macro average | 0.405 |

The lower macro average is expected — categories like `offer`, `shops`, and `tools` have fewer than 30 positive examples in the test set.

---

## Retrain from scratch

```bash
cd backend
python etl.py          # rebuilds disaster.db
python model/train_model.py   # retrains and overwrites disaster_model.joblib
```

---

## Production build

```bash
cd frontend
npm run build          # outputs to frontend/dist/
```

Serve `frontend/dist/` with any static host (Netlify, Vercel, nginx). Point the API base URL to your deployed FastAPI instance.

---

## Data sources

- **Messages + labels:** [prateeksawhney97/Disaster-Response-Pipeline](https://github.com/prateeksawhney97/Disaster-Response-Pipeline) — Figure-Eight dataset
- **ETL reference:** [GuillaumeVerb/Disaster-Response-Pipelines](https://github.com/GuillaumeVerb/Disaster-Response-Pipelines)
- **Model reference:** [ManishaLagisetty/Natural-Disaster-Prediction-Using-Machine-Learning](https://github.com/ManishaLagisetty/Natural-Disaster-Prediction-Using-Machine-Learning)
