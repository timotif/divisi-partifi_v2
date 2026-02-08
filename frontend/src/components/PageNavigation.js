import { ChevronLeft, ChevronRight } from 'lucide-react';

const PageNavigation = ({ currentPage, pageCount, confirmedPages, onGoToPage }) => {
  if (pageCount <= 1) return null;

  return (
    <div className="mt-4 flex items-center justify-center gap-4">
      <button
        onClick={() => onGoToPage(currentPage - 1)}
        disabled={currentPage === 0}
        className="p-2 rounded-lg bg-gray-200 hover:bg-gray-300 disabled:opacity-30 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      {/* Page dots */}
      <div className="flex items-center gap-1.5">
        {Array.from({ length: pageCount }, (_, i) => (
          <button
            key={i}
            onClick={() => onGoToPage(i)}
            className={`w-3 h-3 rounded-full transition-colors ${
              i === currentPage
                ? 'bg-blue-600 ring-2 ring-blue-300'
                : confirmedPages.has(i)
                  ? 'bg-green-500 hover:bg-green-600'
                  : 'bg-gray-300 hover:bg-gray-400'
            }`}
            title={`Page ${i + 1}${confirmedPages.has(i) ? ' (confirmed)' : ''}`}
          />
        ))}
      </div>

      <button
        onClick={() => onGoToPage(currentPage + 1)}
        disabled={currentPage === pageCount - 1}
        className="p-2 rounded-lg bg-gray-200 hover:bg-gray-300 disabled:opacity-30 transition-colors"
      >
        <ChevronRight className="w-4 h-4" />
      </button>

      <span className="text-sm text-gray-600 ml-2">
        Page {currentPage + 1} of {pageCount}
      </span>
    </div>
  );
};

export default PageNavigation;
