# Divisi (partifi-v2)

Divisi is a music score partitioning tool that splits orchestral and ensemble PDF scores into individual instrument parts. Upload a full score, mark where each instrument's staff begins and ends, preview the layout, and download clean per-part PDFs.

Inspired by the original [partifi.org](https://partifi.org) — a tool that was genuinely invaluable to musicians everywhere. This project aims to keep those ideals alive with a modern stack.

## How it works

1. **Upload** a PDF score. The backend extracts each page as a high-resolution image.
2. **Set the score range** if the file has front matter or already-extracted parts around the score itself — only pages inside the range are analyzed and exported.
3. **Auto-detect staves** — Divisi analyzes each page in four phases: it segments the page into system bands using vertical ink signal in the left margin, detects staves within each band via horizontal projection, confirms system boundaries using barline runs, and scores confidence. Dividers are placed automatically and snapped to a clear row between staves; you can adjust, add, or remove any of them, and Ctrl/Cmd+Z undoes the last change. Toggle auto-detection off to place dividers manually.
4. **Name instruments** — type part names once and auto-fill handles the rest, continuing the instrument order across systems and pages.
5. **Select header and markings** (title block, tempo markings) as rectangle regions. These get attached to each part automatically.
6. **Preview the layout** before exporting. Adjust system spacing, drag individual staves, and insert page breaks. Changes update in real time.
7. **Generate and download** individual part PDFs, properly paginated onto A4 pages.

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

### Tests

```bash
source .venv/bin/activate
python -m pytest backend/tests -q    # backend

cd frontend && npm test              # frontend (CI=true to run once and exit)
```

## Architecture

```
backend/
  analyzer.py          Core engine: Score, Page, Staff, Part classes + image processing
  app.py               Flask API server (upload, partition, detect, preview, generate, download)
  db.py                SQLite persistence: scores, composers, setups, generated parts
  detection/
    projection.py      Staff detection pipeline: system band segmentation, stave detection,
                       barline confirmation, system assembly, confidence scoring
    hough.py           Experimental Hough transform line detection
    pdf.py             Shared PDF page extraction utility
    detection_flow.md  Mermaid diagram of the full detection pipeline

frontend/src/
  MusicPartitioner.js  Top-level state and workflow controller
  musicMetadata.js     Static lists: nationalities, periods
  components/
    UploadScreen.js    PDF upload with composer and title autocomplete
    Toolbar.js         Divider tools, header/marking selection, auto-detect toggle
    ScoreCanvas.js     Page image with draggable dividers, rectangle selection, detection overlay
    StripNamesColumn.js  Editable instrument name list with auto-fill and inline suggestions
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
  utils/
    knownSequence.js   Instrument-order model: score-wide vote, name fill, inline suggestion
    scoreRange.js      1-indexed inclusive page range, converted in one place
    pageWindow.js      Bounded page-dot set so long scores keep their navigator
```

Frontend units are tested with Jest and React Testing Library (`*.test.js`
alongside the module); backend tests live in `backend/tests/`.

## Features

Everything partifi.org did:

- **Upload a PDF score** and extract individual instrument parts
- **Automatic staff detection** — a four-phase pipeline segments the page into system bands (via vertical barline signal in the left margin), detects staves within each band, confirms system boundaries using barline runs, and produces a confidence score. Dividers are placed automatically and snapped to a clear row between staves; you can adjust, add, or remove any of them.
- **Auto-fill naming** — name the instruments once in the first system; subsequent staves and pages fill in automatically. The instrument order is learned from the whole score rather than the page on screen, so turning a page continues the sequence instead of restarting it, and a page that omits the opening instruments picks up from whichever name you type first. Focusing a field selects the name in it, so one keystroke clears a wrong guess; an inline suggestion completes what you type, Tab accepts it and Esc dismisses it.
- **Persistent library** — uploaded scores and their layouts are saved to disk; come back later and pick up where you left off. Generated parts are listed on each score's card and can be downloaded again without regenerating.
- **Free** — no account, no subscription, no strings attached

Things we always wished it had:

- **System dividers and dead zones** — shift+click marks where a new system begins; the dead space between systems is excluded and never ends up in a part
- **Header and markings** — select the title block and tempo/dynamic markings as rectangles once; they travel automatically to every part, repositioned to avoid collisions
- **Layout preview with per-part control** — adjust system spacing (8–16mm), drag individual staves vertically, and insert forced page breaks per part before generating anything
- **Score page range** — scores often arrive wrapped in front matter or bound together with parts someone already extracted; set the first and last page of the actual score and everything outside it is ignored
- **Undo and divider snapping** — Ctrl/Cmd+Z steps back through divider edits, and auto-placed dividers snap to a clear row between staves, with an amber marker on the ones that had no clean gap to land in
- **Built for long scores** — the page navigator windows its dots instead of overflowing, so a 200-page score stays navigable
- **Named setup versions** — a score can hold several complete arrangements of dividers, names, and layout. Start a new version at any point and your work continues in it, leaving the previous one as it stood; switch between them from the editor or the library. Because a score keeps one set of generated PDFs, the library says which version produced the parts currently on disk.
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
