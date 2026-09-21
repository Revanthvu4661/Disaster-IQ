"""
update_summary.py
-----------------
Regenerates SUMMARY.md with a live file tree, file sizes, and a timestamped
change-log entry.  Called automatically by the Kiro PostFileSave /
PostFileCreate / PostFileDelete hook.

Usage (manual):
    python update_summary.py [optional: "description of change"]
"""

import os
import sys
import json
from datetime import datetime

NEWLINE = "\n"

#: Filled in by ``load_model_facts`` from docs/metrics.json.
TEMPLATE_MODEL_BLOCK = """- **Serving model:** `{name}`, trained {trained}
- **Split:** {train:,} train / {validation:,} validation / {test_rows:,} test (seed {seed})
- **Decision rule:** one threshold per label, tuned on the validation split only
- **Severity:** weighted noisy-OR over life-threatening categories, scored 0-100
- **Test macro F1:** **{macro:.4f}** (micro {micro:.4f}, macro PR-AUC {pr_auc:.4f})

### Candidate benchmark (test split)

| Model | Macro F1 | Micro F1 | Macro F1 at 0.5 |
|---|---|---|---|
{comparison}

### Strongest labels (test split)

| Category | F1 | Support |
|---|---|---|
{label_table}

Full per-label numbers and limitations: `MODEL_CARD.md`."""

ROOT = os.path.dirname(os.path.abspath(__file__))
SUMMARY_PATH = os.path.join(ROOT, "SUMMARY.md")

# Files / dirs to skip when building the tree
SKIP_DIRS  = {"node_modules", "__pycache__", ".git", "dist", ".vite", ".kiro"}
SKIP_FILES = {"SUMMARY.md", ".DS_Store", "Thumbs.db"}
SKIP_EXTS  = {".pyc", ".pyo", ".map"}


# ── helpers ───────────────────────────────────────────────────────────────────

def fmt_size(path):
    try:
        b = os.path.getsize(path)
        if b >= 1_048_576: return f"{b/1_048_576:.1f} MB"
        if b >= 1024:      return f"{b/1024:.1f} KB"
        return f"{b} B"
    except Exception:
        return ""


def build_tree(directory, prefix="", depth=0, max_depth=5):
    if depth > max_depth:
        return []
    lines = []
    try:
        entries = sorted(os.scandir(directory), key=lambda e: (not e.is_dir(), e.name.lower()))
    except PermissionError:
        return []

    visible = [
        e for e in entries
        if not (e.name.startswith(".") and e.name not in {".kiro"})
        and e.name not in SKIP_DIRS
        and e.name not in SKIP_FILES
        and (e.is_dir() or os.path.splitext(e.name)[1] not in SKIP_EXTS)
    ]

    for i, entry in enumerate(visible):
        connector = "└── " if i == len(visible) - 1 else "├── "
        if entry.is_dir():
            if entry.name in SKIP_DIRS:
                continue
            lines.append(f"{prefix}{connector}{entry.name}/")
            ext_prefix = prefix + ("    " if i == len(visible) - 1 else "│   ")
            lines.extend(build_tree(entry.path, ext_prefix, depth + 1, max_depth))
        else:
            size = fmt_size(entry.path)
            size_str = f"  ({size})" if size else ""
            lines.append(f"{prefix}{connector}{entry.name}{size_str}")
    return lines


def count_files(directory):
    total = 0
    for dirpath, dirnames, filenames in os.walk(directory):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        total += sum(
            1 for f in filenames
            if f not in SKIP_FILES and os.path.splitext(f)[1] not in SKIP_EXTS
        )
    return total


