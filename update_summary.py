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

    content = f"""# DisasterIQ — Project Summary Document

> Auto-updated by Kiro on every file save/create/delete.  
> Last updated: **{now}**

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

> {backend_count} backend files · {frontend_count} frontend files

```
{tree_str}
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
{changelog_table}
"""

    with open(SUMMARY_PATH, "w", encoding="utf-8") as f:
        f.write(content)

    print(f"[Summary] Updated SUMMARY.md at {now} — {description}")


if __name__ == "__main__":
    generate()
