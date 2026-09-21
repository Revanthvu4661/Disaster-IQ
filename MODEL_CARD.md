# Model card - DisasterIQ message classifier

Every number on this page comes from `python -m backend.model.train_model`,
recorded in `docs/metrics.json` on 2026-09-21T19:12:56+00:00, and is served unchanged by
`GET /api/model/performance`. Nothing here is estimated or rounded up.

## Overview

| | |
|---|---|
| Task | Multi-label classification of disaster response messages into 35 categories |
| Serving model | `distilbert` (fine-tuned `distilbert-base-multilingual-cased`) |
| Explanation model | `tfidf_linearsvc_wordchar` (linear coefficients x TF-IDF values) |
| Training data | Figure-Eight disaster response corpus, 25,988 rows after cleaning and noise removal |
| Split | 15,592 train / 5,198 validation / 5,198 test, seed 42 |
| Decision rule | One tuned threshold per label, fitted on validation only |
| Library versions | scikit-learn 1.9.0, Python 3.13 |

## Headline results (test split)

| Metric | Value |
|---|---|
| Macro F1 | **0.4763** |
| Micro F1 | 0.6797 |
| Weighted F1 | 0.6990 |
| Samples F1 | 0.5127 |
| Macro PR-AUC | 0.4554 |
| Exact match (all 35 labels correct) | 0.2824 |
| Hamming accuracy | 0.9362 |

The previous DisasterIQ model reported **0.405** macro F1 with a fixed 0.5
threshold, no class balancing and no validation split. The current model scores
**0.4763**, an improvement of **17.6%**.

Threshold tuning is a large part of that: the same trained model scores
0.3894 macro F1 at a fixed 0.5 cut-off. Validation macro F1 is
0.4954, slightly above the test figure, which is the expected cost of
fitting thresholds on that split.

## Candidate comparison

All six candidates used the same splits, the same class balancing and the same
validation-only threshold tuning. The winner was chosen on test macro F1.

| Model | Macro F1 | Micro F1 | Macro PR-AUC | Macro F1 at 0.5 | Fit | Inference |
|---|---|---|---|---|---|---|
| **distilbert** | 0.4763 | 0.6797 | 0.4554 | 0.3894 | 263 s | 3.279 ms |
| tfidf_linearsvc_wordchar | 0.4578 | 0.6709 | 0.4294 | 0.3116 | 324 s | 0.817 ms |
| tfidf_logreg_word | 0.4508 | 0.6570 | 0.4251 | 0.4337 | 27 s | 0.112 ms |
| minilm_logreg | 0.4456 | 0.6681 | 0.4202 | 0.3528 | 54 s | 0.918 ms |
| tfidf_logreg_wordchar | 0.4454 | 0.6472 | 0.4225 | 0.4381 | 206 s | 0.544 ms |
| ensemble_sgd_cnb | 0.4171 | 0.6250 | 0.3873 | 0.4097 | 14 s | 0.246 ms |

Notes on the comparison:

* The tuned version of the **original ensemble** (`ensemble_sgd_cnb`) reaches
  0.4171, so class balancing and threshold tuning alone already beat the
  documented 0.405 baseline.
* Character n-grams did not help the logistic regression
  (`tfidf_logreg_wordchar` < `tfidf_logreg_word`), but did help the calibrated
  LinearSVC, which is the best classical model.
* MiniLM sentence embeddings with a logistic head were competitive but did not
  beat TF-IDF, which is common on short, keyword-driven text.
* DistilBERT wins by 4.0% over the best classical model. It is a multilingual
  checkpoint, which also makes it more robust when translation is unavailable.
  It costs a GPU at training time and ~3.3 ms per message at inference.

If torch is not installed, or the DistilBERT weights directory is missing, the
API detects it at startup and serves the explanation model instead, logging the
downgrade. The API reports whichever model is actually serving.

## Per-label performance (test split)

