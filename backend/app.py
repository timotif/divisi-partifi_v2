import logging
import os
import io
import uuid
import time
import logging
import cv2
import numpy as np
import pymupdf as fitz
from flask import Flask, request, jsonify, send_file, abort
from flask_cors import CORS
from analyzer import (
	Score, Staff, Part, TMP_DIR,
	sanitize_string, PageError, StaffError, PartError
)
from detection import detect_staves, detect_annotations, detect_instrument_labels

logger = logging.getLogger(__name__)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app, origins=os.getenv('CORS_ORIGINS', '*').split(','))

MAX_UPLOAD_SIZE_MB = 50
app.config['MAX_CONTENT_LENGTH'] = MAX_UPLOAD_SIZE_MB * 1024 * 1024

# In-memory session store: score_id -> { 'score': Score, 'metadata': dict, 'created_at': float }
scores: dict[str, dict] = {}

MAX_SESSIONS = 50
SESSION_TTL_SECONDS = 3600  # 1 hour


def _evict_expired_sessions():
	"""Remove sessions older than SESSION_TTL_SECONDS, then evict the oldest
	if we're still at capacity."""
	now = time.time()
	expired = [sid for sid, entry in scores.items()
			   if now - entry.get('created_at', 0) > SESSION_TTL_SECONDS]
	for sid in expired:
		logger.info("Evicting expired session %s", sid)
		del scores[sid]

	while len(scores) >= MAX_SESSIONS:
		oldest = min(scores, key=lambda k: scores[k].get('created_at', 0))
		logger.info("Evicting oldest session %s (at capacity)", oldest)
		del scores[oldest]


# --- Error handlers ---

@app.errorhandler(400)
def bad_request(e):
	return jsonify({"error": str(e.description)}), 400

@app.errorhandler(404)
def not_found(e):
	return jsonify({"error": str(e.description)}), 404

@app.errorhandler(413)
def too_large(e):
	return jsonify({"error": f"File too large. Maximum size is {MAX_UPLOAD_SIZE_MB}MB."}), 413

@app.errorhandler(500)
def internal_error(e):
	return jsonify({"error": "Internal server error"}), 500


def _validate_score_id(score_id: str) -> dict:
	"""Validate UUID format and look up score. Aborts with 400/404 on failure.
	Refreshes the session TTL on successful access."""
	try:
		uuid.UUID(score_id)
	except ValueError:
		abort(400, description="Invalid score ID format")
	entry = scores.get(score_id)
	if not entry:
		abort(404, description="Score not found")
	entry['created_at'] = time.time()
	return entry


# --- Endpoints ---

@app.route('/api/upload', methods=['POST'])
def upload_score():
	"""Accept a PDF upload, extract pages, return metadata."""
	if 'file' not in request.files:
		abort(400, description="No file provided")

	file = request.files['file']
	if not file.filename or not file.filename.lower().endswith('.pdf'):
		abort(400, description="Only PDF files are accepted")

	title = request.form.get('title') or os.path.splitext(file.filename)[0]
	composer = request.form.get('composer') or "Unknown"

	score_id = str(uuid.uuid4())
	pdf_path = os.path.join(TMP_DIR, f"{score_id}.pdf")

	try:
		os.makedirs(TMP_DIR, exist_ok=True)
		file.save(pdf_path)

		score = Score(
			path=pdf_path,
			title=title,
			composer=composer,
			keep_temp_files=False
		)
		score._extract_pages(dpi=300)
	except Exception as e:
		logger.exception("PDF processing failed for upload")
		if os.path.exists(pdf_path):
			os.remove(pdf_path)
		abort(500, description="Failed to process the uploaded PDF")
	finally:
		# Clean up uploaded PDF — pages are already extracted into memory
		if os.path.exists(pdf_path):
			os.remove(pdf_path)

	pages_meta = []
	for i, page in enumerate(score.pages):
		h, w = page.img.shape[:2]
		pages_meta.append({"page_num": i, "width": w, "height": h})

	_evict_expired_sessions()

	scores[score_id] = {
		"score": score,
		"created_at": time.time(),
		"metadata": {
			"score_id": score_id,
			"title": score.title,
			"composer": score.composer,
			"page_count": len(score.pages),
			"pages": pages_meta,
		}
	}

	return jsonify(scores[score_id]["metadata"]), 201


