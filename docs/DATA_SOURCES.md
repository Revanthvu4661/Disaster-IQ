# Data sources

Every historical number in DisasterIQ is computed from the public datasets
below by `backend/data_pipeline.py` (fetch → clean → store) and
`backend/services/history.py` (analytics). Nothing is estimated or imputed. A
metric a source does not contain is shown in the UI as unavailable.

Rebuild everything with `make data` (`python -m backend.data_pipeline`), and
print the known-event checks with `make verify`.

Level 2 (risk prediction) and Level 3 (preparedness and response) use further
sources, described at the end of this file: Kerala flood risk, the
earthquake and cyclone hazard index for Indian states, and the recommendation
rules.

## Sources

| # | Source | Fetched from | Unit | Coverage used |
|---|---|---|---|---|
| 1 | **EM-DAT** (CRED / UCLouvain) via **Our World in Data** | `catalog.ourworldindata.org/explorers/emdat/latest/natural_disasters/natural_disasters_yearly.csv` | country × year, one column per metric × type | 1900 to the last complete year |
| 2 | EM-DAT event counts via OWID | `ourworldindata.org/grapher/number-of-natural-disaster-events.csv` | world × year × type | 1900 to the last complete year |
| 3 | OWID entity codes | `ourworldindata.org/grapher/number-of-deaths-from-natural-disasters.csv` | entity → ISO3 | – |
| 4 | **USGS** ComCat | `earthquake.usgs.gov/fdsnws/event/1/query`, `minmagnitude=6`, one query per decade | earthquake (point) | 1900 onwards, M6.0+ |
| 5 | **NOAA IBTrACS** v04r01 | `ncei.noaa.gov/.../ibtracs.since1980.list.v04r01.csv` | 6-hourly track point → one row per storm | 1980 onwards |
| 6 | Natural Earth admin-0 | 50 m (centroids), 110 m (choropleth shapes) | country polygon | – |
| 7 | **World Bank WDI** `PA.NUS.FCRF` (India), from IMF IFS | `api.worldbank.org/v2/country/IND/indicator/PA.NUS.FCRF` | rupees per US$, annual average | 1960–2025 |

Licences: OWID data CC BY 4.0 (EM-DAT is the original source and is credited
on every chart). USGS and NOAA data are US public domain. Natural Earth is
public domain.

## Which source feeds which metric

