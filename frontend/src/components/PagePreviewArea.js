import { useState, useCallback, useEffect, useRef } from 'react';

// Display width for preview pages.
const PREVIEW_PAGE_WIDTH = 520;

function paginateStaves(partMeta, spacingPx, offsets, pageBreaksAfter) {
  const { layout, staves } = partMeta;

  // --- Pass 1: assign staves to pages ---
  const pageAssignments = [[]];
  let yPos = layout.title_area_px;

  for (let i = 0; i < staves.length; i++) {
    const totalH = staves[i].scaled_height + staves[i].markings_overhead_px;
    const gap = pageAssignments[pageAssignments.length - 1].length > 0
      ? spacingPx + (offsets[i] || 0)
      : 0;

    // Natural page break: stave doesn't fit
    if (
      yPos + gap + totalH > layout.available_height_px &&
      pageAssignments[pageAssignments.length - 1].length > 0
    ) {
      pageAssignments.push([]);
      yPos = 0;
    }

    yPos += pageAssignments[pageAssignments.length - 1].length > 0
      ? spacingPx + (offsets[i] || 0)
      : 0;
    pageAssignments[pageAssignments.length - 1].push(i);
    yPos += totalH;

    // Forced page break after this stave
    if (pageBreaksAfter.has(i) && i < staves.length - 1) {
      pageAssignments.push([]);
      yPos = 0;
    }
  }

  // --- Pass 2: compute y-positions, justify forced-break pages ---
  const pages = [];
  for (let p = 0; p < pageAssignments.length; p++) {
    const indices = pageAssignments[p];
    if (indices.length === 0) continue;

    const isFirst = p === 0;
    const startY = isFirst ? layout.title_area_px : 0;
    const hasForcedBreak = indices.some(i => pageBreaksAfter.has(i));

    const totalStaveH = indices.reduce(
      (sum, i) => sum + staves[i].scaled_height + staves[i].markings_overhead_px,
      0
    );
    const numGaps = indices.length - 1;
    const remainingSpace = layout.available_height_px - startY - totalStaveH;

    let justifiedGap = spacingPx;
    if (hasForcedBreak && numGaps > 0 && remainingSpace > numGaps * spacingPx) {
      justifiedGap = remainingSpace / numGaps;
    }

    let y = startY;
    const pageStaves = [];
    for (let j = 0; j < indices.length; j++) {
      const i = indices[j];
      if (j > 0) {
        y += hasForcedBreak ? justifiedGap : spacingPx + (offsets[i] || 0);
      }
      pageStaves.push({
        ...staves[i],
        yPosition: y,
        pageIndex: p,
        staveIndex: i,
      });
      y += staves[i].scaled_height + staves[i].markings_overhead_px;
    }

    // Track whether this page ends with a forced break
    const lastStaveIdx = indices[indices.length - 1];
    const endsWithForcedBreak = pageBreaksAfter.has(lastStaveIdx);
    pages.push({ staves: pageStaves, hasForcedBreak, endsWithForcedBreak, breakAfterStaveIndex: lastStaveIdx });
  }
  return pages;
}

