# DisasterIQ

Historical impact analytics, risk prediction and preparedness and response
recommendations for three disaster types:
**earthquake, flood and cyclone/hurricane**.

Every historical number is computed from public disaster-impact data:
deaths, people affected, economic loss, frequency and geography from
**EM-DAT via Our World in Data**, earthquake locations from the **USGS**
catalogue, and cyclone tracks from **NOAA IBTrACS**. Live events come from
USGS, GDACS and NASA EONET. A metric that is not in these sources is shown as
unavailable, never estimated. See [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)
for where every number comes from.

It follows **Analyze → Predict → Recommend**, for all three disasters:

1. **Analytics** (Level 1): the earthquake, flood and cyclone pages analyse
   history, including a Recovery & resilience block from what EM-DAT records.
2. **Disaster Risk Prediction** (Level 2): *flood* risk for Kerala's 14 districts
   from a logistic regression trained on the India Flood Inventory and NASA
   POWER (test ROC-AUC 0.79 on 2013–2023); *earthquake* and *cyclone* risk for
   India's 36 states and union territories from a **statistical hazard index**
   over the USGS catalogue and NOAA IBTrACS tracks. That index is not a trained
   model, and the page says so. All three use the same four risk levels.
3. **Preparedness & Response Recommendations** (Level 3): for the hazard you
   pick, rule-based preparedness actions (retrofitting, drills, evacuation
   routes, pre-positioning) and a formula-based response estimate (rescue
   boats or search-and-rescue teams or cyclone shelters, medical teams, food,
   water, shelter), both driven by the Level 2 risk. River-gauge data is not
   included.

## Quick start

```bash
pip install -r backend/requirements-dev.txt
cd frontend && npm install && cd ..

python -m uvicorn backend.main:app --port 8000   # API
cd frontend && npm run dev                        # UI on http://localhost:5173
```

The cleaned data is committed in `backend/data/clean/`, so the API starts
offline and builds its SQLite store (`backend/data/disasters.db`) in about a
second. To re-fetch and rebuild from the sources:

```bash
python -m backend.data_pipeline            # download what is missing, clean, store
python -m backend.data_pipeline --refresh  # re-download everything
python -m backend.data_pipeline --verify   # print known disasters next to public figures
```

The flood-risk features are committed too (`backend/data/clean/flood/`). To
rebuild them, or refresh only the latest 30 days from NASA POWER before a demo:

```bash
python -m backend.flood_pipeline            # IFI, NASA POWER, elevation, census, boundaries
python -m backend.flood_pipeline --current  # re-fetch the latest NASA POWER data only
python -m backend.hazard_pipeline           # earthquake and cyclone counts per Indian state
python -m backend.services.flood_risk       # print the model's test metrics and back-tests
```

With make: `make setup`, `make data`, `make verify`, `make flood-current`, `make dev`, `make test`.
With Docker: `docker compose up --build` (API on 8000, UI on 5173).

## Pages

| Route | Page | Content |
|---|---|---|
| `/` | Overview | Type cards; live strip; sortable comparison table (events, deaths, affected, loss, countries, per-event averages); global deaths and loss trend; top-15 most severe records across all types; source panel |
| `/earthquake`, `/flood`, `/cyclone` | Disaster pages | Eight full-width blocks: human impact, economic impact, frequency & trends, geography, severity, time-based analysis, correlation, recovery & resilience (reconstruction cost and outcome indicators by decade; no recovery timeline exists in the data); plus a live "right now" card and the Analyze → Predict → Recommend links |
| `/map` | World Map | **Live now**: current events from USGS, GDACS, NASA EONET. **Historical**: decade slider; USGS earthquakes and IBTrACS cyclones at exact positions; EM-DAT floods at country centres |
| `/risk?type=flood\|earthquake\|cyclone` | Disaster Risk Prediction (Level 2) | A selector for the three hazards. **Flood**: Kerala districts, logistic regression on the latest 30 days of NASA POWER rainfall and soil moisture, elevation and India Flood Inventory history, with back-test replays (Aug 2018, Aug 2019, Jun 2013, Sep 2018), a "check a region" scorer with per-factor contributions and a model card. **Earthquake / cyclone**: Indian states, annual probability from catalogue counts, the cut-offs, a "check a state" view, known-event checks and what the index does not include |
| `/preparedness?type=…` | Preparedness & Response Recommendations (Level 3) | Two labelled parts. **Preparedness**: states or districts ranked by risk, with the rule-based actions that fire for each and why. **Response**: resources in priority order (people needing assistance, medical teams, food, water, shelter, plus boats, rescue teams or cyclone shelters), the arithmetic for each line, and every parameter with its basis |
| `/about` | About the data | Sources, methods, what is not available |

Every chart has an insight headline, loading/empty/error states, a data table
and CSV/PNG export, and a badge naming its source.

## Architecture

```
backend/
  data_pipeline.py     fetch → clean (backend/data/clean/*.csv) → SQLite store
  services/history.py  every analytics payload, precomputed at startup
  disaster_types.py    the five types: OWID column, point source, feed codes
  live_feeds.py        USGS / GDACS / NASA EONET, merged, cached 10 min
  flood_pipeline.py    Kerala: IFI + NASA POWER + DEM + census -> backend/data/clean/flood/
  services/flood_risk.py   Level 2 model, fitted and evaluated at startup
  hazard_pipeline.py   India states: USGS + IBTrACS + census -> backend/data/clean/hazard/
  services/hazard_risk.py  Level 2 earthquake and cyclone index
  services/recommendations.py  Level 3 rules and formula, all three hazards
  routers/             /api/disasters, /api/history, /api/live, /api/flood-risk, /api/hazard-risk, /api/recommendations
frontend/src/
  config/disasterTypes.js   the UI taxonomy (id, label, icon, colour)
  config/sources.js         the source registry behind every badge
  pages/                    Overview, DisasterPage (+ pages/disaster/*), WorldMap, About
  components/history/       blocks, choropleth/point map, historical map layer
```

## API

| Method | Path | Returns |
|---|---|---|
| GET | `/health` | readiness, record count, data build time |
| GET | `/api/disasters/types` | the five types and their data mapping |
| GET | `/api/disasters/overview` | comparison table, global severity ranking, global trend, coverage |
| GET | `/api/disasters/{id}` | the eight analysis blocks for one type |
| GET | `/api/history/map?decade=&types=` | historical map layers for one decade |
| GET | `/api/live/events?type=&refresh=` | merged live events and per-source status |
| GET | `/api/live/summary` | live counts per type |
| GET | `/api/flood-risk` | flood model card, test metrics, back-tests, current risk per district |
| GET | `/api/flood-risk/scenario/{id}` | `current` or a back-test month such as `2018-08` |
| GET | `/api/flood-risk/score?district=&…` | risk and per-factor contributions for a district or hand-entered conditions |
| GET | `/api/hazard-risk/{earthquake\|cyclone}` | state-level risk index, method, cut-offs, known-event checks |
| GET | `/api/recommendations/{earthquake\|flood\|cyclone}?scenario=&days=` | preparedness actions and response estimate per region, rules, formula, parameters |

## Tests

```bash
python -m pytest          # pipeline, analytics, known-event checks, endpoints, live feeds
cd frontend && npm test   # components, formatting, taxonomy
```

## Data licences

EM-DAT via Our World in Data (CC BY 4.0, cite CRED / UCLouvain), USGS and NOAA
(US public domain), Natural Earth (public domain), OpenStreetMap tiles
(© OpenStreetMap contributors).