| Metric in the UI | Source | Column / computation |
|---|---|---|
| Deaths | 1 | `deaths_<type>`. EM-DAT counts dead plus missing. |
| Injured | 1 | `injured_<type>` |
| Needing immediate assistance | 1 | `affected_<type>` (EM-DAT's "affected") |
| Left homeless | 1 | `homeless_<type>` |
| Total affected | 1 | `total_affected_<type>` = injured + affected + homeless |
| Fatality rate | 1 | Σdeaths ÷ Σtotal affected × 100, over records reporting both (> 0). The median record rate is also shown. |
| Total damages | 1 | `total_damages_adjusted_<type>`, constant 2024 US$ (US CPI) |
| Insured damages | 1 | `insured_damages_adjusted_<type>` |
| Reconstruction costs | 1 | `reconstruction_costs_adjusted_<type>` |
| Loss per affected person | 1 | Σdamages ÷ Σtotal affected, over records reporting both |
| Damages as % of GDP | 1 + World Bank WDI | `total_damages_pct_gdp_<type>`, computed by OWID |
| Events per year / decade, YoY, decade-over-decade | 2 | `n_events`. Decade change compares events per year, so the unfinished decade is comparable. |
| Deaths / loss per year (trend charts) | 1 | OWID's `World` row per type; checked equal to the sum of the country records |
| 10-year average line | 1, 2 | trailing mean computed in the browser from the yearly series |
| Month / season (earthquake) | 4 | month of each M6+ earthquake; χ² test against an even spread, adjusted for month length |
| Month / season (cyclone) | 5 | genesis month of each storm, split by hemisphere of peak intensity |
| Top countries, choropleth | 1 | sums over each country's records |
| Earthquake points | 4 | M7.0+ on the disaster page; M6.0+ per decade on the World Map; size = magnitude |
| Cyclone points | 5 | position at lifetime maximum intensity; Category 3+ on the page, all storms on the map; size = peak wind |
| Flood map positions | 1 + 6 | country centroid (largest polygon); size = highest Severity Index of that country's records in the decade |
| Severity Index, rankings | 1 | see below |
| Trend verdicts | 1, 2 | Spearman rank test of yearly totals, 1980 to the last complete year; "increasing" or "decreasing" needs p < 0.05 |
| Correlations | 1 | Pearson r on log10 values and Spearman ρ, over records reporting both |

Type mapping (OWID → DisasterIQ): `earthquake` → Earthquake, `flood` → Flood,
`storm` ("Extreme weather") → Cyclone/Hurricane. Other EM-DAT types are out of scope.

## Money in ₹

Stored money stays in US$. The UI shows ₹, converted in `backend/currency.py`:

* **What is converted:** each record's damage, insured and reconstruction figure
  *as EM-DAT reported it* (US$ of the event year, OWID's unadjusted
  `total_damages_*`, `insured_damages_*`, `reconstruction_costs_*`), multiplied by
  **that year's** average rupees-per-US$ rate (source 7). Totals, per-decade,
  per-country and per-type figures are sums of these per-record conversions.
* **Not adjusted for inflation.** Every money figure carries the note
  "Converted from USD using that year's average exchange rate. Not adjusted for
  inflation."
* **Missing years:** the rate table starts in 1960. Earlier records (51 earthquake
  records, for example) use the 1960 rate, the nearest available year, and are marked `*`
  with "Converted using nearest available year's exchange rate". Before 1949 the
  real rate was lower (about ₹3.3/US$), so these early figures are overstated.
* **Where the US$ stays:** the tooltip on every ₹ figure shows the exact ₹ amount
  and EM-DAT's original US$ figure, for checking against the source.
* **Comparisons across years** (Severity Index, trend verdicts, "which decade had
  the highest losses") still use the CPI-adjusted US$ series (2024 prices), because
  a trend in rupees-at-the-time mostly measures inflation and the rupee's
  depreciation. The UI states this basis wherever it applies. Rankings shown in ₹
  (top countries by loss, costliest year) sort by the ₹ figure shown.
* **Correlations** involving loss use the ₹ values plotted.

Spot checks (₹ at the event year's rate vs independent figures):

| Event | EM-DAT (as reported) | Rate | ₹ shown | Independent |
|---|---|---|---|---|
| Gujarat (Bhuj) earthquake 2001 | US$2.62 bn | 47.19 | ≈ ₹12,377 crore | Gujarat government estimates of total losses were around ₹20,000 crore (wider scope); same order |
| Odisha super cyclone 1999 | US$2.99 bn | 43.06 | ≈ ₹12,874 crore | contemporary reports: about ₹10,000 crore |
| Haiti earthquake 2010 | US$8.0 bn | 45.73 | ≈ ₹36,581 crore | arithmetic check: US$8 bn × 45.73 |

## What an EM-DAT "event" is

EM-DAT lists a disaster only if it killed 10 or more people, affected 100 or more,
led to a declaration of a state of emergency or triggered a call for international
assistance. Its counts (284 earthquake disasters in the 2000s) are therefore not
counts of every occurrence: the USGS catalogue holds 1,585 earthquakes of M6.0+ in
the same decade, and far more smaller ones exist that appear in neither. The UI
says "disasters" for EM-DAT counts, and each earthquake page compares the two
per decade.

## Unit of record

OWID publishes EM-DAT **summed by country and year**, not event by event. The
population ranked by the Severity Index and plotted in the correlation charts
is therefore the **country-year record**: one country's total for one disaster
type in one year. When one catastrophic event dominates its country-year
(Haiti 2010, Myanmar 2008), the record effectively is that event. When a
country had several events of one type in a year, they are summed. The UI calls
these "records", never "events".

## Severity Index

For each record, with `x` ∈ {deaths, total affected, damages}:

```
s_x   = (log10(1 + x) − min) / (max − min)     # min/max over the population ranked
score = 100 × (0.50·s_deaths + 0.25·s_affected + 0.25·s_damages)
```

* **Population:** one disaster type on its own page; all five types pooled on
  the Overview's cross-type ranking. The same record therefore has two scores
  (`severity_type`, `severity_all`).
* **Why log:** impact spans seven orders of magnitude. Linear min-max would let
  one 3-million-death famine year score 100 and put nearly every other record
  below 1.
* **Why these weights:** loss of life is weighted highest. Affected and loss are
  equal secondary terms.
* **Known bias:** a metric the source did not report counts as 0, so records
  without damage estimates (common before 1990 and in low-income countries)
  rank lower than their true severity.

## Cleaning decisions

* **Aggregates removed:** OWID rows for World, continents, the EU and income
  groups (codes `OWID_*`) are excluded from country analysis. The World row is
  used only for world yearly totals.
* **Historical states kept:** USSR, Yugoslavia, Czechoslovakia, East/West
  Germany, Serbia and Montenegro, both Yemens and the Netherlands Antilles stay
  in totals and rankings as EM-DAT recorded them. They have no current
  geometry, so they are listed as "not mapped".
* **Zeros:** OWID writes 0 where EM-DAT reported nothing. A 0 is treated as
  "none reported". Ratios and correlations use only records where both inputs
  are positive. Rows with no impact at all for a type are dropped.
* **Partial year:** the running year is excluded from every chart and total.
* **Money series — defect found and avoided:** OWID's
  `total_damages_constant_usd_*` series deflates with local-currency
  deflators and produces impossible values for high-inflation countries
  (Venezuela 1999 floods: US$4.5 × 10²²; Iran 1990 earthquake: US$14.6
  trillion; flood damages summed to US$45,000 trillion). The pipeline uses
  OWID's `*_adjusted` series (US CPI, constant 2024 US$) instead. A test asserts
  no record exceeds US$1 trillion.
* **IBTrACS wind:** US agencies' 1-minute sustained wind (NHC/JTWC, all
  basins) so categories are comparable. Storms without it fall back to the WMO
  agency's wind (10-minute averaging, reads lower), are flagged `wind_source =
  wmo` and are never given a category. Only storms that reached 34 kt enter the
  table.
* **Country centroids:** planar centroid of each country's largest polygon
  (Natural Earth 50 m), with the OWID ↔ Natural Earth code aliases PSE ↔ PSX and
  SSD ↔ SDS.

## Verification

`python -m backend.data_pipeline --verify` prints the stored records for
well-known disasters beside the public figures. The test suite
(`backend/tests/test_disasters.py`) asserts:

* Haiti 2010 earthquake: **222,570 deaths** (EM-DAT's published figure).
* Myanmar 2008 cyclone (Nargis): more than 130,000 deaths.
* Japan 2011 earthquake: more than US$200 bn in damages.
* For every type, the sum of country records equals OWID's World total.
* USGS points are all M6.0+, IBTrACS storms all reached 34 kt from 1980 on.

## Coverage and known gaps

* **Recording bias:** EM-DAT is far thinner before about 1980 (OWID notes
  coverage is "more limited before the year 2000"). Low counts in early decades
  partly reflect recording, not only occurrence. Every trend chart shades the
  pre-1980 years and every trend verdict uses 1980 onwards.
* **Rising counts and losses** also reflect better reporting and more exposed
  assets. The UI says so next to the verdicts.
* **EM-DAT "Storm" ≠ tropical cyclone.** OWID's storm columns include
  tornadoes, convective and extra-tropical storms. The subtype split is not in
  the free export. The Cyclone/Hurricane page shows this caveat. IBTrACS (the
  point layer and the month profile) is tropical-cyclone only.
* **USGS completeness:** the M6+ catalogue is incomplete for early decades,
  especially outside instrumented regions.
* **IBTrACS starts in 1980** here. The full archive (back to 1842) exists, but
  NCEI served it too slowly to fetch reliably (about 40 KB/s), and pre-satellite
  tracks are patchy. The World Map says "not covered" for cyclones before the
  1980s.

### Not available (shown as unavailable in the UI)

| Metric | Why |
|---|---|
| Missing people (separately) | EM-DAT folds missing into deaths |
| Displaced, evacuated | not in the export; "homeless" is the closest figure |
| Infrastructure / agricultural / housing / business loss | EM-DAT gives one total per record |
| Urban vs rural | no source records it |
| Recovery time, rebuilding progress, response time | not in any source used. What EM-DAT does record is shown on each disaster page's Recovery & resilience block: reconstruction *cost* (only 9 to 16 records per type report it) and deaths per 1,000 affected and damage as a share of GDP by decade |
| Month / season for flood | the only source has no event dates |
| Point locations for flood | Dartmouth Flood Observatory archive returns HTTP 410 Gone, so EM-DAT flood impact is country-level; the Kerala flood model uses the India Flood Inventory instead |
| Per-country event counts | OWID publishes event counts at world level only; "countries affected" counts countries with at least one record |

## Kerala flood risk (Level 2) and the response formula (Level 3)

Built by `backend/flood_pipeline.py` (fetch → clean → features, outputs in
`backend/data/clean/flood/`, committed) and used by
`backend/services/flood_risk.py` (model) and `backend/services/allocation.py`
(formula). Rebuild with `make flood-data`; refresh only the latest NASA POWER
days with `make flood-current`; print the evaluation with `make flood-report`.

### Sources

| # | Source | Fetched from | Used for |
|---|---|---|---|
| 8 | **India Flood Inventory (IFI) v3.0**, HydroSense Lab, IIT Delhi | `raw.githubusercontent.com/hydrosenselab/India-Flood-Inventory/main/v3.0/India_Flood_Inventory_v3.csv` | the training label; district flood history |
| 9 | **NASA POWER** daily point API (MERRA-2 based) | `power.larc.nasa.gov/api/temporal/daily/point`, `PRECTOTCORR`, `GWETROOT`, community AG, 1981 → yesterday | rainfall and soil-wetness features, the current 30-day window |
| 10 | Elevation: **Open-Elevation**, fallback **Open-Meteo elevation API** (Copernicus GLO-90 DEM) | `api.open-elevation.com/api/v1/lookup`, `api.open-meteo.com/v1/elevation` | mean elevation and low-lying share per district |
| 11 | **geoBoundaries** IND ADM2 (ODbL) | `github.com/wmgeolab/geoBoundaries/…/geoBoundaries-IND-ADM2_simplified.geojson` | district polygons (map, elevation sampling, centres) |
| 12 | **Census of India 2011** district table | GitHub mirror `nishusharma1608/India-Census-2011-Analysis/india-districts-census-2011.csv` | population and households |
| 13 | **Kerala flood dataset** (IMD subdivision rainfall + FLOODS flag) | GitHub mirror `amandp13/Flood-Prediction-Model/kerala.csv` | independent check only (see below) |

Which elevation source answered is recorded in `meta.json`
(`elevation_source`). On the build day (25 Sep 2026) Open-Elevation's TLS
certificate had expired, so **Open-Meteo (Copernicus GLO-90)** supplied all 655
sample points. The census table was checked: the 14 districts sum to Kerala's
published 2011 total of 33,406,061, and the pipeline fails if they do not.

**River gauge levels are not used.** No free, documented, no-key river-gauge
source was integrated in the time available, and none is estimated. The Flood
Risk Prediction page says: "River-gauge data not available for this build; risk
is estimated from rainfall, soil moisture, elevation and historical flood
frequency."

### Why the Kerala dataset is not the training label

It has one row per year for the whole state (1901–2018), not districts, and
its FLOODS flag separates almost perfectly at one annual-rainfall value: every
NO year had ≤ 2,931.1 mm, every YES year ≥ 2,923.1 mm (only 1958 and 2001 fall
in the 8 mm overlap). A classifier trained on it would score close to 100% by
relearning that line, which says nothing about floods. It is used for two
checks instead:

* NASA POWER vs IMD annual Kerala rainfall, 1981–2018: r = 0.687. POWER reads
  lower (mean 2,245 mm against IMD's 2,794 mm), so rainfall enters the model
  as a percentage of each district's own POWER normal, never in mm.
* The model's statewide mean risk ranks the dataset's YES years above its NO
  years with AUC 0.887 (38 years), without ever being trained on that flag.

### Cleaning decisions

* **IFI dates.** IFI mostly writes `dd-mm-yyyy` but some ambiguous dates are
  month-first. The main August 2018 Kerala event is stored as 08-01-2018 to
  30-08-2018 with a 30-day duration (1–30 August), and the 8–11 August 2019
  events read as 8 September, 8 October and 8 November. IFI's event
  ids are numbered in date order within a year, so each start date takes the
  earliest reading on or after the previous event's start, and each end date
  the reading that best matches the recorded duration. Tested in
  `backend/tests/test_flood_risk.py`.
* **District matching.** IFI lists districts by name; all 14 Kerala names match
  geoBoundaries and the census exactly. A multi-district event counts for every
  district it lists, and its single death toll is not split between them.
* **Label.** A district-month is positive when an IFI event listing the district
  overlaps the month (start ≤ month end and end ≥ month start). 29% of the
  2,408 district-months are positive.
* **Season normal.** 1991–2020 (WMO standard period), for the same calendar
  dates as the window being scored.
* **Flood history** uses only IFI seasons before the scored year (at most
  2023, IFI's last year), so no training row sees its own label.
* **Elevation.** A 0.07° grid (about 7.7 km) inside each district polygon,
  655 points in all; the mean is the feature, the share of points below 10 m
  is "low-lying land" (used by Level 3 for boats).
* **Current window.** The latest 30 days of POWER data (about 4 days behind real
  time), compared with the 1991–2020 normal for the same dates.

### Model, metrics and limits

See `docs/PLAN.md` §2 for the metrics table and back-tests; the page's
"Model transparency" block shows the same numbers from the API. Stated
limits: no river gauges, no dam releases (a major cause of the August 2018
flooding, which the model under-rates), no rainfall forecast, no slope, soil or
land use. IFI records more events in recent years (38% of test rows against
26% of training rows), so at the 50% cut-off the model under-calls; the 25%
"medium or above" cut-off is the one to act on.

### Level 3 allocation formula

```
people      = population (Census 2011) × exposure[level]
              exposure: critical 5%, high 2%, medium 0.5%, low 0%     (assumption)
boats       = ceil(people × low-lying share ÷ 200)                   (10 per trip × 10 trips × 2 days; assumption)
medical     = ceil(people × 2% ÷ 50)                                 (WHO EMT Type 1: ≥ 50 outpatients a day; 2% is an assumption)
food        = people × days                                          (one 2,100 kcal ration a person a day; Sphere)
water (L)   = people × 15 × days                                     (Sphere minimum)
shelter     = people; floor space = people × 3.5 m²                  (Sphere minimum)
long-stay   = people × EM-DAT India flood homeless share             (Level 1 data: Σ homeless ÷ Σ total affected)
order       = risk level, then people, then share of past monsoons with a deadly IFI flood
```

The homeless share is computed at request time from the Level 1 store over the
EM-DAT India flood records that report both figures (4.0% over 30 records,
1928–2025). Not included, and said on the page: existing shelter capacity,
stock and teams already deployed, road access, population change since 2011.
The pages label the result a decision-support estimate, not a dispatch order.

## Earthquake and cyclone hazard index (Level 2), Indian states

Built by `backend/hazard_pipeline.py` (outputs in `backend/data/clean/hazard/`,
committed) and scored by `backend/services/hazard_risk.py`. Rebuild with
`make hazard-data`. **This is a statistical index, not a trained model**, and
the page says so in its callout, its method block and its API payload
(`methodology.is_trained_model = false`).

| # | Source | Used for |
|---|---|---|
| 4 | USGS ComCat M6.0+ (`backend/data/clean/earthquakes_usgs.csv`, source 4 above) | earthquakes 1950–2025 |
| 5 | NOAA IBTrACS v04r01 (source 5 above), North Indian Ocean 6-hourly points | cyclone tracks, 1980–2025 seasons |
| 14 | **geoBoundaries** IND ADM1 (ODbL): 36 state and union-territory polygons | regions, distances, map |
| 12 | Census of India 2011 district table | state population, summed to today's states |

Census districts are summed to the 36 current states and union territories:
Telangana takes its 10 districts out of Andhra Pradesh, Ladakh takes Leh and
Kargil out of Jammu and Kashmir, and Dadra and Nagar Haveli and Daman and Diu
combines the two former territories. The pipeline fails unless the 36 total
1,210,854,977, India's published 2011 population.

### What is counted

* **Earthquake:** every M6.0+ event of 1950–2025 whose epicentre is inside the
  state or within **300 km** of its boundary (haversine distance to the boundary,
  densified to about 5 km). 1950 is used, not 1900, because global M6+
  catalogues are reasonably complete only from about then. Aftershocks count as
  separate events.
* **Cyclone:** every North Indian Ocean storm of the 1980–2025 seasons whose
  track centre came within **100 km** of the state's boundary while at least
  **34 kt** (tropical-storm strength); of those, the ones that reached **64 kt**
  (hurricane strength) while that close. Wind is the US agencies' 1-minute
  sustained wind where present, otherwise IMD's 3-minute wind (which reads lower).
  100 km was chosen over 200 km because at 200 km inland states scored as often
  as the coast (D30).

### From counts to levels

```
annual probability = 1 − exp(−events ÷ years of record)     (Poisson: independent events at their average rate)

earthquake   M6+ within 300 km:  critical ≥ 40%   high ≥ 15%   medium ≥ 5%     76 years
             M7+ within 300 km:  critical ≥ 10%   high ≥  4%   medium ≥ 1%
cyclone      64 kt+ within 100 km: critical ≥ 15% high ≥  6%   medium ≥ 2%     46 seasons
             34 kt+ within 100 km: critical ≥ 60% high ≥ 30%   medium ≥ 10%
level = the higher of the two tests; the probability shown is the deciding test's
```

The cut-offs are return-period judgements ("about once in 7 years"), not
calibrated to losses. Results: 6 states critical, 9 high, 8 medium, 13 low for
earthquakes; 5 critical, 9 high, 7 medium, 15 low for cyclones.

### Checks and limits

Known events are looked up in the derived tables to confirm the catalogue and
the distance calculation put them near the right state (Bhuj 2001 in Gujarat,
Assam–Tibet 1950 in Assam, Nepal 2015 in Bihar, Kashmir 2005 in Jammu and
Kashmir; the 1999 Odisha super cyclone, Fani, Amphan, Hudhud and Tauktae). All
are found (tested in `backend/tests/test_hazard_recommendations.py`). This checks
the data path, not the risk levels, which have no independent ground truth.
Not included, and listed on each page: ground conditions and building quality,
fault-level hazard and the official seismic zone map, earthquakes before 1950,
storm surge and rainfall, storms of the coming season, wind at the state itself,
and any climate trend.

## Level 3 for all three hazards: preparedness and response

`backend/services/recommendations.py`. **Preparedness** is a rule table: an
action fires when the region's risk level reaches the rule's minimum level (and
its condition, if any) and carries the reason it fired (for example "7 M6+
earthquakes within 300 km since 1950"). The rules are general practice
(structural retrofitting and IS 1893 compliance, drills, search-and-rescue and
trauma pre-positioning for earthquakes; drains, evacuation routes, boats, camps
and waterborne-disease stock for floods; warning dissemination, evacuation
routes, wind-resistant shelters, backup power and stock for cyclones) and each
says to be confirmed against NDMA and State Disaster Management Authority
guidance. **Response** uses the population-and-risk formula in the Level 3 section above,
with exposure shares by hazard (flood 5/2/0.5/0%, earthquake 2/0.5/0.1/0%,
cyclone 3/1/0.25/0% of population at critical/high/medium/low, all
assumptions) and one hazard-specific line: rescue boats (flood, low-lying share
÷ 200), search-and-rescue teams (earthquake, 1 per 5,000 people) or cyclone
shelters (cyclone, 1,000 people each). Earthquake and cyclone regions are whole
states, so their shares are smaller than the district-level flood shares.

## Recovery and resilience (each disaster page)

From EM-DAT via OWID only. **Reconstruction cost:** 12 earthquake, 16 flood and
9 cyclone records report one (of 1,087, 3,332 and 2,401), shown with the share
of damage on records reporting both. **Resilience indicators by decade since
1980:** deaths per 1,000 people affected (pooled over records reporting both) and
the median damage as a share of GDP (OWID's join with World Bank WDI). Recovery
time, rebuilding progress, response time and aid delivered are not in any source
and are listed as unavailable; no timeline is shown. A falling deaths-per-1,000
rate can reflect better warning and shelter but also more people being counted
as affected, and a few catastrophes dominate individual decades (the earthquake
series is dominated by Haiti 2010, for example); the page says both.
