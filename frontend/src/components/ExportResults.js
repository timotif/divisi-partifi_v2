import { Download, X } from 'lucide-react';

const ExportResults = ({ parts, scoreId, onError, onDismiss }) => {
  const handleDownload = async (partName) => {
    const res = await fetch(`/api/scores/${scoreId}/parts/${encodeURIComponent(partName)}`);
    if (!res.ok) { onError(`Download failed: ${res.status}`); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${partName}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 bg-surface-card border border-success/30 rounded-md shadow-lg">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-medium text-success text-sm">Parts ready:</h3>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            title="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      <ul className="space-y-1">
        {parts.map((part) => (
          <li key={part.name} className="flex items-center gap-2">
            <Download className="w-3.5 h-3.5 text-success flex-shrink-0" />
            <button
              onClick={() => handleDownload(part.name)}
              className="text-accent hover:underline text-sm truncate"
            >
              {part.name}.pdf
            </button>
            <span className="text-xs text-gray-400 whitespace-nowrap">
              ({part.page_count}p)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ExportResults;
