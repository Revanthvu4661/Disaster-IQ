# DisasterIQ 5.1: three disasters, Analyze → Predict → Recommend

The problem statement: "Develop a Disaster Management and Analytics System for
earthquakes, floods, and cyclones that analyzes historical data, predicts
potential risks, and provides recommendations for effective disaster
preparedness and response." Scope is exactly those three types, with flood risk
prediction required.

| Level | Where | For which hazards |
|---|---|---|
| 1 Analytics | Overview, the three disaster pages (with **Recovery & resilience**), World Map | earthquake, flood, cyclone |
| 2 Prediction | **Disaster Risk Prediction** (`/risk?type=`) | flood: trained model, Indian districts. Earthquake and cyclone: statistical index, Indian states |
| 3 Recommendation | **Preparedness & Response Recommendations** (`/preparedness?type=`) | all three: rule-based preparedness actions and a formula-based response estimate |

Every disaster page links forward (Level 1 → 2 → 3) and each Level 2 and 3 page
shows the same three-step chain with links, on the selected hazard, so a judge
can walk Analyze → Predict → Recommend for any of the three.

Earlier plans are in git history (4.0: historical-impact pivot; 5.0: Kerala flood
model and resource allocation, at the commit before this round).

## 0. This round: scope cut and broadening

1. **The two out-of-scope hazard types deleted** everywhere: taxonomy (backend and
   frontend), the EM-DAT clean tables (rebuilt from cached raw data, 6,820 records
   now), their live-feed sources (including a whole USGS source and its
   "modelled" event rendering), pages, nav, Overview, World Map, tests and docs.
   A case-insensitive search of the repository for either name (excluding git
   history, downloaded raw data and screenshots) has no hits.
2. **Overview** reads "Three disasters, one view"; the comparison table, severity
   ranking and global trend recompute over three types (earthquake 1,648 events,
   flood 6,268, cyclone 5,064).
3. **Level 2 broadened** to earthquake and cyclone with an honest statistical
   index (`docs/DATA_SOURCES.md`, D29–D31); the flood model is unchanged.
4. **Level 3 broadened** to all three hazards, split into Preparedness and
   Response (D33).
5. **Recovery & resilience** on each disaster page now shows real EM-DAT data
   (D32).
6. Layout fix found while verifying: a long rupee figure in a two-up KPI card
   overflowed by 10 px at 360 px on every disaster page (present since 4.0); fixed.

## 1. Cleanup (previous round, done first)

Deleted in that round:

* `SUMMARY.md`, `update_summary.py` and the three `.kiro/hooks/update-summary-*.json`
  hooks that regenerated it. The summary described the deleted text-message
  classifier (Figure-Eight corpus, DistilBERT, triage inbox) and read
  `docs/metrics.json`, which no longer exists.
* `frontend/src/pages/PredictStub.jsx`, its `/predict` route, the "Soon" tab
  state and its CSS (`.tab-soon*`, `.stub*`).
* The legacy redirects for the classifier pages (`/insights`, `/triage`,
  `/model`, `/tools/*`, `/hazards`) in `App.jsx`.
* Dead helpers in `lib/format.js` (`titleCase`, `formatDelta`,
  `seriesColor`/`SERIES_VARS`, `formatCompact`, `formatDate`) and their tests;
  `KpiCard`'s unused sparkline and delta props (the sparkline's label still
  said "trend across corpus order").
* The backend test asserting that the classifier endpoints return 404
  (`test_removed_message_endpoints_are_gone`).
* Decisions D1–D14 and D20 in `docs/DECISIONS.md`, which described the deleted
  corpus and classifier.