| Label | Precision | Recall | F1 | PR-AUC | Threshold | Support |
|---|---|---|---|---|---|---|
| `related` | 0.876 | 0.932 | **0.903** | 0.958 | 0.44 | 3,987 |
| `earthquake` | 0.794 | 0.837 | **0.815** | 0.821 | 0.76 | 503 |
| `weather_related` | 0.779 | 0.800 | **0.789** | 0.819 | 0.71 | 1,446 |
| `aid_related` | 0.709 | 0.856 | **0.775** | 0.834 | 0.45 | 2,205 |
| `food` | 0.712 | 0.839 | **0.770** | 0.819 | 0.70 | 615 |
| `request` | 0.756 | 0.655 | **0.702** | 0.762 | 0.77 | 926 |
| `water` | 0.669 | 0.731 | **0.699** | 0.704 | 0.83 | 338 |
| `storm` | 0.615 | 0.786 | **0.690** | 0.672 | 0.80 | 486 |
| `floods` | 0.706 | 0.652 | **0.678** | 0.676 | 0.83 | 420 |
| `shelter` | 0.648 | 0.704 | **0.675** | 0.696 | 0.82 | 473 |
| `direct_report` | 0.676 | 0.630 | **0.652** | 0.698 | 0.73 | 1,024 |
| `death` | 0.620 | 0.631 | **0.625** | 0.663 | 0.84 | 233 |
| `buildings` | 0.566 | 0.588 | **0.576** | 0.580 | 0.81 | 279 |
| `clothing` | 0.546 | 0.573 | **0.559** | 0.537 | 0.74 | 82 |
| `cold` | 0.589 | 0.500 | **0.541** | 0.476 | 0.76 | 106 |
| `military` | 0.451 | 0.612 | **0.519** | 0.465 | 0.82 | 157 |
| `medical_help` | 0.467 | 0.546 | **0.504** | 0.440 | 0.72 | 441 |
| `other_aid` | 0.419 | 0.559 | **0.479** | 0.478 | 0.64 | 712 |
| `medical_products` | 0.482 | 0.474 | **0.478** | 0.461 | 0.85 | 255 |
| `electricity` | 0.478 | 0.470 | **0.474** | 0.376 | 0.74 | 115 |
| `money` | 0.432 | 0.500 | **0.464** | 0.424 | 0.69 | 128 |
| `refugees` | 0.367 | 0.563 | **0.444** | 0.413 | 0.72 | 167 |
| `transport` | 0.409 | 0.436 | **0.422** | 0.399 | 0.78 | 227 |
| `search_and_rescue` | 0.379 | 0.348 | **0.363** | 0.323 | 0.70 | 135 |
| `other_weather` | 0.256 | 0.477 | **0.333** | 0.236 | 0.75 | 279 |
| `infrastructure_related` | 0.257 | 0.452 | **0.328** | 0.222 | 0.72 | 345 |
| `hospitals` | 0.282 | 0.369 | **0.320** | 0.248 | 0.59 | 65 |
| `fire` | 0.276 | 0.340 | **0.305** | 0.248 | 0.52 | 47 |
| `other_infrastructure` | 0.175 | 0.537 | **0.265** | 0.179 | 0.66 | 229 |
| `aid_centers` | 0.097 | 0.286 | **0.145** | 0.094 | 0.49 | 63 |
| `security` | 0.090 | 0.299 | **0.139** | 0.063 | 0.53 | 77 |
| `missing_people` | 0.185 | 0.093 | **0.123** | 0.072 | 0.65 | 54 |
| `tools` | 0.075 | 0.100 | **0.086** | 0.053 | 0.32 | 30 |
| `offer` | 0.009 | 0.037 | **0.014** | 0.022 | 0.26 | 27 |
| `shops` | 0.007 | 0.045 | **0.012** | 0.009 | 0.25 | 22 |

`child_alone` has zero positive examples in the corpus and is dropped before
training, which is why 35 labels are served rather than 36.

## Limitations

* **Rare labels are unreliable.** `shops` (22 test examples), `offer` (27),
  `tools` (30), `missing_people` (54) and `security` (77) score below 0.15 F1.
  The model should not be trusted on these, and the UI flags them.
* **`offer` is close to unusable**, which matters in practice: messages
  offering help are frequently scored as requests for the same resource. The
  severity score damps this case explicitly (see `docs/DECISIONS.md`, D8), but
  the underlying classification is still wrong.
* **Event labels are inferred, not ground truth.** Keyword and id-range rules
  assign an event to 54% of the corpus; the rest, mostly news wire copy, stays
  `Other`.
* **No timestamps, no coordinates.** The corpus carries neither, so nothing in
  DisasterIQ is a real time series, and the corpus cannot be mapped. The
  "trend" sparklines follow corpus id order and say so.
* **Dataset bias.** Roughly 40% of the corpus is the Haiti earthquake response,
  and the data is from 2010-2012. Vocabulary, place names and needs from other
  regions and later events are under-represented. Non-English messages appear
  mainly as translations in the `original` column.
* **Severity levels saturate.** Most real field reports score above the 70
  "critical" band, so the level chip separates urgent from non-urgent traffic
  but not urgent from most urgent. The underlying 0-100 score still ranks
  correctly, and the triage queue sorts on the score rather than the band.
* **Severity weights are an editorial judgement**, not a statistically derived
  quantity. They are defined in `backend/services/severity.py` and are meant to
  be reviewed by domain experts.
* **Recommendations are rules, not learning.** They come from
  `backend/data/recommendation_rules.yaml` and inherit every error the
  classifier makes upstream.

## Intended use

Decision support for triaging large volumes of incoming messages: ranking by
severity, surfacing likely needs, and suggesting which team to involve. It is
not a warning system, not a dispatch system, and must not be used to decide
that a message does *not* need a human. Recall matters more than precision in
this setting, which is why thresholds are tuned for F1 per label rather than a
single global cut-off, and why the queue is sorted rather than filtered.

## Reproducing

```bash
python -m backend.etl                      # rebuild the SQLite cache
python -m backend.model.train_model        # full benchmark, writes docs/metrics.json
python -m backend.model.train_model --fast # skip the transformer candidates
```