def read_existing_changelog():
    """Extract the existing Change Log table rows from SUMMARY.md."""
    if not os.path.exists(SUMMARY_PATH):
        return []
    with open(SUMMARY_PATH, encoding="utf-8") as f:
        content = f.read()
    rows = []
    in_table = False
    for line in content.splitlines():
        if "## Change Log" in line:
            in_table = True
            continue
        if in_table:
            stripped = line.strip()
            if stripped.startswith("|") and "---" not in stripped and "Date" not in stripped and "Change" not in stripped:
                parts = [p.strip() for p in stripped.strip("|").split("|")]
                if len(parts) >= 2 and parts[0]:
                    rows.append((parts[0], parts[1]))
    return rows


def get_change_description():
    """
    Try to read a description from:
    1. CLI argument
    2. stdin JSON (hook passes context on stdin)
    """
    if len(sys.argv) > 1:
        return " ".join(sys.argv[1:])
    try:
        if not sys.stdin.isatty():
            raw = sys.stdin.read()
            if raw.strip():
                data = json.loads(raw)
                # Kiro hook context has filePath for file events
                file_path = data.get("filePath", "")
                tool = data.get("toolName", "")
                if file_path:
                    rel = os.path.relpath(file_path, ROOT).replace("\\", "/")
                    return f"File updated: `{rel}`"
                if tool:
                    return f"Action: {tool}"
    except Exception:
        pass
    return "Project files updated"


def load_model_facts():
    """Read the real metrics written by the last training run.

    Never invents numbers: when docs/metrics.json is missing the summary says
    so instead of printing a stale figure.
    """
    path = os.path.join(ROOT, "docs", "metrics.json")
    if not os.path.exists(path):
        return "not trained yet", (
            "No `docs/metrics.json` found. Run `python -m backend.model.train_model` "
            "to generate the benchmark and the metrics."
        )
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)

    test = data["test"]
    rows = sorted(test["per_label"], key=lambda r: -r["f1"])[:7]
    label_table = NEWLINE.join(
        "| {} | {:.3f} | {:,} |".format(r["category"], r["f1"], r["support"]) for r in rows
    )
    comparison = NEWLINE.join(
        "| {} | {:.4f} | {:.4f} | {:.4f} |".format(
            c["name"], c["test_macro_f1"], c["test_micro_f1"], c["macro_f1_at_0_5"]
        )
        for c in data["comparison"]
    )
    split = data["split"]
    block = TEMPLATE_MODEL_BLOCK.format(
        name=data["model_name"],
        trained=data["trained_at"],
        train=split["train"],
        validation=split["validation"],
        test_rows=split["test"],
        seed=split["seed"],
        macro=test["macro_f1"],
        micro=test["micro_f1"],
        pr_auc=test["macro_pr_auc"],
        comparison=comparison,
        label_table=label_table,
    )
    return data["model_name"], block


# ── main ─────────────────────────────────────────────────────────────────────