@app.route('/api/scores/<score_id>/pages/<int:page_num>', methods=['GET'])
def serve_page(score_id: str, page_num: int):
	"""Serve an extracted page as a PNG image."""
	entry = _validate_score_id(score_id)
	score = entry["score"]

	if page_num < 0 or page_num >= len(score.pages):
		abort(404, description=f"Page {page_num} not found")

	try:
		png_bytes = score.pages[page_num].to_png_bytes()
	except PageError as e:
		logger.exception("Failed to encode page %d", page_num)
		abort(500, description="Failed to encode page image")

	return send_file(io.BytesIO(png_bytes), mimetype='image/png')


# --- Staff detection helpers ---

# Ink threshold: a row counts as "clear" when it has at most this many ink
# pixels.  At 300 DPI ~5 pixels is a couple of stray noise dots — well below
# any real printed element (staff lines, noteheads, slurs all produce dozens
# to hundreds of ink pixels per row).
_SNAP_INK_THRESHOLD = 5


def _snap_to_clear_row(
	row_start: int,
	row_end: int,
	ideal_y: int,
	projection: np.ndarray,
) -> tuple[int, bool]:
	"""Snap ``ideal_y`` to the nearest clear row within (row_start, row_end).

	Scans outward from ``ideal_y`` — alternating one step above, one step below
	— and returns the first row whose ink count is at or below
	``_SNAP_INK_THRESHOLD``.  This guarantees the result is as close to the
	midpoint as possible and never crosses into printed content.

	If no clear row exists in the gap, returns ``(ideal_y, False)``.

	Args:
		row_start: exclusive lower bound (last row of stave above).
		row_end:   exclusive upper bound (first row of stave below).
		ideal_y:   preferred starting position for the outward scan.
		projection: 1-D ink-count array from horizontal_projection().

	Returns:
		(y, snapped) — final Y and whether a clear row was found.
	"""
	half = (row_end - row_start) // 2
	for offset in range(half + 1):
		for row in ([ideal_y - offset, ideal_y + offset] if offset > 0 else [ideal_y]):
			if row <= row_start or row >= row_end:
				continue
			if int(projection[row]) <= _SNAP_INK_THRESHOLD:
				return row, True
	return ideal_y, False


def find_divider_y(
	stave_above: np.ndarray,
	stave_below: np.ndarray,
	projection: np.ndarray | None = None,
) -> tuple[int, bool]:
	"""Find the Y position for a divider between two adjacent staves.

	Starts at the midpoint between the bottom staff line of stave_above and
	the top staff line of stave_below, then delegates to _snap_to_clear_row
	to land on the nearest ink-free row in the gap.

	Args:
		stave_above: array of Y values for the upper stave's staff lines.
		stave_below: array of Y values for the lower stave's staff lines.
		projection:  1-D ink-count array from horizontal_projection().
		             When None the function falls back to the plain midpoint.

	Returns:
		(y, snapped) — Y position in backend pixels, and a bool indicating
		whether the position was successfully snapped to a clear row
		(False means the gap had no fully-blank row and the midpoint was kept).
	"""
	bottom = int(stave_above[-1])
	top = int(stave_below[0])
	mid = (bottom + top) // 2

	if projection is None or top <= bottom:
		return mid, False

	return _snap_to_clear_row(bottom, top, mid, projection)


