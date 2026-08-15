import { ChevronLeft, ChevronRight } from 'lucide-react';

const PageNavigation = ({ currentPage, pageCount, confirmedPages, detectedPages, onGoToPage, isPageInRange }) => {
  if (pageCount <= 1) return null;

  // When no range predicate is supplied, treat every page as in-range.
  const inRange = isPageInRange || (() => true);

  return (
    <div className="mt-4 flex items-center justify-center gap-4">
      <button
        onClick={() => onGoToPage(currentPage - 1)}
        disabled={currentPage === 0}
        className="p-1.5 rounded-md bg-gray-100 hover:bg-gray-200 disabled:opacity-30 transition-colors"
      >
        <ChevronLeft className="w-4 h-4 text-gray-600" />
      </button>

      {/* Page dots */}
      <div className="flex items-center gap-1.5">
        {Array.from({ length: pageCount }, (_, i) => {
          const outOfRange = !inRange(i);
          return (
            <button
              key={i}
              onClick={() => onGoToPage(i)}
              className={`rounded-full transition-colors ${
                outOfRange ? 'w-1.5 h-1.5' : 'w-2.5 h-2.5'
              } ${
                i === currentPage
                  ? 'bg-accent ring-2 ring-accent/30'
                  : outOfRange
                    ? 'bg-gray-200 hover:bg-gray-300'
                    : confirmedPages.has(i)
                      ? 'bg-success hover:bg-success/80'
                      : detectedPages?.has(i)
                        ? 'bg-accent/40 hover:bg-accent/60'
                        : 'bg-gray-300 hover:bg-gray-400'
              }`}
              title={`Page ${i + 1}${
                outOfRange ? ' (outside score range)'
                : confirmedPages.has(i) ? ' (confirmed)'
                : detectedPages?.has(i) ? ' (auto-detected)'
                : ''
              }`}
            />
          );
        })}
      </div>

      <button
        onClick={() => onGoToPage(currentPage + 1)}
        disabled={currentPage === pageCount - 1}
        className="p-1.5 rounded-md bg-gray-100 hover:bg-gray-200 disabled:opacity-30 transition-colors"
      >
        <ChevronRight className="w-4 h-4 text-gray-600" />
      </button>

      <span className="text-xs text-gray-400 ml-2">
        Page {currentPage + 1} of {pageCount}
      </span>
    </div>
  );
};

export default PageNavigation;
