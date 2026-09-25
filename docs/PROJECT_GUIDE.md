# DisasterIQ: project guide

A plain-language explanation of what DisasterIQ is, how it works, which APIs and
data it uses, where every dataset came from, and what it can and cannot tell you.

Live demo: https://disasteriq-53x1.onrender.com · API: https://disaster-qi.onrender.com ·
Code: https://github.com/Revanthvu4661/Disaster-IQ

---

## 1. What the project does

The problem statement: build a disaster management and analytics system for
**earthquakes, floods and cyclones** that analyses historical data, predicts
risk, and recommends preparedness and response actions.

DisasterIQ follows three levels, for all three disasters:

| Level | What it answers | Where in the app |
|---|---|---|
| **1. Analytics** | What has happened? Deaths, people affected, economic loss (in ₹), frequency, geography, severity, recovery, over 1900–2025 | Overview, Earthquake, Flood, Cyclone/Hurricane pages, World Map |
| **2. Prediction** | Where is the risk highest? | **Disaster Risk Prediction** page |
| **3. Recommendation** | What should we do about it? | **Preparedness & Response Recommendations** page |

You can walk the chain from any disaster page: *Analyze → Predict → Recommend*.

---

## 2. How it is built

```
Browser (React app)  ──HTTP──▶  FastAPI backend (Python)  ──▶  in-memory data + SQLite file
                                        │
                                        └──▶ live feeds: USGS, GDACS, NASA EONET (cached 10 min)
```

- **Frontend:** React 19 with Vite, React Router, Recharts (charts), Leaflet
  (maps), lucide icons. Light and dark themes, works from 360 px phones to desktop.
- **Backend:** Python with FastAPI. It uses pandas, NumPy and SciPy for analysis,
  scikit-learn for the flood model, shapely for map geometry and httpx for the
  live feeds.
- **Hosting (deployed):** the API runs as a Render *Web Service*, the frontend as a
  Render *Static Site*. They talk over HTTPS; the API allows the frontend's address
  through the `CORS_ORIGINS` setting.

### Is there a database?

There is **no external database server** (no MySQL, Postgres or MongoDB).

- The data lives as small **CSV files committed in the repository**
  (`backend/data/clean/`, about 3 MB in total).
- When the API starts it loads them into memory and builds a **SQLite** file
  (`backend/data/disasters.db`) from them in about a second. That file is not
  committed; it is rebuilt at each start, which is why the app also works offline.
- All analytics are computed once at start-up and served from memory, so requests
  return in milliseconds.

The raw downloads (`backend/data/raw/`, about 150 MB, mostly the IBTrACS file) are
git-ignored. They are only needed to *rebuild* the CSVs.

---

## 3. Where the data came from

Everything was collected from **public, free sources with no API key**. Each was
downloaded once by a pipeline script, cleaned, and saved as a CSV. Only the live
feeds (section 3.2) are called while the app is running.

### 3.1 Historical and modelling data (downloaded once, then committed)

