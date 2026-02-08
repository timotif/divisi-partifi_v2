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
}) => {
  return (
    <div className="border-2 border-gray-200 rounded-lg overflow-hidden" style={{ width: pageWidth }}>
      <div
        ref={containerRef}
        className={`relative bg-white select-none ${isRectSelecting ? 'cursor-crosshair' : 'cursor-crosshair'}`}
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
          // Above first divider
          zones.push({ top: 0, height: dividers[0] });
          // Below last divider
          const last = dividers[dividers.length - 1];
          zones.push({ top: last, height: pageHeight - last });
          // Between systems: gap from a part divider to the next system divider
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
              className="absolute bg-gray-500 bg-opacity-30 z-5"
              style={{ top: zone.top, left: 0, width: '100%', height: zone.height }}
            />
          ));
        })()}

        {/* Strip visualization */}
        {strips.map((strip, index) => (
          <div
            key={index}
            className="absolute border-2 border-dashed border-blue-400 bg-blue-50 bg-opacity-20 group hover:bg-opacity-30 transition-colors"
            style={{
              top: strip.start,
              left: 0,
              width: '100%',
              height: strip.height
            }}
          >
            <div className="absolute top-1 left-2 bg-blue-600 text-white px-2 py-0.5 rounded text-xs opacity-70">
              {stripNames[index] || `Strip ${index + 1}`}
            </div>
            <div className="absolute top-2 right-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-xs opacity-0 group-hover:opacity-100 transition-opacity">
              {strip.height}px tall
            </div>
          </div>
        ))}

        {/* Draggable dividers */}
        {dividers.map((y, index) => {
          const isSystem = !!systemDividers[index];
          const lineClass = isSystem
            ? 'absolute w-full border-t-4 border-red-600 z-10'
            : 'absolute w-full border-t-2 border-blue-500 z-10';
          const handleClass = isSystem
            ? 'absolute w-8 h-8 bg-red-600 rounded-full cursor-ns-resize z-20 flex items-center justify-center hover:bg-red-700 transition-colors shadow-lg'
            : 'absolute w-8 h-8 bg-blue-500 rounded-full cursor-ns-resize z-20 flex items-center justify-center hover:bg-blue-600 transition-colors shadow-lg';
          const removeClass = isSystem
            ? 'absolute w-6 h-6 bg-red-600 rounded-full cursor-pointer z-20 flex items-center justify-center hover:bg-red-700 transition-colors text-white'
            : 'absolute w-6 h-6 bg-blue-500 rounded-full cursor-pointer z-20 flex items-center justify-center hover:bg-blue-600 transition-colors text-white';
          return (
          <div key={index}>
            {/* Divider line */}
            <div
              className={lineClass}
              style={{ top: y }}
            />

            {/* Draggable handle */}
            <div
              className={handleClass}
              style={{
                top: y - 16,
                left: pageWidth - 32
              }}
              onMouseDown={(e) => onDividerMouseDown(e, index)}
              onClick={(e) => e.stopPropagation()}
              title={isSystem ? 'System divider — drag to adjust' : 'Drag to adjust strip boundary'}
            >
              {isSystem
                ? <div className="w-4 h-0.5 bg-white" />
                : <div className="w-2 h-2 bg-white rounded-full" />
              }
            </div>

            {/* Remove button */}
            <button
              className={removeClass}
              style={{
                top: y - 12,
                left: pageWidth - 52
              }}
              onClick={(e) => { e.stopPropagation(); onRemoveDivider(index); }}
              title="Remove this divider"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
          );
        })}

        {/* Rectangle selection preview (while dragging) */}
        {rectPreview && rectPreview.w > 0 && rectPreview.h > 0 && (
          <div
            className={`absolute border-2 border-dashed bg-opacity-30 z-30 pointer-events-none ${
              isSelectingHeader ? 'border-green-500 bg-green-200' : 'border-amber-500 bg-amber-200'
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
            className="absolute border-2 border-green-600 bg-green-200 bg-opacity-30 z-30"
            style={{
              left: headerRegion.x,
              top: headerRegion.y,
              width: headerRegion.w,
              height: headerRegion.h,
            }}
          >
            <div className="absolute top-1 left-2 bg-green-700 text-white px-2 py-0.5 rounded text-xs">
              Header
            </div>
            <button
              className="absolute top-1 right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center hover:bg-red-600 transition-colors text-white z-40"
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
            className="absolute border-2 border-amber-500 bg-amber-200 bg-opacity-30 z-30"
            style={{
              left: tm.x,
              top: tm.y,
              width: tm.w,
              height: tm.h,
            }}
          >
            <div className="absolute top-1 left-2 bg-amber-600 text-white px-2 py-0.5 rounded text-xs">
              Marking
            </div>
            <button
              className="absolute top-1 right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center hover:bg-red-600 transition-colors text-white z-40"
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
      </div>
    </div>
  );
};

export default ScoreCanvas;
