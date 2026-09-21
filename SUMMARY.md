# DisasterIQ — Project Summary Document

> Auto-updated by Kiro on every file save/create/delete.  
> Last updated: **2026-09-21 23:43**

---

## Project Overview

**DisasterIQ** is a full-stack Disaster Management Analytics & Prediction Platform.  
It ingests real Figure-Eight disaster response data (~26,000 messages), surfaces interactive
analytics, and classifies incoming messages across 35 disaster categories using a trained
ML ensemble model.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend API | FastAPI + uvicorn (Python) |
| ETL / Storage | pandas → SQLite |
| ML Model | TF-IDF + SGD + ComplementNB ensemble (scikit-learn) |
| Frontend | React 19 + Vite + Tailwind CSS v4 + Recharts |

---

## How to Run

### Backend
```bash
cd backend
pip install -r requirements.txt
python model/train_model.py   # one-time model training (~15 s)
uvicorn main:app --reload --port 8000
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

> 9 backend files · 14 frontend files

```
├── backend/
│   ├── data/
│   │   ├── disaster.db  (6.1 MB)
│   │   ├── disaster_categories.csv  (11.3 MB)
│   │   └── disaster_messages.csv  (4.8 MB)
│   ├── model/
│   │   ├── disaster_model.joblib  (64.2 MB)
│   │   └── train_model.py  (8.3 KB)
│   ├── etl.py  (6.8 KB)
│   ├── main.py  (6.8 KB)
│   ├── requirements.txt  (129 B)
│   └── test_api.py  (1.2 KB)
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   │   └── client.js  (918 B)
│   │   ├── components/
│   │   │   ├── CategoryBarChart.jsx  (3.8 KB)
│   │   │   ├── KpiCard.jsx  (4.7 KB)
│   │   │   ├── Spinner.jsx  (832 B)
│   │   │   └── VolumeChart.jsx  (3.3 KB)
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx  (10.5 KB)
│   │   │   └── Predict.jsx  (16.1 KB)
│   │   ├── App.jsx  (4.2 KB)
│   │   ├── index.css  (4.6 KB)
│   │   └── main.jsx  (322 B)
│   ├── index.html  (389 B)
│   ├── package-lock.json  (64.5 KB)
│   ├── package.json  (580 B)
│   └── vite.config.js  (352 B)
├── README.md  (5.9 KB)
└── update_summary.py  (8.8 KB)
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/api/analytics/summary-stats` | KPIs — totals, top categories, genre breakdown |
| GET | `/api/analytics/category-distribution` | All 35 categories sorted by count |
| GET | `/api/analytics/top-categories?limit=N` | Top N categories |
| GET | `/api/analytics/volume-by-event` | Message volume by genre (direct/news/social) |
| GET | `/api/analytics/category-cooccurrence?limit=N` | Top co-occurring category pairs |
| POST | `/api/predict` | Classify a message → confidence per category + severity |

---

## ML Model

- **Vectoriser:** TF-IDF (unigrams + bigrams, 60 k features, sublinear TF)
- **Ensemble:** SGDClassifier (60 %) + ComplementNB (40 %) via MultiOutputClassifier
- **Output:** 35 binary category heads (child_alone dropped — zero positive examples)
- **Threshold:** 0.50 confidence to trigger a category
- **Severity scoring:** Weighted urgency across 13 critical categories → score 0–100

### Key F1 Scores (test set, 20 % split)

| Category | F1 |
|---|---|
| related | 0.880 |
| earthquake | 0.745 |
| weather_related | 0.714 |
| food | 0.685 |
| water | 0.671 |
| storm | 0.625 |
| direct_report | 0.595 |
| **macro average** | **0.405** |

---

## Dataset

- **Source:** Figure-Eight (now Appen)
- **Events:** Haiti earthquake · Chile earthquake · Pakistan floods · Superstorm Sandy
- **Raw rows:** 26,248 messages
- **After cleaning:** 26,177 messages (209 duplicates removed)
- **Labels:** 36 categories → 35 active (child_alone has 0 positives)
- **Genre split:** News 49.8 % · Direct 41.1 % · Social 9.1 %

---

## UI Pages

### Dashboard (`/`)
- 4 KPI cards: total messages, category count, urgent messages, top categories
- Genre source breakdown with proportional bar
- Category distribution bar chart with top-N filter (10 / 15 / 20 / 35)
- Volume by source bar chart
- Model info strip with link to Predict page

### Predict (`/predict`)
- Free-text input for any disaster message
- 5 one-click example messages
- Severity card: score 0–100, levels low / medium / high / critical
- Triggered categories list with confidence bars
- Expandable full 35-category confidence view

---

## Change Log

| Date | Change |
|---|---|
| 2026-09-21 | Project files updated |
| 2026-09-21 | Initial summary generation |
| 2026-09-21 | Initial build — ETL, ML model, FastAPI, React dashboard complete |
