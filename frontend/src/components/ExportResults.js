import { Download } from 'lucide-react';

const ExportResults = ({ parts, scoreId, onError }) => {
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
    <div className="mt-4 p-4 bg-success/5 border border-success/20 rounded-md">
      <h3 className="font-medium text-success text-sm mb-2">Parts generated successfully:</h3>
      <ul className="space-y-1">
        {parts.map((part) => (
          <li key={part.name} className="flex items-center gap-2">
            <Download className="w-3.5 h-3.5 text-success" />
            <button
              onClick={() => handleDownload(part.name)}
              className="text-accent hover:underline text-sm"
            >
              {part.name}.pdf
            </button>
            <span className="text-xs text-gray-400">
              ({part.staves_count} staves, {part.page_count} output pages)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ExportResults;
