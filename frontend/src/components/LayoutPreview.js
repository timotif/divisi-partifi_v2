import { ArrowLeft, Download, RotateCcw } from 'lucide-react';
import PagePreviewArea from './PagePreviewArea';

const LayoutPreview = ({
  scoreId,
  previewData,
  spacingByPart,
  offsetsByPart,
  pageBreaksByPart,
  selectedPartIndex,
  onSelectPart,
  onSpacingChange,
  onOffsetsChange,
  onPageBreaksChange,
  onResetPart,
  onBackToEdit,
  onGenerate,
  isGenerating,
  error,
  onClearError,
}) => {
  const selectedPart = previewData?.[selectedPartIndex];
  if (!selectedPart) return null;

  const spacingPx = spacingByPart[selectedPart.name] ?? selectedPart.layout.default_spacing_px;
  const offsets = offsetsByPart[selectedPart.name] || new Array(selectedPart.staves_count).fill(0);
  const pageBreaks = pageBreaksByPart[selectedPart.name] || new Set();

  // Convert px to mm for display (300 DPI)
  const spacingMm = spacingPx * 25.4 / 300;

  return (
    <div className="flex flex-col h-screen bg-surface-bg">
      <div className="max-w-screen-xl mx-auto w-full flex flex-col min-h-0 flex-1 px-6 pt-4 pb-2">
        <div className="bg-surface-card rounded-md shadow-sm border border-surface-border px-6 pt-4 pb-3 flex flex-col min-h-0 flex-1">
          {/* Top toolbar */}
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={onBackToEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-600 rounded-md hover:bg-gray-200 transition-colors text-sm"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Edit
              </button>
              <h2 className="text-lg font-semibold text-gray-700">Layout Preview</h2>
            </div>
            <button
              onClick={onGenerate}
              disabled={isGenerating}
              className="flex items-center gap-2 px-4 py-1.5 bg-success text-white rounded-md hover:bg-success/80 disabled:opacity-50 transition-colors text-sm"
            >
              <Download className="w-4 h-4" />
              {isGenerating ? 'Generating...' : 'Generate PDFs'}
            </button>
          </div>

          {/* Error banner */}
          {error && (
            <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-md flex items-center justify-between">
              <span className="text-danger">{error}</span>
              <button onClick={onClearError} className="text-danger hover:text-red-700 font-bold">
                ×
              </button>
            </div>
          )}

          {/* Part tabs */}
          <div className="flex items-center gap-1 mb-4 overflow-x-auto">
            {previewData.map((part, i) => (
              <button
                key={part.name}
                onClick={() => onSelectPart(i)}
                className={`px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors ${
                  i === selectedPartIndex
                    ? 'bg-accent text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {part.name}
                <span className="ml-1.5 text-xs opacity-70">({part.staves_count})</span>
              </button>
            ))}
          </div>

          {/* Main area: sidebar + preview */}
          <div className="flex min-h-0 flex-1 gap-4">
            {/* Left sidebar: spacing control */}
            <div className="w-48 flex-shrink-0 flex flex-col gap-4">
              <div className="bg-gray-50 rounded-md p-3 border border-surface-border">
                <label className="block text-xs font-medium text-gray-500 mb-2">
                  Staff Spacing
                </label>
                <input
                  type="range"
                  min={2 * 300 / 25.4}
                  max={30 * 300 / 25.4}
                  step={0.5 * 300 / 25.4}
                  value={spacingPx}
                  onChange={(e) => onSpacingChange(selectedPart.name, Number(e.target.value))}
                  className="w-full accent-accent"
                />
                <div className="mt-1 text-center text-sm font-medium text-gray-700">
                  {spacingMm.toFixed(1)} mm
                </div>
              </div>

              <button
                onClick={() => onResetPart(selectedPart.name, selectedPart.layout.default_spacing_px)}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-500 rounded-md hover:bg-gray-200 transition-colors text-xs"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Part
              </button>

              <div className="text-xs text-gray-400 space-y-1">
                <p>Drag staves to adjust individual gaps.</p>
                <p>Click between staves to add a page break.</p>
                <p>Click a page break line to remove it.</p>
              </div>
            </div>

            {/* Page preview area */}
            <div className="flex-1 min-h-0 overflow-auto">
              <PagePreviewArea
                scoreId={scoreId}
                partMeta={selectedPart}
                spacingPx={spacingPx}
                offsets={offsets}
                pageBreaksAfter={pageBreaks}
                onOffsetsChange={(newOffsets) => onOffsetsChange(selectedPart.name, newOffsets)}
                onPageBreaksChange={(newBreaks) => onPageBreaksChange(selectedPart.name, newBreaks)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LayoutPreview;