const PagePreviewArea = ({
  scoreId,
  partMeta,
  spacingPx,
  offsets,
  pageBreaksAfter,
  onOffsetsChange,
  onPageBreaksChange,
}) => {
  const pages = paginateStaves(partMeta, spacingPx, offsets, pageBreaksAfter);

  // Scale: map backend available_height to a display page height preserving A4 ratio
  const pageDisplayHeight = Math.round(PREVIEW_PAGE_WIDTH * 1.414);
  const backendPageHeight = partMeta.layout.available_height_px;
  const scale = pageDisplayHeight / (backendPageHeight || 1);

  const [dragState, setDragState] = useState(null);
  const containerRef = useRef(null);

  const handleStaveMouseDown = useCallback((e, staveIndex) => {
    e.preventDefault();
    setDragState({
      staveIndex,
      startY: e.clientY,
      startOffset: offsets[staveIndex] || 0,
    });
  }, [offsets]);

  const handleMouseMove = useCallback((e) => {
    if (!dragState) return;
    const deltaDisplay = e.clientY - dragState.startY;
    const deltaPx = Math.round(deltaDisplay / scale);
    const newOffsets = [...offsets];
    newOffsets[dragState.staveIndex] = dragState.startOffset + deltaPx;
    onOffsetsChange(newOffsets);
  }, [dragState, offsets, onOffsetsChange, scale]);

  const handleMouseUp = useCallback(() => {
    setDragState(null);
  }, []);

  useEffect(() => {
    if (dragState) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [dragState, handleMouseMove, handleMouseUp]);

  const togglePageBreak = (staveIndex) => {
    const next = new Set(pageBreaksAfter);
    if (next.has(staveIndex)) {
      next.delete(staveIndex);
    } else {
      next.add(staveIndex);
    }
    onPageBreaksChange(next);
  };

  // Build stave image URL
  const staveImgUrl = (staveIndex) =>
    `/api/scores/${scoreId}/staves/${encodeURIComponent(partMeta.name)}/${staveIndex}`;

  return (
    <div ref={containerRef} className="flex flex-col items-center gap-2 pb-4">
      {pages.map((page, pIdx) => (
        <div key={pIdx} className="flex-shrink-0">
          {/* Page number */}
          <div className="text-center text-xs text-gray-400 mb-1">Page {pIdx + 1}</div>
          {/* Page container */}
          <div
            className="bg-white border border-gray-300 rounded shadow-sm relative overflow-hidden"
            style={{ width: PREVIEW_PAGE_WIDTH, height: pageDisplayHeight }}
          >
            {/* Header area on first page */}
            {pIdx === 0 && partMeta.header && (
              <div
                className="absolute left-0 right-0 bg-gray-50 border-b border-dashed border-gray-300 flex items-center justify-center text-xs text-gray-400"
                style={{
                  top: 0,
                  height: Math.round(partMeta.header.scaled_height * scale),
                }}
              >
                Header
              </div>
            )}

            {/* Staves */}
            {page.staves.map((stave, j) => {
              const top = Math.round(stave.yPosition * scale);
              const imgHeight = Math.max(4, Math.round(stave.scaled_height * scale));
              const totalHeight = Math.max(
                4,
                Math.round((stave.scaled_height + stave.markings_overhead_px) * scale)
              );
              const isLast = j === page.staves.length - 1;
              const hasBreakAfter = pageBreaksAfter.has(stave.staveIndex);
              const isDragging = dragState?.staveIndex === stave.staveIndex;

              return (
                <div key={stave.staveIndex}>
                  {/* Draggable stave — shows the actual image */}
                  <div
                    className={`absolute left-1 right-1 select-none transition-shadow ${
                      isDragging
                        ? 'ring-2 ring-accent/60 shadow-md cursor-grabbing z-10'
                        : 'cursor-grab hover:ring-1 hover:ring-accent/30'
                    }`}
                    style={{ top, height: totalHeight }}
                    onMouseDown={(e) => handleStaveMouseDown(e, stave.staveIndex)}
                  >
                    <img
                      src={staveImgUrl(stave.staveIndex)}
                      alt={`Staff ${stave.staveIndex + 1}`}
                      className="w-full pointer-events-none"
                      style={{ height: imgHeight, objectFit: 'contain' }}
                      draggable={false}
                    />
                    {/* Source page label */}
                    <span className="absolute top-0 right-1 text-[9px] text-gray-400 bg-white/80 px-0.5 rounded-sm">
                      p.{stave.source_page + 1}
                    </span>
                  </div>

                  {/* Clickable gap between staves for page breaks (only between staves on the same page) */}
                  {!isLast && !hasBreakAfter && (
                    <div
                      className="absolute left-0 right-0 group cursor-pointer"
                      style={{
                        top: top + totalHeight,
                        height: Math.max(
                          8,
                          Math.round(
                            (page.staves[j + 1].yPosition - stave.yPosition - stave.scaled_height - stave.markings_overhead_px) * scale
                          )
                        ),
                      }}
                      onClick={() => togglePageBreak(stave.staveIndex)}
                      title="Add page break here"
                    >
                      <div className="absolute inset-x-3 top-1/2 -translate-y-0.5 h-px bg-transparent group-hover:bg-accent/40 transition-colors" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Page break indicator — rendered BETWEEN page cards, never clipped */}
          {page.endsWithForcedBreak && (
            <div
              className="flex items-center gap-1.5 cursor-pointer py-1.5 mx-2"
              onClick={() => togglePageBreak(page.breakAfterStaveIndex)}
              title="Click to remove page break"
            >
              <div className="flex-1 border-t-2 border-dashed border-danger" />
              <span className="text-[10px] text-danger font-medium whitespace-nowrap">page break</span>
              <div className="flex-1 border-t-2 border-dashed border-danger" />
            </div>
          )}
        </div>
      ))}

      {pages.length === 0 && (
        <div className="text-gray-400 text-sm py-12">No staves to display.</div>
      )}
    </div>
  );
};

export default PagePreviewArea;
