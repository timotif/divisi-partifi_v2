import { Download, Plus, Upload, Type, Clock } from 'lucide-react';

const Toolbar = ({
  onNewScore,
  onAddDivider,
  onExport,
  onToggleSelectHeader,
  onToggleSelectMarking,
  isRectSelecting,
  isSelectingHeader,
  isSelectingMarking,
  hasHeader,
  markingCount,
  isExporting,
  stripCount,
  autoDetect,
  onToggleAutoDetect,
}) => {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-700">Divisi</h1>

        <div className="flex items-center gap-2">
          {/* Auto-detect toggle */}
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none mr-2">
            <button
              role="switch"
              aria-checked={autoDetect}
              onClick={onToggleAutoDetect}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                autoDetect ? 'bg-accent' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                  autoDetect ? 'translate-x-[18px]' : 'translate-x-[3px]'
                }`}
              />
            </button>
            Auto-detect
          </label>
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
            {isSelectingHeader ? 'Draw Header...' : hasHeader ? 'Header Set' : 'Header'}
            <kbd className="ml-1 px-1 py-0.5 bg-white/20 rounded text-[10px] font-mono">H</kbd>
          </button>
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
            {isSelectingMarking ? 'Draw Marking...' : markingCount > 0 ? `Marking (${markingCount})` : 'Marking'}
            <kbd className="ml-1 px-1 py-0.5 bg-white/20 rounded text-[10px] font-mono">M</kbd>
          </button>
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
    </div>
  );
};

export default Toolbar;