def _compute_typical_margin(systems: list[list[np.ndarray]]) -> int:
	"""Compute the typical distance from a mid-divider to the nearest staff.

	Collects half-gaps from all inter-stave midpoints across all systems,
	then returns the median. This is the natural "breathing room" around
	each staff that boundary dividers should replicate.
	"""
	half_gaps: list[int] = []
	for system in systems:
		for i in range(len(system) - 1):
			bottom = int(system[i][-1])
			top = int(system[i + 1][0])
			half_gaps.append((top - bottom) // 2)
	if not half_gaps:
		return 50  # fallback for single-stave systems
	return int(np.median(half_gaps))


def staves_to_dividers(
	systems: list[list[np.ndarray]],
	img_height: int,
	projection: np.ndarray | None = None,
) -> tuple[list[int], list[bool], list[bool]]:
	"""Convert detected stave groups into divider positions and system flags.

	System dividers mark only the **top** of each system. The dead zone
	rendered by the frontend is the region between the previous (part)
	divider and the next system divider. The bottom boundary of each
	system is a regular part divider.

	Boundary dividers (first/last on the page, and around inter-system
	gaps) are placed at the same distance from the staff as a typical
	mid-divider, so all staves get consistent margins.

	All divider types (system, between-stave, bottom boundary) attempt to
	snap to the nearest ink-free row in their respective gap via
	_snap_to_clear_row.

	Args:
		systems: list of systems, each a list of staves (each stave is an
			array of 5 Y pixel positions).
		img_height: page image height in pixels.
		projection: 1-D ink-count array (optional).  When supplied, enables
			white-row snapping for all dividers.

	Returns:
		(dividers, system_flags, snap_flags) — three parallel same-length
		lists sorted by Y.  snap_flags[i] is True when divider i was
		successfully snapped to a clear row, False when it fell back to the
		computed default position.
	"""
	dividers: list[int] = []
	system_flags: list[bool] = []
	snap_flags: list[bool] = []

	margin = _compute_typical_margin(systems)

	for sys_idx, system in enumerate(systems):
		if not system:
			continue

		first_top = int(system[0][0])
		last_bottom = int(system[-1][-1])

		# --- Top boundary (system divider) ---
		if sys_idx == 0:
			# Gap: [0, first_top); ideal position = first_top - margin
			ideal_top = max(0, first_top - margin)
			if projection is not None and first_top > 0:
				top_y, snapped_top = _snap_to_clear_row(0, first_top, ideal_top, projection)
			else:
				top_y, snapped_top = ideal_top, False
		else:
			# Inter-system gap: [prev_bottom, first_top); ideal = 2/3 into gap
			prev_bottom = int(systems[sys_idx - 1][-1][-1])
			gap = first_top - prev_bottom
			ideal_top = prev_bottom + gap * 2 // 3
			if projection is not None and first_top > prev_bottom:
				top_y, snapped_top = _snap_to_clear_row(
					prev_bottom, first_top, ideal_top, projection
				)
			else:
				top_y, snapped_top = ideal_top, False
		dividers.append(top_y)
		system_flags.append(True)
		snap_flags.append(snapped_top)

		# --- Between-stave dividers (part dividers) ---
		for i in range(len(system) - 1):
			y, snapped = find_divider_y(system[i], system[i + 1], projection)
			dividers.append(y)
			system_flags.append(False)
			snap_flags.append(snapped)

		# --- Bottom boundary (part divider) ---
		if sys_idx < len(systems) - 1:
			# Inter-system gap: [last_bottom, next_top); ideal = 1/3 into gap
			next_top = int(systems[sys_idx + 1][0][0])
			gap = next_top - last_bottom
			ideal_bottom = last_bottom + gap // 3
			if projection is not None and next_top > last_bottom:
				bottom_y, snapped_bottom = _snap_to_clear_row(
					last_bottom, next_top, ideal_bottom, projection
				)
			else:
				bottom_y, snapped_bottom = ideal_bottom, False
		else:
			# Gap: [last_bottom, img_height); ideal = last_bottom + margin
			ideal_bottom = min(img_height - 1, last_bottom + margin)
			if projection is not None and img_height > last_bottom:
				bottom_y, snapped_bottom = _snap_to_clear_row(
					last_bottom, img_height, ideal_bottom, projection
				)
			else:
				bottom_y, snapped_bottom = ideal_bottom, False
		dividers.append(bottom_y)
		system_flags.append(False)
		snap_flags.append(snapped_bottom)

	return dividers, system_flags, snap_flags


def _resolve_label_names(label_grid: list[list[dict]]) -> tuple[list[str], list[str]]:
	"""Derive (strip_names, strip_short_names) from an instrument label grid.

	Uses the first system's labels as the naming authority (most likely to
	contain full names). For each stave position, looks for an abbreviated
	version in subsequent systems to use as the short name.

	Args:
		label_grid: Output of detect_instrument_labels() — nested list
		            of {'name', 'short_name', 'is_abbreviated'} dicts.

	Returns:
		(strip_names, strip_short_names) — parallel flat lists, one entry per
		stave in the first system. Both are empty strings for undetected labels.
	"""
	if not label_grid:
		return [], []

	first_sys = label_grid[0]
	strip_names: list[str] = []
	strip_short_names: list[str] = []

	for si, entry in enumerate(first_sys):
		full  = entry['name']
		short = full  # default: same as full name

		# Look for an abbreviated version at the same stave index in later systems
		for later_sys in label_grid[1:]:
			if si < len(later_sys) and later_sys[si]['is_abbreviated']:
				short = later_sys[si]['name']
				break

		strip_names.append(full)
		strip_short_names.append(short)

	return strip_names, strip_short_names


@app.route('/api/scores/<score_id>/pages/<int:page_num>/detect', methods=['POST'])
def detect_page_staves(score_id: str, page_num: int):
	"""Run staff detection on a page and return tentative divider positions.

	No request body required.

	Returns dividers and system flags in backend-pixel space (300 DPI).
	The frontend is responsible for scaling to display pixels using the
	page's known backend dimensions.
	"""
	entry = _validate_score_id(score_id)
	score = entry["score"]

	if page_num < 0 or page_num >= len(score.pages):
		abort(404, description=f"Page {page_num} not found")

	# Return cached result if available
	cache = entry.setdefault("detection_cache", {})
	if page_num in cache:
		cached = cache[page_num]
		return jsonify({
			"confidence":        cached["confidence"],
			"reasons":           cached["reasons"],
			"stave_count":       cached["stave_count"],
			"system_count":      cached["system_count"],
			"dividers":          cached["dividers"],
			"system_flags":      cached["system_flags"],
			"snap_flags":        cached.get("snap_flags", []),
			"strip_names":       cached.get("strip_names", []),
			"strip_short_names": cached.get("strip_short_names", []),
			"header":            list(cached["header"]) if cached.get("header") else None,
			"markings":          [list(m) for m in cached.get("markings", [])],
		})

	page_img = score.pages[page_num].img
	img_height, img_width = page_img.shape[:2]

	try:
		result = detect_staves(page_img)
	except Exception:
		logger.exception("Staff detection failed for page %d", page_num)
		abort(500, description="Staff detection failed")

	systems      = result["systems"]
	staves       = result["staves"]
	barline_info = result["barline_info"]
	confidence   = result["confidence"]
	reasons      = result["reasons"]
	projection   = result["projection"]

	dividers, sys_flags, snap_flags = staves_to_dividers(
		systems, img_height, projection
	)

	# --- Annotation detection (header + markings) ---
	ann = {"header": None, "markings": []}
	try:
		ann = detect_annotations(
			page_img,
			systems,
			img_width,
			img_height,
			is_first_page=(page_num == 0),
		)
	except Exception:
		logger.exception("Annotation detection failed for page %d — continuing without annotations", page_num)

	# --- Instrument label detection ---
	label_grid: list[list[dict]] = []
	try:
		label_grid = detect_instrument_labels(page_img, systems, img_width, img_height, barline_info)
	except Exception:
		logger.exception("Instrument label detection failed for page %d — continuing without labels", page_num)

	detected_strip_names, detected_strip_short_names = _resolve_label_names(label_grid)

	cache[page_num] = {
		"confidence":        confidence,
		"reasons":           reasons,
		"stave_count":       len(staves),
		"system_count":      len(systems),
		"dividers":          dividers,
		"system_flags":      sys_flags,
		"snap_flags":        snap_flags,
		"strip_names":       detected_strip_names,
		"strip_short_names": detected_strip_short_names,
		"header":            ann["header"],
		"markings":          ann["markings"],
	}

	return jsonify({
		"confidence":        confidence,
		"reasons":           reasons,
		"stave_count":       len(staves),
		"system_count":      len(systems),
		"dividers":          dividers,
		"system_flags":      sys_flags,
		"snap_flags":        snap_flags,
		"strip_names":       detected_strip_names,
		"strip_short_names": detected_strip_short_names,
		"header":            list(ann["header"]) if ann["header"] else None,
		"markings":          [list(m) for m in ann["markings"]],
	})


# --- Partition helpers ---

def _build_known_sequence(real_strips: list[dict]) -> list[str]:
	"""Extract the known instrument sequence from a page's first system.

	Returns consecutive unique non-empty names from strip 0, stopping at
	the first repeat, empty name, or system divider boundary.
	"""
	known: list[str] = []
	seen: set[str] = set()
	for s in real_strips:
		if s['is_system_start'] and known:
			break
		name = s['name']
		if not name or name in seen:
			break
		seen.add(name)
		known.append(name)
	return known


def _fill_page_with_sequence(real_strips: list[dict], known: list[str]) -> None:
	"""Fill empty strip names on a page using a known sequence, cycling and
	resetting at system dividers. For non-empty names, sync the sequence
	position so subsequent fills continue correctly."""
	seq_idx = 0
	for s in real_strips:
		if s['is_system_start']:
			seq_idx = 0
		if not s['name']:
			s['name'] = known[seq_idx % len(known)]
			seq_idx += 1
		else:
			pos = known.index(s['name']) if s['name'] in known else -1
			seq_idx = pos + 1 if pos != -1 else seq_idx + 1


def _resolve_strip_names_globally(all_real_strips: dict[int, list[dict]]) -> None:
	"""Fill empty strip names across ALL pages using a global known sequence.

	Scans pages in order to find the first page with a complete instrument
	sequence, then uses it to fill unnamed strips on every page. Falls back
	to per-page "Part N" numbering if no page has named strips.
	"""
	# Build global known sequence from the first page that has one
	known: list[str] = []
	for page_idx in sorted(all_real_strips.keys()):
		seq = _build_known_sequence(all_real_strips[page_idx])
		if seq:
			known = seq
			break

	if not known:
		# No named strips anywhere — fallback to generic names
		for real_strips in all_real_strips.values():
			for i, s in enumerate(real_strips):
				if not s['name']:
					s['name'] = f"Part {i + 1}"
		return

	# Apply global sequence to all pages
	for real_strips in all_real_strips.values():
		_fill_page_with_sequence(real_strips, known)


def _group_strips_by_system(real_strips: list[dict]) -> list[list[dict]]:
	"""Group a page's real strips into systems based on is_system_start flags."""
	systems: list[list[dict]] = []
	for strip in real_strips:
		if strip['is_system_start'] or not systems:
			systems.append([])
		systems[-1].append(strip)
	return systems


def _convert_rect_to_backend(rect: dict, scale: float, img_width: int, img_height: int) -> dict:
	"""Convert a display-pixel rect to backend-pixel rect, clamped to image bounds."""
	bx = min(max(round(rect['x'] / scale), 0), img_width)
	by = min(max(round(rect['y'] / scale), 0), img_height)
	bw = min(round(rect['w'] / scale), img_width - bx)
	bh = min(round(rect['h'] / scale), img_height - by)
	return {'x': bx, 'y': by, 'w': bw, 'h': bh}


@app.route('/api/scores/<score_id>/partition', methods=['POST'])
def partition_score(score_id: str):
	"""Accept raw user markings and create staves and parts.

	The frontend sends divider positions in display-pixel space along with
	system flags and strip names. The backend handles coordinate conversion,
	dead-space filtering, name resolution, and part deduplication.
	"""
	entry = _validate_score_id(score_id)
	score = entry["score"]

	data = request.get_json()
	if not data or 'pages' not in data:
		abort(400, description="Missing 'pages' in request body")

	display_width = data.get('display_width')
	if not display_width or display_width <= 0:
		abort(400, description="'display_width' must be a positive number")

	pages_data = data['pages']

	# --- Phase 1: Validate, convert coordinates, extract real strips ---
	all_real_strips: dict[int, list[dict]] = {}

	for page_key, page_data in pages_data.items():
		try:
			page_idx = int(page_key)
		except ValueError:
			abort(400, description=f"Invalid page key: {page_key}")

		if page_idx < 0 or page_idx >= len(score.pages):
			abort(400, description=f"Page {page_key} does not exist")

		page = score.pages[page_idx]
		img_height, img_width = page.img.shape[:2]
		scale = display_width / img_width

		dividers = page_data.get('dividers', [])
		system_flags = page_data.get('system_flags', [])
		strip_names = page_data.get('strip_names', [])

		if len(system_flags) != len(dividers):
			abort(400, description=f"Page {page_key}: system_flags length ({len(system_flags)}) != dividers length ({len(dividers)})")
		if len(dividers) > 0 and len(strip_names) != len(dividers) - 1:
			abort(400, description=f"Page {page_key}: strip_names length ({len(strip_names)}) != dividers-1 ({len(dividers) - 1})")

		# Convert display pixels → backend pixels, clamped to image bounds
		backend_dividers = [
			min(max(round(d / scale), 0), img_height) for d in dividers
		]

		# Extract real strips (skip dead-space gaps where next divider is a system divider)
		real_strips = []
		for j in range(len(backend_dividers) - 1):
			if system_flags[j + 1]:
				continue  # dead space: gap before a system divider
			y = backend_dividers[j]
			h = backend_dividers[j + 1] - y
			if h <= 0:
				continue
			name = strip_names[j].strip() if strip_names[j] else ""
			real_strips.append({
				'y': y,
				'h': h,
				'name': name,
				'is_system_start': bool(system_flags[j]),
			})

		all_real_strips[page_idx] = real_strips

	# --- Phase 2: Resolve empty strip names (cross-page auto-fill) ---
	_resolve_strip_names_globally(all_real_strips)

	# --- Phase 3: Deduplicate parts, create Staff/Part objects ---
	score.parts = []
	score.parts_dict = {}
	for page in score.pages:
		page.staves = []

	parts_list: list[Part] = []
	parts_dict: dict[str, Part] = {}

	try:
		for page_idx in sorted(all_real_strips.keys()):
			page = score.pages[page_idx]
			for strip in all_real_strips[page_idx]:
				name = sanitize_string(strip['name']) or f"Part {len(parts_list) + 1}"
				short_name = sanitize_string(name[:6])

				if name not in parts_dict:
					part = Part(name, short_name, [])
					parts_dict[name] = part
					parts_list.append(part)
				else:
					part = parts_dict[name]

				staff = Staff(
					name=name,
					short_name=short_name,
					y=strip['y'],
					h=strip['h'],
					page=page,
				)
				staff.source_page_width = page.img.shape[1]
				page.staves.append(staff)
				part.staves.append(staff)
	except StaffError as e:
		logger.exception("Staff creation failed during partition")
		abort(500, description="Staff creation failed")

	if not parts_list:
		abort(400, description="No strips found across all pages")

	# --- Phase 3b: Crop header image if provided ---
	header_data = data.get('header')
	if header_data:
		h_page = header_data.get('page', 0)
		if h_page < 0 or h_page >= len(score.pages):
			abort(400, description=f"Header page {h_page} does not exist")
		h_img = score.pages[h_page].img
		h_height, h_width = h_img.shape[:2]
		h_scale = display_width / h_width
		br = _convert_rect_to_backend(header_data, h_scale, h_width, h_height)
		if br['w'] > 0 and br['h'] > 0:
			header_crop = h_img[br['y']:br['y'] + br['h'], br['x']:br['x'] + br['w']].copy()
			for part in parts_list:
				part.header_img = header_crop
				part.header_source_width = h_width

	# --- Phase 3c: Attach score markings (tempo, etc.) to staves ---
	markings_data = data.get('markings', [])
	for ann_rect in markings_data:
		ann_page_idx = ann_rect.get('page', 0)
		if ann_page_idx < 0 or ann_page_idx >= len(score.pages):
			continue
		page = score.pages[ann_page_idx]
		ann_img = page.img
		ann_h, ann_w = ann_img.shape[:2]
		ann_scale = display_width / ann_w

		br = _convert_rect_to_backend(ann_rect, ann_scale, ann_w, ann_h)
		if br['w'] <= 0 or br['h'] <= 0:
			continue
		crop = ann_img[br['y']:br['y'] + br['h'], br['x']:br['x'] + br['w']].copy()

		# Find which system this marking belongs to
		if ann_page_idx not in all_real_strips:
			continue
		systems = _group_strips_by_system(all_real_strips[ann_page_idx])
		ann_y_center = br['y'] + br['h'] // 2

		target_system = None
		for system in systems:
			sys_bottom = system[-1]['y'] + system[-1]['h']
			if ann_y_center <= sys_bottom:
				target_system = system
				break
		if target_system is None:
			target_system = systems[-1] if systems else None
		if target_system is None:
			continue

		first_strip = target_system[0]
		inside_first = (
			br['y'] >= first_strip['y']
			and br['y'] + br['h'] <= first_strip['y'] + first_strip['h']
		)
		y_offset = br['y'] - first_strip['y']

		# Attach to every staff in this system
		first_strip_id = id(first_strip)
		sys_strip_set = {id(s) for s in target_system}
		strip_idx = 0
		for staff in page.staves:
			if strip_idx < len(all_real_strips[ann_page_idx]):
				strip = all_real_strips[ann_page_idx][strip_idx]
				if id(strip) in sys_strip_set:
					staff.markings.append({
						'img': crop,
						'x_pos': br['x'],
						'y_offset': y_offset,
						'inside_first': inside_first,
						'is_first_in_system': id(strip) == first_strip_id,
					})
				strip_idx += 1

	# --- Phase 4: Compute preview metadata (no rendering yet) ---
	score.parts = parts_list
	score.parts_dict = parts_dict

	preview_parts = []
	try:
		for part in parts_list:
			if part.staves:
				preview_parts.append(part.preview_metadata())
	except PartError as e:
		logger.exception("Preview metadata computation failed")
		abort(500, description="Preview metadata computation failed")

	return jsonify({"parts": preview_parts})


@app.route('/api/scores/<score_id>/staves/<part_name>/<int:stave_index>', methods=['GET'])
def serve_stave_image(score_id: str, part_name: str, stave_index: int):
	"""Serve a single stave image (scaled to the part's output width) as PNG."""
	entry = _validate_score_id(score_id)
	score = entry["score"]

	part_name = sanitize_string(part_name)
	if not part_name:
		abort(400, description="Invalid part name")

	if not score.parts_dict:
		abort(404, description="No parts available. Run partition first.")

	part = score.parts_dict.get(part_name)
	if not part:
		abort(404, description=f"Part '{part_name}' not found")

	if stave_index < 0 or stave_index >= len(part.staves):
		abort(404, description=f"Stave index {stave_index} out of range")

	# Ensure layout has been computed (preview_metadata sets this up)
	if not hasattr(part, 'available_width') or part.available_width == 0:
		part.dpi = 300
		if part.staves:
			part.width = max(s.img.shape[1] for s in part.staves)
		part._layout(dpi=part.dpi)

	staff = part.staves[stave_index]
	scaled = part._adapt_staff(staff)

	success, buf = cv2.imencode('.png', scaled)
	if not success:
		logger.error("Failed to encode stave image for part '%s', index %d", part_name, stave_index)
		abort(500, description="Failed to encode stave image")

	return send_file(io.BytesIO(buf.tobytes()), mimetype='image/png')


@app.route('/api/scores/<score_id>/generate', methods=['POST'])
def generate_parts(score_id: str):
	"""Render parts into output pages using per-part layout adjustments.

	Expects JSON:
	{
	  "parts": {
	    "Violin I": {
	      "spacing_mm": 10,
	      "offsets": [0, 0, 15, 0, -10, 0, 0, 0],
	      "page_breaks_after": [3]
	    }
	  }
	}
	"""
	entry = _validate_score_id(score_id)
	score = entry["score"]

	if not score.parts_dict:
		abort(400, description="No parts created yet. Run partition first.")

	data = request.get_json()
	if not data or 'parts' not in data:
		abort(400, description="Missing 'parts' in request body")

	parts_config = data['parts']

	try:
		for part in score.parts:
			part.pages = []  # reset any previous render
			cfg = parts_config.get(part.name, {})

			spacing_mm = cfg.get('spacing_mm')
			if spacing_mm is not None:
				if not (2 <= spacing_mm <= 30):
					abort(400, description=f"spacing_mm must be 2–30 for '{part.name}'")
				part._custom_spacing_mm = spacing_mm

			offsets = cfg.get('offsets')
			if offsets is not None:
				if len(offsets) != len(part.staves):
					abort(400, description=(
						f"offsets length ({len(offsets)}) != stave count "
						f"({len(part.staves)}) for '{part.name}'"
					))
			page_breaks_after = cfg.get('page_breaks_after')

			if part.staves:
				part.process(offsets=offsets, page_breaks_after=page_breaks_after)
	except PartError as e:
		logger.exception("Part processing failed during generate")
		abort(500, description="Part processing failed")

	return jsonify({
		"parts": [
			{
				"name": p.name,
				"short_name": p.short_name,
				"page_count": len(p.pages),
				"staves_count": len(p.staves),
			}
			for p in score.parts
		]
	})


@app.route('/api/scores/<score_id>/parts/<part_name>', methods=['GET'])
def download_part(score_id: str, part_name: str):
	"""Serve a generated part as a PDF composed from the output page images."""
	entry = _validate_score_id(score_id)
	score = entry["score"]

	part_name = sanitize_string(part_name)
	if not part_name:
		abort(400, description="Invalid part name")

	if not score.parts_dict:
		abort(404, description="No parts generated yet. Run partition first.")

	part = score.parts_dict.get(part_name)
	if not part:
		abort(404, description=f"Part '{part_name}' not found")

	if not part.pages:
		abort(404, description=f"Part '{part_name}' has no output pages")

	# Build a PDF from the part's output page images using PyMuPDF
	pdf_doc = fitz.open()
	for page_img in part.pages:
		success, jpg_buf = cv2.imencode('.jpg', page_img, [cv2.IMWRITE_JPEG_QUALITY, 92])
		if not success:
			logger.error("Failed to encode page image for part '%s'", part_name)
			abort(500, description="Failed to encode page image")

		img_bytes = jpg_buf.tobytes()
		# Create a page matching the image dimensions (in points: 72 DPI)
		h_px, w_px = page_img.shape[:2]
		w_pt = w_px * 72 / part.dpi
		h_pt = h_px * 72 / part.dpi
		pdf_page = pdf_doc.new_page(width=w_pt, height=h_pt)
		pdf_page.insert_image(fitz.Rect(0, 0, w_pt, h_pt), stream=img_bytes)

	pdf_bytes = pdf_doc.tobytes()
	pdf_doc.close()

	return send_file(
		io.BytesIO(pdf_bytes),
		mimetype='application/pdf',
		as_attachment=True,
		download_name=f"{part_name}.pdf"
	)


if __name__ == '__main__':
	os.makedirs(TMP_DIR, exist_ok=True)
	app.run(debug=os.getenv('FLASK_DEBUG', 'true').lower() == 'true', port=5000) # TODO: change to false in production

	