def generate():
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    date_only = datetime.now().strftime("%Y-%m-%d")

    # Collect change description
    description = get_change_description()

    # Build file tree
    tree_lines = build_tree(ROOT)
    tree_str = "\n".join(tree_lines)

    # Count files per section
    backend_count  = count_files(os.path.join(ROOT, "backend"))
    frontend_count = count_files(os.path.join(ROOT, "frontend"))

    # Changelog — prepend new entry (keep last 20)
    existing_log = read_existing_changelog()
    new_entry = (date_only, description)
    # Avoid duplicate consecutive entries for the same description
    if not existing_log or existing_log[0] != new_entry:
        existing_log.insert(0, new_entry)
    changelog_rows = existing_log[:20]
    changelog_table = "\n".join(f"| {d} | {c} |" for d, c in changelog_rows)

    model_name, model_block = load_model_facts()

    content = f"""# DisasterIQ — Project Summary Document

> Auto-updated by Kiro on every file save/create/delete.  
> Last updated: **{now}**

---

## Project Overview

**DisasterIQ** is a full-stack Disaster Management Analytics & Prediction Platform.  
It ingests real Figure-Eight disaster response data (~26,000 messages), surfaces interactive
analytics, classifies incoming messages across 35 disaster categories, scores how
life-threatening each one is, and turns the result into a prioritised action plan.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend API | FastAPI + uvicorn (Python) |
| ETL / Storage | pandas → SQLite |
| ML Model | {model_name} (chosen by a six-candidate benchmark) |
| Recommendations | YAML rule table (category rules, severity escalations, event overlays) |
| Frontend | React 19 + Vite + Tailwind v4 + Recharts + Leaflet |

---

## How to Run

### Backend (from the project root)
```bash
pip install -r backend/requirements-dev.txt
python -m backend.etl                       # build the SQLite cache
python -m backend.model.train_model --fast  # train a model
python -m uvicorn backend.main:app --reload --port 8000
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

> {backend_count} backend files · {frontend_count} frontend files

```
{tree_str}
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Readiness, row count, model status |
| GET | `/api/analytics/summary-stats` | KPIs, sparklines and deltas |
| GET | `/api/analytics/category-distribution` | All 35 categories sorted by count |
| GET | `/api/analytics/volume-by-event` | Volume per inferred disaster event |
| GET | `/api/analytics/volume-by-genre` | Volume per source genre |
| GET | `/api/analytics/event-category-mix` | Need mix per event |
| GET | `/api/analytics/genre-event-matrix` | Genre x event heatmap |
| GET | `/api/analytics/category-cooccurrence` | Co-occurrence matrix and top pairs |
| GET | `/api/analytics/needs-bundles` | Frequent category combinations |
| GET | `/api/analytics/top-terms/{{category}}` | Distinctive terms per category |
| GET | `/api/analytics/data-quality` | Duplicates, noise, imbalance |
| GET | `/api/analytics/search?q=` | Keyword in context |
| POST | `/api/predict` | Classify one message with severity, explanation and plan |
| POST | `/api/predict/batch`, `/api/predict/batch-csv` | Batch triage |
| POST | `/api/recommend` | Prioritised action plan |
| GET | `/api/model/performance` | Test metrics per label and the benchmark |
| GET | `/api/hazards` | Live USGS / EONET / GDACS feeds |

---

## ML Model

{model_block}

---

## Dataset

- **Source:** Figure-Eight (now Appen)
- **Events:** Haiti earthquake · Chile earthquake · Pakistan floods · Superstorm Sandy
- **Raw rows:** 26,248 rows (26,180 unique ids)
- **After cleaning:** 26,175 messages; 187 rows flagged `related=2` and excluded from stats
- **Labels:** 36 categories → 35 active (child_alone has 0 positives)
- **Events:** inferred from keywords and id ranges; ~46 % remain "Other"

---

## UI Pages

| Page | What it does |
|---|---|
| Dashboard (`/`) | KPI cards with sparklines, category distribution with drill-down, event comparison, genre x event and co-occurrence heatmaps |
| Insights (`/insights`) | Term explorer, needs bundles, message length, urgent vocabulary, keyword in context, data quality |
| Predict (`/predict`) | Severity gauge, triggered labels with tuned thresholds, highlighted evidence, action timeline, copyable incident summary |
| Triage Inbox (`/triage`) | Paste or upload CSV, severity-sorted queue with filters, top 10 urgent, resource demand forecast, CSV export |
| Live Hazards (`/hazards`) | USGS / EONET / GDACS on a Leaflet map, India filter, offline state |
| Model (`/model`) | Candidate comparison, sortable per-label metrics, PR and threshold curves |
| About (`/about`) | Data, pipeline, rule table and limitations |

Dark and light themes, a command palette (Ctrl+K) and a mobile bottom nav are
available on every page.

---

## Change Log

| Date | Change |
|---|---|
{changelog_table}
"""

    with open(SUMMARY_PATH, "w", encoding="utf-8") as f:
        f.write(content)

    print(f"[Summary] Updated SUMMARY.md at {now} — {description}")


if __name__ == "__main__":
    generate()
