# Decisions

Ambiguities resolved during the upgrade, with reasoning.

D1–D14 and D20 described the text-message corpus, its classifier and the
Predict stub; D15 (a live-data source for one of the removed types) went when
scope was cut to earthquake, flood and cyclone. Those were deleted with the corpus (4.0) and the stub (5.0);
the entries are in git history. Numbering is kept so older references still
resolve.

## D16 — What "current" means per source

| Source | Current when |
|---|---|
| USGS | M4.5+ in the past 7 days (summary feed) |
| GDACS earthquakes | start date in the past 7 days (aligns with USGS) |
| GDACS cyclones, floods | GDACS `iscurrent = true` |
| NASA EONET | event in the past 30 days and not closed (EONET gives some flood events a future close date) |

The rule for each source is returned by the API (`current_rule`) and shown as a
tooltip on the World Map's feed status line.

## D17 — Merging sources keeps every reading

Records of one event are merged (earthquakes: within 180 s and 150 km;
cyclones: same storm name after dropping "Hurricane", "Tropical Cyclone" and
GDACS's year suffix, else within 400 km and 2 days; floods: GDACS
event id or 100 km). The merged event lists each source's own severity text and
link; if magnitudes differ by 0.2 or more, a `disagreement` string ("USGS M6.4
vs GDACS M6.1") is shown. Nothing is averaged. EONET flood records are
republished GDACS events, so they merge by GDACS event id and are labelled
"via GDACS" rather than counted as independent corroboration. Their polygons
list latitude first, so their coordinates are not used.

## D18 — A missing feed never reads as "no disasters"

Each source is cached separately (10 min). A failed refresh keeps the last good
copy (`stale`); a source that never answered is `unavailable`. Status is rolled
up per disaster layer. When a layer's feed is down, counts show as "14+" or
"—" (never "0"), the map heading says which feed is missing, and a toast
announces it once. Verified by running the app with GDACS pointed at an
unreachable host. The cache is stale-while-revalidate and prefetched at
startup, so no page waits on a slow feed after the first fetch.

## D19 — Taxonomy lives in two halves with a sync test

`frontend/src/config/disasterTypes.js` owns presentation (label, icon, colour,
definition, route) and drives the nav, cards, charts, badges and map markers;
colours reach CSS as `--dt-<id>` variables written from that file.
`backend/disaster_types.py` owns the data mapping (dataset column, proxy
pattern, feed codes). `test_backend_and_frontend_taxonomies_match` fails if the
two id lists ever differ in content or order.

## D21 — Disaster colours

Earthquake is rust (`#9A3412` light / `#EE9A62` dark), flood blue and cyclone
purple, chosen so the three stay distinct. Every pair
clears 4.5:1 as text on its theme's card surfaces, and colour is never the only
cue: icons and labels always accompany it.

## D22 — Top tab bar only, one block per row

Layout override received after the first 3.0 build:

* **Navigation** is a single sticky top bar (60 px): logo, the tabs, a
  theme toggle. There is no sidebar and no hamburger menu at any width. When
  the tabs do not fit (phones) the row scrolls sideways with scroll-snap; edge
  fades appear on the side where tabs are hidden, and the active tab is
  scrolled to the centre on every route change. The active tab is a filled
  pill in that disaster's colour, and the bar's 3 px top border takes the
  current disaster's colour (brand red elsewhere). The API status and the
  command palette entry moved to the footer to keep the bar to one row.
* **Pages** are one column of full-width blocks; former side-by-side pairs
  (a disaster page's map | list, coverage cells) now stack. A KPI row still counts as one block;
  on phones it wraps two-up instead of stacking one card per row, and a card
  whose value is a word ("Transport") takes the full row rather than shrinking
  its type.
* **World Map** keeps map and list side by side from 1024 px (they are one
  interactive unit) and stacks below that. The list folds severity and date
  under the location with a CSS container query on its own width, so the
  400 px side panel stays legible without shrinking text.

## D23 — The Kerala dataset is a check, not the training label

The brief named the Kerala flood dataset as training data and described it as
district-level. It is one row per year for the whole state, and its flood
flag is an annual-rainfall cut-off (NO ≤ 2,931 mm, YES ≥ 2,923 mm). Training
on it would report ~99% accuracy for relearning one threshold. The label is
the India Flood Inventory (observed, district-level, IMD-sourced), and the
Kerala dataset checks two things: that NASA POWER rainfall tracks IMD's
(r = 0.69) and that the model's statewide risk separates its flood years
(AUC 0.89).

## D24 — District × month, not district × season

At season level the label was positive in 61–70% of rows, statewide deadly
events were attributed to every district, and the test ROC-AUC was 0.60, no
better than always saying "flood". Monthly windows line rainfall up with when
events happened (test AUC 0.79), and "current conditions" become the latest 30
days, which is what a planner needs.

## D25 — Counter-intuitive coefficients are shown, not tuned away

Wetter antecedent soil gets a small negative weight and higher elevation a
positive one. Both are explained on the page (seasonal timing of recorded
events; highland flash floods in Idukki and Wayanad)
rather than removed to make the model look tidier. The random forest was not
better on the test years, so the explainable logistic regression is served.

## D26 — Back-test scenarios drive the demo, from the out-of-sample model

The live window (late August to September 2026) is drier than normal and
every district is low or medium risk. That is shown as is. To demonstrate the
chain under a real flood, the map and the allocation page can replay August
2018, August 2019, June 2013 and a quiet control month (September 2018), all
scored by the model fitted on 1981–2012 only, next to what IFI recorded.

## D27 — Level 3 is a formula with every parameter labelled by basis

No dataset gives district-level needs, so a model would be fitted to nothing.
The allocation is a formula whose parameters are each tagged Standard (Sphere,
WHO EMT), Data (Census 2011, DEM, IFI, EM-DAT homeless share from Level 1) or
Assumption (exposure shares, boat throughput, consultation rate). Existing
shelter capacity is named as missing rather than guessed.

## D28 — Scope is earthquake, flood and cyclone

The problem statement names exactly those three. The two other types were
removed everywhere (taxonomy, pipeline, live feeds, pages, tests, docs), and the
EM-DAT clean tables were rebuilt without them, so the Overview comparison,
severity ranking and global trend cover three types.

## D29 — Earthquake and cyclone risk are catalogue statistics, and say so

A trained model would need labels and features the sources do not provide (no
district-level earthquake or cyclone loss data). Instead each state's level comes
from a Poisson annual probability computed from USGS (M6+, 300 km, 1950–2025)
or IBTrACS (34 and 64 kt, 100 km, 1980–2025), with published cut-offs and a
"not a trained model" statement on the page. The level is the higher of two
tests so that one rare large event still counts: Gujarat has a single M7+
(Bhuj 2001) and no other M6+ within 300 km, which a frequency-only test would
have rated low. The cut-offs are return-period judgements, not calibrated to
losses, and are stated as such.

## D30 — Cyclone proximity is 100 km, not 200 km

At 200 km inland states such as Chhattisgarh and Jharkhand scored as often as
the coast, because a storm centre 200 km away says little about the wind on
the ground. 100 km separates the coast from the interior better; the
limitation (wind is measured at the storm centre, not at the state) is listed
under "not included".

## D31 — Regions differ by hazard, and the pages say so

Flood risk is per Kerala district (a trained model on district flood records).
Earthquake and cyclone risk are per Indian state or union territory (36), because
those catalogues have no district-level outcomes. The map, table, levels and
badges are shared; the method is stated separately for each hazard.

## D32 — Recovery & resilience uses what EM-DAT actually records

There is no recovery-time data in any source. Each disaster page shows the
reconstruction costs EM-DAT reports (9 to 16 records per type, with their share of
damage) and two outcome indicators by decade since 1980: deaths per 1,000
people affected and median damage as a share of GDP, with the caveat that a
falling rate can also mean more people being counted as affected. A recovery
timeline is not shown because none exists in the data.

## D33 — One recommendation engine, three hazards

Preparedness (before) is a rule table: each action fires at a minimum risk level
and, for some, a condition (for example low-lying land for boats), and carries
the reason it fired. Response (during and after) is the earlier population-and-risk
formula, now with a hazard-specific line (rescue boats, search-and-rescue teams,
cyclone shelters). Exposure shares are smaller for earthquake and cyclone than for
flood because their regions are whole states. The rules are general practice and
say to confirm against NDMA and State Disaster Management Authority guidance.

