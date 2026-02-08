import { Music, Download, Plus, Upload, Type, X, Clock } from 'lucide-react';

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
  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-2">
        <Music className="w-6 h-6 text-blue-600" />
        <h1 className="text-2xl font-bold text-gray-800">Music Score Partitioner</h1>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onNewScore}
          className="flex items-center gap-2 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
        >
          <Upload className="w-4 h-4" />
          New Score
        </button>
        <button
          onClick={onAddDivider}
          disabled={isRectSelecting}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Divider
        </button>
        <button
          onClick={onToggleSelectHeader}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
            isSelectingHeader
              ? 'bg-green-700 text-white ring-2 ring-green-300'
              : hasHeader
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
        >
          <Type className="w-4 h-4" />
          {isSelectingHeader ? 'Draw Header...' : hasHeader ? 'Header Set' : 'Select Header'}
        </button>
        {hasHeader && !isSelectingHeader && (
          <button
            onClick={onClearHeader}
            className="flex items-center gap-1 px-3 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
            title="Clear header selection"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={onToggleSelectMarking}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
            isSelectingMarking
              ? 'bg-amber-700 text-white ring-2 ring-amber-300'
              : markingCount > 0
                ? 'bg-amber-600 text-white hover:bg-amber-700'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
        >
          <Clock className="w-4 h-4" />
          {isSelectingMarking ? 'Draw Marking...' : markingCount > 0 ? `Marking (${markingCount})` : 'Select Marking'}
        </button>
        {markingCount > 0 && !isSelectingMarking && (
          <button
            onClick={onClearMarkings}
            className="flex items-center gap-1 px-3 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
            title="Clear all markings"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={onExport}
          disabled={isExporting || stripCount === 0}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          <Download className="w-4 h-4" />
          {isExporting ? 'Exporting...' : `Export Parts (${stripCount} strips)`}
        </button>
      </div>
    </div>
  );
};

export default Toolbar;
