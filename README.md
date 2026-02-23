# Divisi (partifi-v2)

Divisi is a music score partitioning tool that splits orchestral and ensemble PDF scores into individual instrument parts. Upload a full score, mark where each instrument's staff begins and ends, preview the layout, and download clean per-part PDFs.

Inspired by the original [partifi.org](https://partifi.org) — a tool that was genuinely invaluable to musicians everywhere. This project aims to keep those ideals alive with a modern stack.

## How it works

1. **Upload** a PDF score. The backend extracts each page as a high-resolution image.
2. **Auto-detect staves** — Divisi analyzes each page using horizontal projection profiles and automatically places dividers between staves, grouping them into systems. You can adjust, add, or remove any divider. Toggle auto-detection off to place dividers manually.
3. **Name instruments** — type part names once and auto-fill handles the rest, cycling through the sequence across systems and pages.
4. **Select header and markings** (title block, tempo markings) as rectangle regions. These get attached to each part automatically.
5. **Preview the layout** before exporting. Adjust system spacing, drag individual staves, and insert page breaks. Changes update in real time.
6. **Generate and download** individual part PDFs, properly paginated onto A4 pages.

## Tech stack

- **Backend**: Python, Flask, PyMuPDF, OpenCV, NumPy, SciPy
- **Frontend**: React 19, Tailwind CSS

## Running with Docker (recommended)

### Development (hot reload)

```bash
docker compose -f docker-compose.dev.yml up --build
# Frontend: http://localhost:3000
# Backend:  http://localhost:5000
```

Source files are bind-mounted — edits to `backend/*.py` restart Flask automatically; edits to `frontend/src/` trigger a browser refresh.

### Production

```bash
docker compose up --build
# App: http://localhost:80
```

Serves the React build via nginx. API requests are proxied to gunicorn internally.

## Local development setup (without Docker)

### Backend

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cd backend
python app.py          # Flask server on port 5000
```

### Frontend

```bash
cd frontend
npm install
npm start              # Dev server on port 3000 (proxies to backend)
```

## Architecture

```
backend/
  analyzer.py          Core engine: Score, Page, Staff, Part classes + image processing
  app.py               Flask API server (upload, partition, detect, preview, generate, download)
  db.py                SQLite persistence: scores, composers, setups, generated parts
  detection/
    projection.py      Staff detection via horizontal projection profiles + peak clustering
    hough.py           Experimental Hough transform line detection
    pdf.py             Shared PDF page extraction utility

frontend/src/
  MusicPartitioner.js  Top-level state and workflow controller
  musicMetadata.js     Static lists: nationalities, periods
  components/
    UploadScreen.js    PDF upload with composer and title autocomplete
    Toolbar.js         Divider tools, header/marking selection, auto-detect toggle
    ScoreCanvas.js     Page image with draggable dividers, rectangle selection, detection overlay
    StripNamesColumn.js  Editable instrument name list with auto-fill
    PageNavigation.js  Page selector with confirmed/detected/untouched indicators
    LayoutPreview.js   Preview phase: part tabs, spacing slider
    PagePreviewArea.js Interactive A4 preview with pagination, draggable staves, page breaks
    ExportResults.js   Part download links
    LibraryScreen.js   Saved scores and composer management
    ComposerInput.js   Autocomplete input with inline composer creation
    ComposerModal.js   Create/edit composer form
    TitleInput.js      Title input with score search autocomplete
    StaticAutocompleteInput.js  Searchable select backed by a local list
  hooks/
    useAutocomplete.js Reusable debounced fetch + keyboard navigation hook
```

## Features

Everything partifi.org did:

- **Upload a PDF score** and extract individual instrument parts
- **Automatic staff detection** — staves are detected automatically; you can adjust, add, or remove any divider
- **Auto-fill naming** — name the instruments once in the first system; subsequent staves and pages fill in automatically
- **Persistent library** — uploaded scores and their layouts are saved to disk; come back later and pick up where you left off
- **Free** — no account, no subscription, no strings attached

Things we always wished it had:

- **System dividers and dead zones** — shift+click marks where a new system begins; the dead space between systems is excluded and never ends up in a part
- **Header and markings** — select the title block and tempo/dynamic markings as rectangles once; they travel automatically to every part, repositioned to avoid collisions
- **Layout preview with per-part control** — adjust system spacing (8–16mm), drag individual staves vertically, and insert forced page breaks per part before generating anything
- **Composer database** — composers are stored with name, dates, nationality, period, and links; autocomplete on upload, editable from the library at any time

## A note on partifi.org

Divisi exists because of [partifi.org](https://partifi.org). For years it was the quiet workhorse of musicians everywhere — paste in a score, get your parts, go rehearse. Simple, fast, genuinely useful, and free.

At some point it broke, and attempts to reach the developers went unanswered. Its source code was never released, so there was no way to fix it or carry it forward. The tools that filled the gap are mostly paid. Divisi is an attempt to bring back what partifi offered, and keep it free and open.

## Support

If you find Divisi useful and want to support its development:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy_Me_a_Coffee-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/timotif)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-FF5E5B?style=for-the-badge&logo=kofi&logoColor=white)](https://ko-fi.com/timotif)

## License

Copyright (C) 2026 Timoti Fregni

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE). This means if you modify Divisi and offer it as a network service, you must make your source code available to users of that service.
