"""Divider placement: turning detected staves into cut positions.

Pure image analysis -- no Flask, no session state.  Given the systems and
horizontal projection produced by ``detection.projection.detect_staves``,
these functions decide where to cut the page so each staff lands on its own
strip.

The core question is where inside a gap to cut.  Cutting on the geometric
midpoint is naive: at 300 DPI a typical inter-stave gap still contains stems,
slurs and ledger lines, and the midpoint frequently lands on one.  Instead we
take the row of *least* ink in the gap, breaking ties toward the ideal
position so cuts stay visually centred.
"""

import numpy as np

# Ink threshold: a cut is reported as "clean" when its row has at most this
# many ink pixels.  At 300 DPI ~5 pixels is a couple of stray noise dots --
# well below any real printed element (staff lines, noteheads and slurs all
# produce dozens to hundreds of ink pixels per row).
#
# Note this threshold no longer decides *where* to cut -- only whether the
# resulting cut is clean enough to keep quiet about.  Most real gaps contain
# no row this empty, so treating it as a placement requirement (as an earlier
# version did) meant most dividers silently fell back to the midpoint.
_SNAP_INK_THRESHOLD = 5


def _snap_to_clear_row(
	row_start: int,
	row_end: int,
	ideal_y: int,
	projection: np.ndarray,
) -> tuple[int, bool]:
	"""Pick the least-inked row strictly inside (row_start, row_end).

	Ties are broken toward ``ideal_y``, so on an evenly blank gap the result
	is the caller's preferred position and cuts stay where they look right.

	Args:
		row_start: exclusive lower bound (last row of stave above).
		row_end:   exclusive upper bound (first row of stave below).
		ideal_y:   preferred position, used to break ties.
		projection: 1-D ink-count array from horizontal_projection().

	Returns:
		(y, clean) -- the chosen row, and whether its ink is at or below
		``_SNAP_INK_THRESHOLD``.  ``clean`` reports cut *quality*, not
		whether a row was found; a dense gap still yields its best row.
	"""
	# Degenerate or inverted bounds leave no interior rows to choose from.
	if row_end - row_start < 2:
		return ideal_y, False

	gap = projection[row_start + 1:row_end]
	min_ink = gap.min()

	# Candidates all share the minimum ink; prefer the one nearest ideal_y.
	candidates = np.flatnonzero(gap <= min_ink) + row_start + 1
	best = int(candidates[np.argmin(np.abs(candidates - ideal_y))])

	return best, bool(min_ink <= _SNAP_INK_THRESHOLD)


def find_divider_y(
	stave_above: np.ndarray,
	stave_below: np.ndarray,
	projection: np.ndarray | None = None,
) -> tuple[int, bool]:
	"""Find the Y position for a divider between two adjacent staves.

	Uses the midpoint between the bottom staff line of stave_above and the
	top staff line of stave_below as the ideal, then delegates to
	_snap_to_clear_row to land on the least-inked row in the gap.

	Args:
		stave_above: array of Y values for the upper stave's staff lines.
		stave_below: array of Y values for the lower stave's staff lines.
		projection:  1-D ink-count array from horizontal_projection().
		             When None the function falls back to the plain midpoint.

	Returns:
		(y, clean) -- Y position in backend pixels, and whether the cut is
		genuinely clean (False means the best available row still crosses
		printed content, which the frontend surfaces as an amber warning).
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

	All divider types (system, between-stave, bottom boundary) are snapped
	to the least-inked row in their respective gap via _snap_to_clear_row.

	Args:
		systems: list of systems, each a list of staves (each stave is an
			array of 5 Y pixel positions).
		img_height: page image height in pixels.
		projection: 1-D ink-count array (optional).  When supplied, enables
			least-ink snapping for all dividers.

	Returns:
		(dividers, system_flags, snap_flags) -- three parallel same-length
		lists sorted by Y.  snap_flags[i] is True when divider i sits on a
		genuinely clean row, False when the best available row still crosses
		printed content.
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
