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
    <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
      <h3 className="font-medium text-green-800 mb-2">Parts generated successfully:</h3>
      <ul className="space-y-1">
        {parts.map((part) => (
          <li key={part.name} className="flex items-center gap-2">
            <Download className="w-4 h-4 text-green-600" />
            <button
              onClick={() => handleDownload(part.name)}
              className="text-blue-600 hover:underline"
            >
              {part.name}.pdf
            </button>
            <span className="text-xs text-gray-500">
              ({part.staves_count} staves, {part.page_count} output pages)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ExportResults;