* Stale copy: the boot screen ("disaster response messages… corpus
  analytics"), a `Deferred` comment about the dashboard's heatmaps.
* Untracked local artefacts: `docs/screenshots/v2/` (screenshots of deleted
  pages), `docs/screenshots/predict-*.png`, `.coverage`, `.pytest_cache/`,
  every `__pycache__/`.

Checked and found clean: no import, route, component or test references the
text-message dataset, the classifier, `backend/model/` or the old Predict page.
After the cleanup, lint, vitest, the build and pytest passed and all eight
existing routes rendered without console errors.

## 2. Level 2 for floods: the trained model (extended to all Indian districts)

### What the sources actually contain (probed before building)

| Source | Finding | Consequence |
|---|---|---|
| Kerala flood dataset (`kerala.csv`) | **State level**, one row per year 1901–2018, not districts. Its FLOODS flag is almost exactly a cut-off on annual rainfall: every NO year ≤ 2,931.1 mm, every YES year ≥ 2,923.1 mm. | Not usable as the training label: a model would relearn the cut-off and report ~99% accuracy. Used as an independent check. |
| India Flood Inventory v3.0 | IMD-sourced flood events 1967–2023 with district lists and deaths: 6,876 events, 6,816 with districts listed. District names use modern spellings and sometimes state-file errors; some ambiguous dates are month-first (the August 2018 Kerala event is stored as 08-01-2018 to 30-08-2018). | The training label. Names are matched inside each state and dates are repaired in the pipeline (see DATA_SOURCES.md). |
| NASA POWER | Daily precipitation and root-zone soil wetness from 1981 to ~4 days ago, per point, no key. | Rainfall and soil features, and "current conditions". |
| Open-Elevation | Answered on the all-India build (17,488 points, at most about 25 per district). | Tried first; Open-Meteo's elevation API (Copernicus GLO-90) is the fallback, and `meta.json` records which answered. |
| River gauges (India-CWC) | No free, documented, no-key source was integrated in the time available. | **Omitted, not estimated.** Said on the page and in the model's "not included" list. |

### Design

* **Unit:** district × calendar month, 734 districts × 1981–2023 × 12 months
  = 378,744 rows (377,495 with every input: Lakshadweep has no soil-wetness value
  from NASA POWER and the first January lacks its preceding week). The earlier
  Kerala-only model used June–September only (2,408 rows); all twelve months are
  used now so northeast-monsoon floods count.
* **Label:** IFI records a flood event listing the district that overlaps the
  month (5% of rows; 4.4% in the training years, 6.6% in the test years).
* **Features:** rainfall as % of the district's 1991–2020 normal for the same month
  (capped at 1,000%); heaviest 3-day rainfall; soil wetness in the 7 days before
  the window; mean elevation; share of the previous 10 years with a recorded flood;
  and the district's state as one 0/1 column per state.
* **Model:** standardised logistic regression (served); random forest as a
  benchmark on the same inputs. Explanations are coefficient × standardised value,
  which add up to the log-odds (the state baseline is one of the terms).
* **Evaluation:** time split, fit 1981–2012, test 2013–2023, overall and per state.

### Results (test years, never seen in training)

| Model | ROC AUC | Avg precision | Accuracy | Precision | Recall |
|---|---|---|---|---|---|
| Logistic, 50% cut-off | 0.788 | 0.240 | 0.931 | 0.408 | 0.088 |
| Logistic, "medium or above" (25%) | 0.788 | 0.240 | 0.921 | 0.348 | 0.224 |
| Random forest, 50% | 0.790 | 0.291 | 0.934 | 0.900 | 0.001 |
| Random forest, 25% | 0.790 | 0.291 | 0.923 | 0.382 | 0.270 |
| District-month flood-rate baseline | 0.762 | 0.241 | 0.935 | 0.562 | 0.047 |
| Flood history only | 0.702 | 0.135 | 0.934 | 0 | 0 |
| Always "no flood" | 0.5 | 0.066 | 0.934 | 0 | 0 |

These are new numbers for a different task, so they are not comparable with the
Kerala-only figures (ROC AUC 0.792 on 14 districts, June–September).

Read them plainly: the model ranks flood months better than chance and better than
flood history alone, but only about 0.03 ROC-AUC better than the district-month
flood-rate baseline, and at 25% it catches about one recorded flood month in
five. Rainfall as % of normal has a coefficient near zero once the heaviest 3-day
rainfall is in the model. A calendar-month input would be the next thing to try;
it is not in this change.

Per state (test years; the full table is on the page): ROC AUC 0.82 in Assam
(828 flood months), 0.75 Kerala, 0.82 Uttar Pradesh, 0.73 Maharashtra, 0.82 Tamil
Nadu, 0.65 Gujarat, Rajasthan and Punjab, 0.93 Meghalaya. States with fewer than 20
test-period floods get no AUC.

Known-event checks (out of sample, judged inside the state, confirmed against IFI):

| Month | Districts rated high or critical | Medium or above | IFI records floods in |
|---|---|---|---|
| Kerala, August 2018 | 12 of 14 | 14 | 14 |
| Kerala, August 2019 | 9 of 14 | 13 | 14 |
| Kerala, June 2013 | 4 of 14 | 10 | 11 |
| Uttarakhand, June 2013 | 8 of 13 | 9 | 4 |
| Tamil Nadu and Puducherry, December 2015 | 3 of 42 | 6 | 24 |
| Assam, June 2022 | 24 of 33 | 30 | 32 |
| Kerala, September 2018 (quiet) | 0 of 14 | 0 | 0 |
| Punjab, August 2014 (quiet) | 0 of 22 | 0 | 0 |

Uttarakhand is IFI's sparse record of the Kedarnath disaster, so most high ratings
count as false alarms against it. December 2015 in Tamil Nadu is a miss: IFI lists
floods across the state and the model rates few districts highly, because it sees
no season. Against the Kerala dataset's own flag, the model's statewide mean risk
ranks its flood years with AUC 0.890 over 1981–2018.

### Coverage and unavailable data

* 18 district names (16 in IFI, 2 in the census) could not be matched: 2.5% of
  districts. `unmatched_names.csv` lists them, with 104 descriptions and towns,
  8 districts geoBoundaries does not draw and 96 districts without a census row.
* 96 districts created after 2011 have no population; Level 3 shows their resource
  lines as unavailable.
* Lakshadweep is not scored (no soil-wetness value).

## 3. Level 3: the response formula (now shared by all three hazards)

Rule-based and fully documented in `backend/services/allocation.py` and
`docs/DATA_SOURCES.md`: people needing assistance = Census 2011 population ×
an exposure share for the Level 2 risk level; boats, medical teams, food,
water and shelter follow from that with Sphere/WHO standards, the district's
low-lying share and EM-DAT's India flood homeless share (Level 1 data).
Dispatch order: risk level, then people, then the district's share of past
monsoons with a deadly flood (IFI). The page states it is a decision-support
estimate, not a dispatch order.

## 4. Level 2 for earthquakes and cyclones

`backend/hazard_pipeline.py` counts USGS M6+ earthquakes (1950–2025, within
300 km) and IBTrACS North Indian Ocean storms (1980–2025 seasons, within 100 km,
at 34 and 64 kt) for the 36 states and union territories of India;
`services/hazard_risk.py` converts counts to annual probabilities (Poisson) and
four levels with fixed cut-offs, taking the higher of two tests (M6+ and M7+, or
hurricane and tropical-storm strength). Results: earthquakes 6 critical / 9 high
/ 8 medium / 13 low (Ladakh 80% a year, Assam 48%, Gujarat medium on its single
M7+); cyclones 5 / 9 / 7 / 15 (Andhra Pradesh 66%, Odisha 25%, Tamil Nadu 20%).
All nine known events used as checks are found near the right state.

## 5. Level 3 for all three hazards

`services/recommendations.py`. Preparedness: a rule table (six or seven rules per
hazard, each with a minimum risk level, an optional condition and the reason it
fired). Response: the population-and-risk formula with hazard-specific exposure
shares and one hazard-specific line (boats, search-and-rescue teams or cyclone
shelters). Priority order: risk level, then people, then probability. The page
states that it is a decision-support estimate and that the rules are general
practice to be confirmed against NDMA and SDMA guidance.

## 6. API

| Path | Returns |
|---|---|
| `GET /api/flood-risk`, `/scenario/{id}`, `/score` | flood model card, back-test months, scorer (unchanged) |
| `GET /api/hazard-risk/{earthquake\|cyclone}` | state-level index, method, cut-offs, known-event checks |
| `GET /api/recommendations/{hazard}?scenario=&days=` | preparedness and response per region, rules, formula, parameters |
| `GET /api/disasters/{id}` | now includes real `recovery` data (reconstruction cost, resilience by decade) |

## 7. Verification (done)

* `pytest`: 73 tests (index arithmetic and distances, known-event checks, level
  logic, rule firing, all three response formulas, priority order, endpoints,
  recovery payload, taxonomy sync at three types).
* `npm run lint`, `vitest` and `npm run build` pass; no console errors on any
  route; the old URLs of the two removed types now show the not-found page.
* Screenshots of the Overview, three disaster pages, World Map, Disaster Risk
  Prediction and Preparedness & Response (all three hazards each) at 360 and
  1280 px in both themes are in `docs/screenshots/`; no horizontal scroll at 360 px.
* Click-through, scripted: Flood → risk prediction (flood) → replay Aug 2018 →
  score a 400 mm storm → preparedness (flood) → replay Aug 2018 → district detail →
  back to Flood; Earthquake → risk prediction (earthquake) → Ladakh → preparedness
  (earthquake, 7 actions for the top state, response ranking) → switch to
  Cyclone → its risk prediction.

## 8. Tomorrow (polish only, no new features or sources)

* Refresh the flood window before the demo: `make flood-current`.
* The earthquake and cyclone pages are slow to settle in dev mode (cold load
  15–40 s the first time Vite compiles the charts); `npm run build` and
  `npm run preview` serve them quickly.
* Record a backup screen capture in case NASA POWER or the live feeds are
  unreachable at the venue (the app runs from committed CSVs).
