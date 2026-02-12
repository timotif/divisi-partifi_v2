# Divisi (partifi-v2)

Divisi is a music score partitioning tool that splits orchestral and ensemble PDF scores into individual instrument parts. Upload a full score, mark where each instrument's staff begins and ends, preview the layout, and download clean per-part PDFs.

Inspired by the original [partifi.org](https://partifi.org) — a tool that was genuinely invaluable to musicians everywhere. This project aims to keep those ideals alive with a modern stack.

## How it works

1. **Upload** a PDF score. The backend extracts each page as a high-resolution image.
2. **Mark dividers** on each page to separate instrument staves. Name each strip (Violin I, Viola, etc.) — auto-fill handles repeating patterns across systems and pages.
3. **Select header and markings** (title block, tempo markings) as rectangle regions. These get attached to each part automatically.
4. **Preview the layout** before exporting. Adjust system spacing, drag individual staves, and insert page breaks. Changes update in real time.
5. **Generate and download** individual part PDFs, properly paginated onto A4 pages.

## Tech stack

- **Backend**: Python, Flask, PyMuPDF, OpenCV, NumPy
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
  app.py               Flask API server (upload, partition, preview, generate, download)

frontend/src/
  MusicPartitioner.js  Top-level state and workflow controller
  components/
    UploadScreen.js    PDF upload
    Toolbar.js         Divider, header, and marking tools
    ScoreCanvas.js     Page image with draggable dividers and rectangle selection
    StripNamesColumn.js  Editable instrument name list with auto-fill
    PageNavigation.js  Page selector with confirmation indicators
    LayoutPreview.js   Preview phase: part tabs, spacing slider
    PagePreviewArea.js Interactive A4 preview with pagination, draggable staves, page breaks
    ExportResults.js   Part download links
```

### Key features

- **System dividers**: Shift+click adds a system divider (red) to mark where a new system group begins. Regular click adds a part divider (blue) between individual staves. Auto-fill resets at each system boundary.
- **Auto-fill naming**: Name the instruments once in the first system. Subsequent staves and pages auto-fill by cycling through the known sequence.
- **Layout preview**: Client-side pagination distributes staves across A4 pages. Drag staves to adjust vertical position, click between staves to insert forced page breaks, and use the spacing slider (8-16mm) to control density.
- **Marking placement**: Header and tempo markings are selected as rectangles and automatically repositioned on each part's output pages with collision avoidance.

## Support

If you find Divisi useful and want to support its development:

- [Buy Me a Coffee](https://buymeacoffee.com/timotif)
- [Ko-fi](https://ko-fi.com/timotif)

## License

Copyright (C) 2026 Timoti Fregni

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE). This means if you modify Divisi and offer it as a network service, you must make your source code available to users of that service.