| Data | Source | What it gives us | How we got it |
|---|---|---|---|
| **Disaster impact** | **EM-DAT** (CRED / UCLouvain), published by **Our World in Data** (OWID) | Deaths, injured, people affected, homeless, economic damage, reconstruction cost, per country per year, for earthquakes, floods and storms, 1900–2025 | `catalog.ourworldindata.org/explorers/emdat/.../natural_disasters_yearly.csv`, plus OWID's world event-count and country-code files |
| **Earthquake catalogue** | **USGS ComCat** | Every earthquake of magnitude 6.0 or more since 1900: date, location, depth, magnitude (14,354 events) | `earthquake.usgs.gov/fdsnws/event/1/query`, one request per decade |
| **Cyclone tracks** | **NOAA IBTrACS v04r01** | Every tropical storm since 1980: 6-hourly positions and wind speed (4,031 storms in the cleaned table; North Indian Ocean tracks used for the risk index) | `ncei.noaa.gov/.../ibtracs.since1980.list.v04r01.csv` |
| **Country shapes** | **Natural Earth** (50 m and 110 m) | Country outlines and centre points for maps | Natural Earth admin-0 GeoJSON |
| **Exchange rate** | **World Bank WDI**, series `PA.NUS.FCRF` (from IMF) | Rupees per US$ by year, to show money in ₹ | `api.worldbank.org/v2/country/IND/indicator/PA.NUS.FCRF` |
| **Kerala flood events** | **India Flood Inventory v3.0** (IIT Delhi HydroSense Lab, from IMD reports) | Flood events 1967–2023 with the districts they touched and deaths. This is the flood model's **training label** | `github.com/hydrosenselab/India-Flood-Inventory` |
| **Rainfall and soil moisture** | **NASA POWER** daily point API | Precipitation and root-zone soil wetness at each Kerala district centre, 1981 to a few days ago | `power.larc.nasa.gov/api/temporal/daily/point` |
| **Elevation** | **Open-Meteo elevation API** (Copernicus GLO-90 DEM). Open-Elevation was tried first but its security certificate had expired | Mean elevation and low-lying land share per district (655 sample points) | `api.open-meteo.com/v1/elevation` |
| **District and state boundaries** | **geoBoundaries** (ODbL) | 14 Kerala district polygons and 36 Indian state and union-territory polygons | `github.com/wmgeolab/geoBoundaries` |
| **Population** | **Census of India 2011**, district table | Population and households; summed to states (checked against India's 1,210,854,977) and Kerala (33,406,061) | GitHub mirror `nishusharma1608/India-Census-2011-Analysis` |
| **Kerala rainfall + flood flag** | **IMD** subdivision data, via the public "Kerala flood dataset" | Yearly rainfall 1901–2018 with a yes/no flood flag. Used only as an independent **check** (see 5.1) | GitHub mirror `amandp13/Flood-Prediction-Model` |

Humanitarian planning standards used in the recommendations: the **Sphere
Handbook (2018)** (15 L water and 3.5 m² shelter per person, 2,100 kcal food) and
the **WHO Emergency Medical Team** classification (Type 1 mobile team: at least 50
outpatients a day).

### 3.2 Live feeds (called while the app runs)

| Feed | Used for | Cache |
|---|---|---|
| **USGS** earthquake feed (M4.5+, past 7 days) | Live earthquakes on the World Map and Overview | 10 minutes |
| **GDACS** (Global Disaster Alert and Coordination System) | Live earthquake, cyclone and flood alerts | 10 minutes |
| **NASA EONET** | Live storm and flood events | 10 minutes |

The backend merges records of the same event from different sources, keeps each
source's own reading, and marks a feed as *stale* or *unavailable* if it fails.
It never shows a failed feed as "no disasters".

### 3.3 Map tiles

The map background comes from **Esri World Light/Dark Gray** tiles (no key needed),
loaded by the browser. MapTiler or CARTO are used instead if you set a key.

---

## 4. The APIs

### 4.1 External APIs the project calls

| API | When | Key needed? |
|---|---|---|
| USGS FDSN and summary feeds | Building data; live feed | No |
| NASA POWER | Building the flood data | No |
| Open-Meteo elevation | Building the flood data | No |
| World Bank | Building the exchange-rate table | No |
| GDACS, NASA EONET | Live feed | No |
| GitHub raw files (IFI, census, boundaries) | Building data | No |

### 4.2 The project's own REST API (FastAPI, prefix `/api`)

| Endpoint | Returns |
|---|---|
| `GET /health` | Readiness: analytics, flood model and hazard index loaded |
| `GET /api/disasters/types` | The three disaster types |
| `GET /api/disasters/overview` | Comparison table, severity ranking, global trend |
| `GET /api/disasters/{earthquake\|flood\|cyclone}` | The eight analysis blocks for one type, including recovery and resilience |
| `GET /api/history/map?decade=&types=` | Historical map layers for one decade |
| `GET /api/live/events`, `/api/live/summary` | Merged live events and their feed status |
| `GET /api/flood-risk` | Flood model card, test metrics, back-tests, current risk per Kerala district |
| `GET /api/flood-risk/scenario/{id}` | The latest 30 days, or a past month replayed (`2018-08`, `2019-08`, `2013-06`, `2018-09`) |
| `GET /api/flood-risk/score?...` | Score a district or hand-entered conditions, with each factor's contribution |
| `GET /api/hazard-risk/{earthquake\|cyclone}` | Risk index per Indian state, method and cut-offs |
| `GET /api/recommendations/{hazard}?days=&scenario=` | Preparedness actions and response resources per region |

Interactive documentation is generated automatically at `/docs` on the API.

---

## 5. Level 2: how risk is predicted

All three hazards use the same four levels (**Low, Medium, High, Critical**), the
same map and table, but each states its own method.

### 5.1 Flood: a trained machine-learning model (Kerala, 14 districts)

- **Model:** logistic regression (scikit-learn). A random forest was tried and was
  not better, so the simpler, explainable model is used.
- **What it predicts:** the probability that a flood is recorded in a district in
  a 30-day window of the monsoon (June–September).
- **Training data:** 2,408 district-months, 1981–2023. The **label** (flood or not)
  comes from the India Flood Inventory.
- **Inputs (5):** rainfall as a percentage of normal; heaviest 3-day rainfall; soil
  wetness in the week before (NASA POWER); mean elevation; the district's flood
  history over the previous 10 seasons.
- **Tested honestly:** trained on 1981–2012, scored on 2013–2023, which it never
  saw. ROC-AUC **0.79**; at the "medium or above" cut-off it catches 79% of
  recorded floods with 57% precision. Baselines (history only, district averages,
  "always no flood") are shown alongside.
- **Known events, out of sample:** August 2019, 12 of 14 districts high or critical
  (all 14 flooded); June 2013, 11 flagged; the quiet September 2018, none flagged.
  August 2018 is under-rated (dam releases are not an input), and the page says so.
- **Why not the "Kerala flood dataset" as the label:** it is one row per year for
  the whole state, and its flood flag is almost exactly a cut-off on annual rainfall
  (every "no" year at most 2,931 mm, every "yes" year at least 2,923 mm). A model
  trained on it would only relearn that line. It is used as a **check** instead:
  the model's statewide risk separates that dataset's flood years with AUC 0.89.
- **Explained, not a black box:** every score shows how much each input raised or
  lowered the risk.
- **Not included:** river-gauge levels (no free source was integrated), dam
  releases, rainfall forecasts. The page says this in a banner.

### 5.2 Earthquake and cyclone: a statistical index (Indian states, 36 regions)

These are **not** trained models, and the app says so on the page.

- **Earthquake:** count of M6+ earthquakes (USGS, 1950–2025) whose epicentre is
  inside a state or within 300 km of it; also M7+ separately.
- **Cyclone:** count of storms (NOAA IBTrACS, 1980–2025 seasons) whose centre
  passed within 100 km of a state, at tropical-storm (34 kt) and hurricane (64 kt)
  strength.
- **Turning counts into risk:** annual probability = 1 − exp(−events ÷ years). Each
  level has a fixed, published cut-off, and the state gets the higher level of the
  two tests. Example: Ladakh has an 80% chance a year of an M6+ earthquake nearby
  (critical); Gujarat is medium because of a single M7+ (Bhuj, 2001).
- **Checked:** nine well-known events (Bhuj 2001, Assam–Tibet 1950, Nepal 2015,
  Kashmir 2005, the 1999 Odisha cyclone, Fani, Amphan, Hudhud, Tauktae) are found
  near the right state.
- **Limits:** the cut-offs are return-period judgements, not calibrated to losses;
  it counts nearby events, not ground conditions or building quality; it says how
  often, not when.

---

## 6. Level 3: how recommendations are made

Rule-based and formula-based, not a model, so every number can be traced. The page
is labelled a **decision-support estimate**, not a dispatch order.

- **Preparedness (before a disaster):** a rule table per hazard. An action fires
  when a region's risk level reaches the rule's minimum level (some also need a
  condition, such as low-lying land) and shows **why** it fired. Examples:
  earthquake, retrofit schools and hospitals, pre-position search-and-rescue teams;
  flood, clear drains, publish evacuation routes, pre-position boats; cyclone,
  check warning dissemination, maintain evacuation routes, wind-resistant shelters.
  Rules are general practice, to be confirmed against NDMA and State Disaster
  Management Authority guidance.
- **Response (during and after):** people needing assistance = population (Census
  2011) × a share set by the risk level; then medical teams, food, water and shelter
  from Sphere/WHO figures; plus one hazard-specific line: rescue boats (flood),
  search-and-rescue teams (earthquake) or cyclone shelters (cyclone). Regions are
  ranked by risk level, then people, then probability.
- **Honesty about the numbers:** each parameter is labelled **Standard** (Sphere,
  WHO), **Data** (Census, elevation, EM-DAT) or **Assumption**. The exposure
  shares, the boat throughput and the team and shelter sizes are our assumptions to
  be replaced with official planning figures. Existing shelter capacity and stock on
  hand are not public and are not included.

---

## 7. Level 1: what the analytics show

Each disaster page has eight full-width blocks: human impact, economic impact
(₹ in lakh/crore), frequency and trends, geography (map), severity, time-based
analysis, correlation, and **recovery and resilience**.

- **Severity index:** 0–100 from deaths (weight 0.5), people affected (0.25) and
  economic loss (0.25), each on a log scale.
- **Money in ₹:** EM-DAT reports US$; each record is converted at that year's
  average exchange rate (World Bank), not adjusted for inflation. Hover shows the
  original US$ figure.
- **Recovery and resilience:** only what EM-DAT records: reconstruction costs (only
  12 earthquake, 16 flood and 9 cyclone records report one) and deaths per 1,000
  affected and damage as a share of GDP by decade. Recovery time and rebuilding
  progress do not exist in any source, so no timeline is shown.
- **Important definition:** EM-DAT counts a "disaster" only if it killed 10+ people,
  affected 100+, led to a state of emergency or triggered an appeal for
  international aid. So "284 earthquake disasters in the 2000s" is not a count of
  every earthquake: USGS lists 1,585 earthquakes of M6+ in the same decade, and far
  more smaller ones exist. The page shows both counts side by side.

---

## 8. Honesty rules used throughout

- Every card has a **source badge** naming its data: *OWID / EM-DAT*, *USGS*,
  *Model estimate*, *Statistical index*, *Formula estimate* or *Live feed*.
- A number that no source provides is shown as **"not available"** with the reason,
  never estimated.
- Where data is thin (EM-DAT before about 1980), charts are shaded and trend
  verdicts use 1980 onwards.
- Every method page lists **what it does not account for**.

---

## 9. Project layout

```
backend/
  main.py                 FastAPI app and start-up
  data_pipeline.py        downloads and cleans EM-DAT, USGS, IBTrACS, boundaries, FX
  flood_pipeline.py       Kerala: flood inventory, NASA POWER, elevation, census
  hazard_pipeline.py      Indian states: earthquake and cyclone counts
  live_feeds.py           USGS / GDACS / NASA EONET, merged and cached
  services/               history.py (analytics), flood_risk.py (model),
                          hazard_risk.py (index), recommendations.py (rules + formula)
  routers/                the REST endpoints
  data/clean/             committed CSVs the app runs on
  tests/                  73 automated tests
frontend/src/             React app: pages/, components/, config/, styles/
docs/                     PLAN.md, DATA_SOURCES.md, DECISIONS.md, this guide
```

More detail: `docs/DATA_SOURCES.md` (every source and formula) and
`docs/DECISIONS.md` (why each choice was made).

## 10. Running and refreshing

```bash
pip install -r backend/requirements-dev.txt
cd frontend && npm install && cd ..
python -m uvicorn backend.main:app --port 8000      # API
cd frontend && npm run dev                          # UI on http://localhost:5173
```

- Rebuild the historical data: `make data`. Flood data: `make flood-data`.
  Latest 30 days only: `make flood-current`. Risk index: `make hazard-data`.
- Tests: `python -m pytest` (backend), `npm test` (frontend). Lint: `npm run lint`.
- Docker: `docker compose up --build`.

## 11. Known limitations

- The flood model covers **Kerala only**; earthquake and cyclone risk cover
  **Indian states** (state-sized regions, so a single event affects only part of
  one).
- Flood "current" risk uses NASA POWER data about 4 days behind real time and does
  not use a rainfall forecast.
- Population is Census 2011.
- The free hosting tier sleeps after about 15 minutes idle; the first request
  afterwards can take a minute.
