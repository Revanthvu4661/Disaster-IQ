# DisasterIQ upgrade plan

Goal: turn DisasterIQ into an Analyze → Predict → Recommend platform with honest
metrics, an explainable model, a rule-driven recommendation engine, and an
accessible, responsive UI.

## Phases

| # | Phase | Scope | Done when |
|---|---|---|---|
| 1 | Bug fixes + ETL | noisy-OR severity, `related=2` handling, event inference stored in SQLite, cached analytics, CORS env config, `VITE_API_URL`, requirements ranges, co-occurrence matrix | backend starts, analytics endpoints return cached data, severity unit tests pass |
| 2 | Model | 60/20/20 split, `class_weight="balanced"`, per-label thresholds tuned on validation, test-set metrics, benchmark 4 candidate models, `MODEL_CARD.md` | best model persisted with thresholds + sklearn version; macro-F1 > 0.405 on test |
| 3 | Recommend + explain | `services/recommend.py` + `data/recommendation_rules.yaml`, `POST /api/recommend`, top-term explanations from linear coefficients | plan returned for a message end to end; explanation words non-empty |
| 4 | Analytics endpoints | event × category, genre × event, co-occurrence matrix, needs bundles, text analytics, data quality, model performance, KWIC | all endpoints documented in OpenAPI with pydantic models |
| 5 | Frontend | design tokens + light/dark, app shell, command palette, Dashboard, Insights, Predict, Model, About | build passes, screenshots at 360px/1280px reviewed |
| 6 | Batch / multilingual / live hazards | `POST /api/predict/batch` (CSV + JSON), language detect + translate fallback, USGS/EONET/GDACS cached proxy, Triage Inbox + Live Hazards pages | CSV upload triages and exports; hazards degrade to offline state |
| 7 | Tests + Docker + docs | pytest suite (services ≥ 80%), Vitest component tests, Dockerfile, compose, `.env.example`, Makefile, README rewrite | `make test` green, README runnable by a stranger |

## Sequencing rules

- Commit after each phase.
- After each phase: backend tests, frontend build + lint, both servers up, real
  endpoint calls, Playwright screenshots at 360 and 1280 px, visual fixes.
- No metric appears in docs or UI unless it came from an actual run.
- Ambiguities go in `docs/DECISIONS.md`.

## Target layout

```
backend/
  main.py              app factory, middleware, startup cache warm
  config.py            env-driven settings
  routers/             analytics, predict, recommend, hazards, model
  services/            events, severity, analytics, recommend, explain, language, hazards
  model/               train_model.py, evaluate.py, bundle loader
  data/                csvs, sqlite, recommendation_rules.yaml
  tests/               pytest suite
frontend/src/
  theme/               tokens.css, ThemeProvider
  components/          shell, charts, primitives
  pages/               Dashboard, Insights, Predict, Triage, Hazards, Model, About
```
