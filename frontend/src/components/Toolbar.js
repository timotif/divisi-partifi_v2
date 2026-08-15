import { useState } from 'react';
import { Download, Plus, Upload, Type, Clock, BookOpen, RefreshCw, Eraser } from 'lucide-react';

const Toolbar = ({
  onNewScore,
  onGoToLibrary,
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
  onForceRescan,
  isDetecting,
  scoreRange,
  onChangeScoreRange,
  pageCount,
  onRescanAll,
  onClearPageDividers,
  hasDividersOnPage,
  rescanProgress,
}) => {

  // Confirm state for destructive page actions:
  // 'rescan-page' | 'rescan-all' | 'clear-page' | null
  const [confirmAction, setConfirmAction] = useState(null);

  const CONFIRM_LABELS = {
    'rescan-page': { prompt: 'Re-detect this page?', verb: 'Rescan' },
    'rescan-all':  { prompt: 'Re-detect every score page? Discards all manual edits.', verb: 'Rescan all' },
    'clear-page':  { prompt: 'Remove all dividers on this page?', verb: 'Clear' },
  };

  const runConfirmed = () => {
    const action = confirmAction;
    setConfirmAction(null);
    if (action === 'rescan-page') onForceRescan();
    else if (action === 'rescan-all') onRescanAll?.();
    else if (action === 'clear-page') onClearPageDividers?.();
  };

  return (
    <div className="mb-6">
      {/* Row 1 — identity + document-level actions */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-gray-700 shrink-0">Divisi</h1>

        <div className="flex items-center gap-2">
          <button
            onClick={onGoToLibrary}
            className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-gray-600 rounded-md hover:bg-gray-200 transition-colors text-sm"
          >
            <BookOpen className="w-4 h-4" />
            Library
          </button>
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

      {/* Row 2 — detection settings + page actions */}
      <div className="mt-2 flex items-center flex-wrap gap-x-3 gap-y-2 text-xs text-gray-500">
        {/* Score page range */}
        {pageCount > 1 && scoreRange && (
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="whitespace-nowrap">Score pages</span>
            <input
              type="number"
              min={1}
              max={pageCount}
              value={scoreRange.from}
              onChange={(e) => onChangeScoreRange('from', e.target.value)}
              className="w-14 px-1.5 py-1 border border-gray-300 rounded text-center tabular-nums
                         focus:outline-none focus:ring-1 focus:ring-accent"
              title="First page of the score"
            />
            <span>–</span>
            <input
              type="number"
              min={1}
              max={pageCount}
              value={scoreRange.to}
              onChange={(e) => onChangeScoreRange('to', e.target.value)}
              className="w-14 px-1.5 py-1 border border-gray-300 rounded text-center tabular-nums
                         focus:outline-none focus:ring-1 focus:ring-accent"
              title="Last page of the score"
            />
            <span className="text-gray-400 whitespace-nowrap">of {pageCount}</span>
          </div>
        )}

        <span className="text-gray-200 select-none">|</span>

        {/* Auto-detect toggle */}
        <label className="flex items-center gap-1.5 cursor-pointer select-none shrink-0">
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

        <span className="text-gray-200 select-none">|</span>

        {/* Page actions — single confirm bar shared by all destructive actions */}
        {rescanProgress ? (
          <div className="flex items-center gap-2 px-2 py-1 bg-accent/10 border border-accent/30 rounded-md text-accent">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>Rescanning page {rescanProgress.done} of {rescanProgress.total}…</span>
          </div>
        ) : confirmAction ? (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-50 border border-amber-200 rounded-md text-amber-800">
            <span>{CONFIRM_LABELS[confirmAction].prompt}</span>
            <button
              onClick={runConfirmed}
              className="px-2 py-0.5 bg-amber-500 text-white rounded hover:bg-amber-600 transition-colors font-medium"
            >
              {CONFIRM_LABELS[confirmAction].verb}
            </button>
            <button
              onClick={() => setConfirmAction(null)}
              className="px-2 py-0.5 text-amber-700 hover:text-amber-900 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setConfirmAction('rescan-page')}
              disabled={isDetecting}
              title="Re-run auto-detection on this page (discards manual changes)"
              className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 text-gray-600 rounded-md hover:bg-gray-200 disabled:opacity-40 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isDetecting ? 'animate-spin' : ''}`} />
              Rescan page
            </button>
            <button
              onClick={() => setConfirmAction('rescan-all')}
              disabled={isDetecting}
              title="Re-run auto-detection on every page in the score range"
              className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 text-gray-600 rounded-md hover:bg-gray-200 disabled:opacity-40 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isDetecting ? 'animate-spin' : ''}`} />
              Rescan all
            </button>
            <button
              onClick={() => setConfirmAction('clear-page')}
              disabled={stripCount === 0 && !hasDividersOnPage}
              title="Remove every divider on this page"
              className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 text-gray-600 rounded-md hover:bg-gray-200 disabled:opacity-40 transition-colors"
            >
              <Eraser className="w-3.5 h-3.5" />
              Clear page
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Toolbar;
