import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { pageWindow, parsePageInput } from '../utils/pageWindow';

const PageNavigation = ({ currentPage, pageCount, confirmedPages, detectedPages, onGoToPage, isPageInRange }) => {
  // Hooks must run unconditionally, so this sits above the early return.
  const [jumpValue, setJumpValue] = useState('');

  // Keep the jump box showing where we actually are when the page changes
  // by any other route (chevrons, dots, keyboard).
  useEffect(() => { setJumpValue(String(currentPage + 1)); }, [currentPage]);

  if (pageCount <= 1) return null;

  // When no range predicate is supplied, treat every page as in-range.
  const inRange = isPageInRange || (() => true);

  // Long scores render a window of dots rather than one per page: several
  // hundred dots overflow the row and push the chevrons off-screen.
  const dots = pageWindow(pageCount, currentPage);

  const commitJump = () => {
    const target = parsePageInput(jumpValue, pageCount);
    if (target === null) setJumpValue(String(currentPage + 1)); // revert
    else onGoToPage(target);
  };

  return (
    <div className="mt-4 flex items-center justify-center gap-4">
      <button
        onClick={() => onGoToPage(currentPage - 1)}
        disabled={currentPage === 0}
        className="p-1.5 rounded-md bg-gray-100 hover:bg-gray-200 disabled:opacity-30 transition-colors flex-shrink-0"
      >
        <ChevronLeft className="w-4 h-4 text-gray-600" />
      </button>

      {/* Page dots — windowed, and allowed to shrink before the controls do */}
      <div className="flex items-center justify-center gap-1.5 flex-wrap min-w-0">
        {dots.map((page, i) => {
          if (page === null) {
            return (
              <span key={`gap-${i}`} className="text-gray-300 text-xs leading-none select-none px-0.5">
                &middot;&middot;&middot;
              </span>
            );
          }
          const outOfRange = !inRange(page);
          return (
            <button
              key={page}
              onClick={() => onGoToPage(page)}
              className={`rounded-full transition-colors flex-shrink-0 ${
                outOfRange ? 'w-1.5 h-1.5' : 'w-2.5 h-2.5'
              } ${
                page === currentPage
                  ? 'bg-accent ring-2 ring-accent/30'
                  : outOfRange
                    ? 'bg-gray-200 hover:bg-gray-300'
                    : confirmedPages.has(page)
                      ? 'bg-success hover:bg-success/80'
                      : detectedPages?.has(page)
                        ? 'bg-accent/40 hover:bg-accent/60'
                        : 'bg-gray-300 hover:bg-gray-400'
              }`}
              title={`Page ${page + 1}${
                outOfRange ? ' (outside score range)'
                : confirmedPages.has(page) ? ' (confirmed)'
                : detectedPages?.has(page) ? ' (auto-detected)'
                : ''
              }`}
            />
          );
        })}
      </div>

      <button
        onClick={() => onGoToPage(currentPage + 1)}
        disabled={currentPage === pageCount - 1}
        className="p-1.5 rounded-md bg-gray-100 hover:bg-gray-200 disabled:opacity-30 transition-colors flex-shrink-0"
      >
        <ChevronRight className="w-4 h-4 text-gray-600" />
      </button>

      <span className="text-xs text-gray-400 ml-2 flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap">
        Page
        <input
          type="text"
          inputMode="numeric"
          value={jumpValue}
          onChange={(e) => setJumpValue(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commitJump}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
            else if (e.key === 'Escape') { setJumpValue(String(currentPage + 1)); e.target.blur(); }
          }}
          aria-label={`Go to page, 1 to ${pageCount}`}
          className="w-12 px-1 py-0.5 text-center text-xs text-gray-600 bg-gray-100 rounded border border-transparent focus:outline-none focus:border-accent focus:bg-white"
        />
        of {pageCount}
      </span>
    </div>
  );
};

export default PageNavigation;
