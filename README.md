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

## Development setup

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
  detection/
    projection.py      Staff detection via horizontal projection profiles + peak clustering
    hough.py           Experimental Hough transform line detection
    pdf.py             Shared PDF page extraction utility

frontend/src/
  MusicPartitioner.js  Top-level state and workflow controller
  components/
    UploadScreen.js    PDF upload
    Toolbar.js         Divider tools, header/marking selection, auto-detect toggle
    ScoreCanvas.js     Page image with draggable dividers, rectangle selection, detection overlay
    StripNamesColumn.js  Editable instrument name list with auto-fill
    PageNavigation.js  Page selector with confirmed/detected/untouched indicators
    LayoutPreview.js   Preview phase: part tabs, spacing slider
    PagePreviewArea.js Interactive A4 preview with pagination, draggable staves, page breaks
    ExportResults.js   Part download links
```

### Key features

- **Automatic staff detection**: Each page is analyzed on view using horizontal projection profiles to detect staff lines, cluster them into staves, and group staves into systems. Dividers are placed automatically with consistent margins. The detection pipeline is modular — divider placement logic is separated from the detection algorithm for future refinement (e.g., collision-aware positioning).
- **System dividers**: Shift+click adds a system divider (red) to mark where a new system group begins. Regular click adds a part divider (blue) between individual staves. Auto-fill resets at each system boundary.
- **Auto-fill naming**: Name the instruments once in the first system. Subsequent staves and pages auto-fill by cycling through the known sequence.
- **Layout preview**: Client-side pagination distributes staves across A4 pages. Drag staves to adjust vertical position, click between staves to insert forced page breaks, and use the spacing slider (8-16mm) to control density.
- **Marking placement**: Header and tempo markings are selected as rectangles and automatically repositioned on each part's output pages with collision avoidance.

## Support

If you find Divisi useful and want to support its development:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy_Me_a_Coffee-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/timotif)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-FF5E5B?style=for-the-badge&logo=kofi&logoColor=white)](https://ko-fi.com/timotif)

## License

Copyright (C) 2026 Timoti Fregni

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE). This means if you modify Divisi and offer it as a network service, you must make your source code available to users of that service.
