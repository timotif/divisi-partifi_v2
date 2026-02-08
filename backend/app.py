import os
import io
import uuid
import cv2
import pymupdf as fitz
from flask import Flask, request, jsonify, send_file, abort
from flask_cors import CORS
from analyzer import (
	Score, Page, Staff, Part, TMP_DIR,
	sanitize_string, PageError, StaffError, PartError
)

app = Flask(__name__)
CORS(app)

MAX_UPLOAD_SIZE_MB = 50
app.config['MAX_CONTENT_LENGTH'] = MAX_UPLOAD_SIZE_MB * 1024 * 1024

# In-memory session store: score_id -> { 'score': Score, 'metadata': dict }
scores: dict[str, dict] = {}


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
	"""Validate UUID format and look up score. Aborts with 400/404 on failure."""
	try:
		uuid.UUID(score_id)
	except ValueError:
		abort(400, description="Invalid score ID format")
	entry = scores.get(score_id)
	if not entry:
		abort(404, description="Score not found")
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
		if os.path.exists(pdf_path):
			os.remove(pdf_path)
		abort(500, description=f"Failed to process PDF: {e}")

	pages_meta = []
	for i, page in enumerate(score.pages):
		h, w = page.img.shape[:2]
		pages_meta.append({"page_num": i, "width": w, "height": h})

	scores[score_id] = {
		"score": score,
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
		abort(500, description=str(e))

	return send_file(io.BytesIO(png_bytes), mimetype='image/png')


def _resolve_strip_names(real_strips: list[dict]) -> None:
	"""Fill empty strip names by cycling the known instrument sequence.

	Mutates strip dicts in-place. The known sequence is built from
	consecutive unique non-empty names starting at strip 0, stopping at the
	first repeat, empty name, or system divider boundary. The cycle resets
	at each system divider.

	Mirrors the frontend autoFillStripNames logic so the backend can serve
	as the authoritative fallback for any unnamed strips.
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

	if not known:
		for i, s in enumerate(real_strips):
			if not s['name']:
				s['name'] = f"Part {i + 1}"
		return

	seq_idx = -1
	for s in real_strips:
		if s['is_system_start']:
			seq_idx = -1
		seq_idx += 1
		if not s['name']:
			s['name'] = known[seq_idx % len(known)]


@app.route('/api/scores/<score_id>/partition', methods=['POST'])
def partition_score(score_id: str):
	"""Accept raw user annotations and create staves and parts.

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

	# --- Phase 2: Resolve empty strip names (auto-fill fallback) ---
	for real_strips in all_real_strips.values():
		_resolve_strip_names(real_strips)

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
				page.staves.append(staff)
				part.staves.append(staff)
	except StaffError as e:
		abort(500, description=f"Staff creation failed: {e}")

	if not parts_list:
		abort(400, description="No strips found across all pages")

	# --- Phase 4: Process each part (layout onto output pages) ---
	try:
		for part in parts_list:
			if part.staves:
				part.process()
	except PartError as e:
		abort(500, description=f"Part processing failed: {e}")

	score.parts = parts_list
	score.parts_dict = parts_dict

	return jsonify({
		"parts": [
			{
				"name": p.name,
				"short_name": p.short_name,
				"page_count": len(p.pages),
				"staves_count": len(p.staves),
			}
			for p in parts_list
		]
	})


@app.route('/api/scores/<score_id>/parts/<part_name>', methods=['GET'])
def download_part(score_id: str, part_name: str):
	"""Serve a generated part as a PDF composed from the output page images."""
	entry = _validate_score_id(score_id)
	score = entry["score"]

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
		success, png_buf = cv2.imencode('.png', page_img)
		if not success:
			abort(500, description=f"Failed to encode page image for part '{part_name}'")

		# Insert the PNG as a new page in the PDF
		img_doc = fitz.open(stream=png_buf.tobytes(), filetype="png")
		# Create a page matching the image dimensions (in points: 72 DPI)
		# Part.process() uses dpi=100, so convert from 100 DPI pixels to 72 DPI points
		h_px, w_px = page_img.shape[:2]
		w_pt = w_px * 72 / 100
		h_pt = h_px * 72 / 100
		pdf_page = pdf_doc.new_page(width=w_pt, height=h_pt)
		pdf_page.insert_image(fitz.Rect(0, 0, w_pt, h_pt), stream=png_buf.tobytes())
		img_doc.close()

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
	app.run(debug=True, port=5000)
