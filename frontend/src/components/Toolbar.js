import { Download, Plus, Upload, Type, X, Clock } from 'lucide-react';

const Toolbar = ({
  onNewScore,
  onAddDivider,
  onExport,
  onToggleSelectHeader,
  onClearHeader,
  onToggleSelectMarking,
  onClearMarkings,
  isRectSelecting,
  isSelectingHeader,
  isSelectingMarking,
  hasHeader,
  markingCount,
  isExporting,
  stripCount,
}) => {
  const hasAnnotations = hasHeader || markingCount > 0;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-700">Divisi</h1>

        <div className="flex gap-2">
          <button
            onClick={onNewScore}
            className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-gray-600 rounded-md hover:bg-gray-200 transition-colors text-sm"
          >
            <Upload className="w-4 h-4" />
            New Score
          </button>
          <button
            onClick={onAddDivider}
            disabled={isRectSelecting}
            className="flex items-center gap-2 px-3 py-1.5 bg-accent text-white rounded-md hover:bg-accent/80 disabled:opacity-50 transition-colors text-sm"
          >
            <Plus className="w-4 h-4" />
            Add Divider
          </button>
          <button
            onClick={onToggleSelectHeader}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors text-sm ${
              isSelectingHeader
                ? 'bg-success text-white ring-2 ring-success/40'
                : hasHeader
                  ? 'bg-success text-white hover:bg-success/80'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Type className="w-4 h-4" />
            {isSelectingHeader ? 'Draw Header...' : hasHeader ? 'Header Set' : 'Select Header'}
          </button>
          {hasHeader && !isSelectingHeader && (
            <button
              onClick={onClearHeader}
              className="flex items-center gap-1 px-2 py-1.5 bg-gray-100 text-gray-500 rounded-md hover:bg-red-50 hover:text-danger transition-colors"
              title="Clear header selection"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onToggleSelectMarking}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors text-sm ${
              isSelectingMarking
                ? 'bg-warning text-white ring-2 ring-warning/40'
                : markingCount > 0
                  ? 'bg-warning text-white hover:bg-warning/80'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Clock className="w-4 h-4" />
            {isSelectingMarking ? 'Draw Marking...' : markingCount > 0 ? `Marking (${markingCount})` : 'Select Marking'}
          </button>
          {markingCount > 0 && !isSelectingMarking && (
            <button
              onClick={onClearMarkings}
              className="flex items-center gap-1 px-2 py-1.5 bg-gray-100 text-gray-500 rounded-md hover:bg-red-50 hover:text-danger transition-colors"
              title="Clear all markings"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onExport}
            disabled={isExporting || stripCount === 0}
            className="flex items-center gap-2 px-3 py-1.5 bg-success text-white rounded-md hover:bg-success/80 disabled:opacity-50 transition-colors text-sm"
          >
            <Download className="w-4 h-4" />
            {isExporting ? 'Exporting...' : `Export (${stripCount})`}
          </button>
        </div>
      </div>

      {/* Annotation legend */}
      {hasAnnotations && (
        <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
          {hasHeader && (
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-success" />
              Header
            </div>
          )}
          {markingCount > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-warning" />
              Marking ({markingCount})
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Toolbar;
