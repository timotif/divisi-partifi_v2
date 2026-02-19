import { Trash2, X } from 'lucide-react';

const ScoreCanvas = ({
  pageWidth,
  pageHeight,
  pageImageUrl,
  currentPage,
  dividers,
  systemDividers,
  strips,
  stripNames,
  onRemoveDivider,
  onDividerMouseDown,
  onContainerClick,
  onRectMouseDown,
  rectPreview,
  isSelectingHeader,
  headerRegion,
  onClearHeader,
  markings,
  onRemoveMarking,
  containerRef,
  isRectSelecting,
  isDetecting,
  detectionWarning,
}) => {
  return (
    <div className="border border-surface-border rounded-md overflow-hidden" style={{ width: pageWidth, flexShrink: 0 }}>
      <div
        ref={containerRef}
        className={`relative bg-white select-none ${isRectSelecting ? 'cursor-crosshair' : 'cursor-default'}`}
        style={{ width: pageWidth, height: pageHeight }}
        onClick={onContainerClick}
        onMouseDown={onRectMouseDown}
      >
        {/* Real page image from backend */}
        {pageImageUrl && (
          <img
            src={pageImageUrl}
            alt={`Page ${currentPage + 1}`}
            style={{ width: pageWidth, height: pageHeight }}
            className="absolute inset-0"
            draggable={false}
          />
        )}

        {/* Dead zone overlays: above first, below last, and between systems */}
        {dividers.length >= 2 && (() => {
          const zones = [];
          zones.push({ top: 0, height: dividers[0] });
          const last = dividers[dividers.length - 1];
          zones.push({ top: last, height: pageHeight - last });
          for (let j = 0; j < dividers.length - 1; j++) {
            if (systemDividers[j + 1]) {
              zones.push({
                top: dividers[j],
                height: dividers[j + 1] - dividers[j],
              });
            }
          }
          return zones.filter(z => z.height > 0).map((zone, i) => (
            <div
              key={`dead-${i}`}
              className="absolute bg-gray-500/30 z-5"
              style={{ top: zone.top, left: 0, width: '100%', height: zone.height }}
            />
          ));
        })()}

        {/* Strip visualization */}
        {strips.map((strip, index) => {
          // Compute per-system part number (resets at each system divider)
          let num = 0;
          for (let k = 0; k <= index; k++) {
            if (strips[k].isSystemStart) num = 0;
            num++;
          }
          return (
          <div
            key={index}
            className="absolute border border-dashed border-accent/40 bg-accent/5 group hover:bg-accent/10 transition-colors"
            style={{
              top: strip.start,
              left: 0,
              width: '100%',
              height: strip.height
            }}
          >
            <div className="absolute top-1 left-2 bg-accent/70 text-white px-2 py-0.5 rounded text-xs">
              {stripNames[index] || `Part ${num}`}
            </div>
            <div className="absolute top-2 right-2 bg-black/40 text-white px-2 py-1 rounded text-xs opacity-0 group-hover:opacity-100 transition-opacity">
              {strip.height}px tall
            </div>
          </div>
          );
        })}

        {/* Draggable dividers */}
        {dividers.map((y, index) => {
          const isSystem = !!systemDividers[index];
          return (
          <div key={index}>
            {/* Divider line */}
            <div
              className={`absolute w-full z-10 ${
                isSystem ? 'border-t-[3px] border-system' : 'border-t-2 border-accent'
              }`}
              style={{ top: y }}
            />

            {/* Draggable handle */}
            <div
              className={`absolute w-4 h-4 rounded-full cursor-ns-resize z-20 flex items-center justify-center transition-colors shadow-sm ${
                isSystem
                  ? 'bg-system hover:bg-system/80'
                  : 'bg-accent hover:bg-accent/80'
              }`}
              style={{
                top: y - 8,
                left: pageWidth - 20
              }}
              onMouseDown={(e) => onDividerMouseDown(e, index)}
              onClick={(e) => e.stopPropagation()}
              title={isSystem ? 'System divider — drag to adjust' : 'Drag to adjust strip boundary'}
            >
              {isSystem
                ? <div className="w-2 h-0.5 bg-white" />
                : <div className="w-1 h-1 bg-white rounded-full" />
              }
            </div>

            {/* Remove button */}
            <button
              className="absolute w-4 h-4 bg-gray-400 rounded-full cursor-pointer z-20 flex items-center justify-center hover:bg-danger transition-colors text-white"
              style={{
                top: y - 8,
                left: pageWidth - 36
              }}
              onClick={(e) => { e.stopPropagation(); onRemoveDivider(index); }}
              title="Remove this divider"
            >
              <Trash2 className="w-2 h-2" />
            </button>
          </div>
          );
        })}

        {/* Rectangle selection preview (while dragging) */}
        {rectPreview && rectPreview.w > 0 && rectPreview.h > 0 && (
          <div
            className={`absolute border-2 border-dashed bg-opacity-30 z-30 pointer-events-none ${
              isSelectingHeader ? 'border-success bg-success/20' : 'border-warning bg-warning/20'
            }`}
            style={{
              left: rectPreview.x,
              top: rectPreview.y,
              width: rectPreview.w,
              height: rectPreview.h,
            }}
          />
        )}

        {/* Header region overlay (finalized) */}
        {headerRegion && currentPage === headerRegion.page && (
          <div
            className="absolute border-2 border-success bg-success/20 z-30"
            style={{
              left: headerRegion.x,
              top: headerRegion.y,
              width: headerRegion.w,
              height: headerRegion.h,
            }}
          >
            <button
              className="absolute top-1 right-1 w-5 h-5 bg-gray-400 rounded-full flex items-center justify-center hover:bg-danger transition-colors text-white z-40"
              onClick={(e) => { e.stopPropagation(); onClearHeader(); }}
              title="Clear header"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Marking overlays (finalized) */}
        {markings.map((tm, idx) => tm.page === currentPage && (
          <div
            key={`tempo-${idx}`}
            className="absolute border-2 border-warning bg-warning/20 z-30"
            style={{
              left: tm.x,
              top: tm.y,
              width: tm.w,
              height: tm.h,
            }}
          >
            <button
              className="absolute top-1 right-1 w-5 h-5 bg-gray-400 rounded-full flex items-center justify-center hover:bg-danger transition-colors text-white z-40"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveMarking(idx);
              }}
              title="Remove marking"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}

        {/* Detection loading overlay */}
        {isDetecting && (
          <div className="absolute inset-0 bg-white/50 z-40 flex items-center justify-center pointer-events-none">
            <div className="bg-white/90 rounded-lg px-4 py-3 shadow-sm flex items-center gap-3">
              <svg className="animate-spin h-5 w-5 text-accent" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm text-gray-600">Detecting staves...</span>
            </div>
          </div>
        )}

        {/* Detection warning banner */}
        {detectionWarning && !isDetecting && (
          <div className="absolute top-2 left-2 right-2 z-40 bg-yellow-50 border border-yellow-200 rounded-md px-3 py-2 text-xs text-yellow-700 pointer-events-none">
            {detectionWarning}
          </div>
        )}
      </div>
    </div>
  );
};

export default ScoreCanvas;
