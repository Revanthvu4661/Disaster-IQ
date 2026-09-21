# Decisions

Ambiguities resolved during the upgrade, with reasoning.

## D1 — Event inference is keyword-first, id-range second

The dataset has no event column and no timestamps. Keyword rules over place
names and event vocabulary give a confident label for ~19% of messages. The
corpus is ordered by source, and the keyword-labelled rows show a clean
structure (validated in phase 1):

| genre | id range | dominant keyword event |
|---|---|---|
| direct | 0–11 600 | Haiti earthquake |
| direct | 11 600–13 800 | Superstorm Sandy |
| direct | 13 800–15 500 | Pakistan floods |
| social | 11 000–12 000 | Haiti earthquake |
| social | 12 000–13 000 | Superstorm Sandy |
| social | 13 000–14 000 | Chile earthquake |
| social | 14 000–16 000 | Superstorm Sandy |

`news` messages (id ≥ 15 500) are a mixed international news feed with no
dominant event, so unmatched news rows stay `Other` rather than being forced
into a bucket. Every row stores `event_method` (`keyword`, `id_range`,
`default`) so the UI can say how a label was derived.

## D2 — `related = 2` becomes `is_irrelevant`, rows are kept

204 rows have `related-2`, which the dataset documentation describes as
non-disaster noise. Deleting them would hide a real data-quality signal, so
they are kept with `is_irrelevant = 1`, excluded from category/urgency
statistics and from model training, and surfaced on the data-quality panel.

## D3 — Severity uses weighted noisy-OR

Averaging urgent-category probabilities dilutes a single strong signal. The
score is `(1 - Π(1 - w_c · p_c)) · 100` over weighted urgent categories, so one
confident life-threatening category is enough to reach a high level.

## D4 — Thresholds are tuned on validation only

Split is 60/20/20 with a fixed seed. Per-label thresholds maximise F1 on the
validation split; all reported metrics come from the untouched test split.

## D5 — Translation is best-effort and offline-tolerant

Language detection uses `langdetect` (pure Python, no model download).
Translation tries, in order: an optional local Argos Translate package, then an
optional `deep-translator` online call, then a no-op passthrough. The API always
returns `translation_available: false` instead of failing when nothing is
installed.

## D6 — GPU is available but DistilBERT is only run if it wins on merit

The dev machine has an RTX 5050 (8 GB). A DistilBERT fine-tune is benchmarked
only if torch with CUDA is importable; the decision between candidates is made
on test macro-F1 and inference cost, and the baseline is kept if it is not
beaten.

## D7 — Live hazards are proxied through the backend

Browsers would hit CORS limits and expose the client to feed outages. The
backend fetches USGS / EONET / GDACS with a 10-minute TTL cache and returns a
normalised shape plus a per-source `status`, so the UI can show a partial or
offline state without breaking.

## D8 — Offers of help are damped in the severity score

A message such as "we have blankets to donate" is not a report of need, but the
classifier still fires `shelter` and `food` on it, which the noisy-OR then reads
as a severe incident. When `offer` outscores `request`, the score is multiplied
by `1 - 0.6 * (p_offer - p_request)`. The base formula is unchanged; this is a
single, testable correction rather than a new scoring model. The residual error
(the corpus contains few offers, so the classifier handles them poorly) is
documented in `MODEL_CARD.md` instead of being hidden by more tuning.

## D9 — The batch "top label" excludes meta categories

`related`, `request`, `aid_related` and `direct_report` fire on nearly every
message, so showing them as the headline label of a triaged row tells an
operator nothing. The queue shows the highest-scoring *need* instead.
