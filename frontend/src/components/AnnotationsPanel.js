import { Type, Clock, X } from 'lucide-react';

const AnnotationsPanel = ({
  headerRegion,
  onClearHeader,
  markings,
  onRemoveMarking,
  onClearMarkings,
}) => {
  const hasHeader = !!headerRegion;
  const hasAnnotations = hasHeader || markings.length > 0;

  if (!hasAnnotations) return null;

  return (
    <div className="w-44 flex-shrink-0 overflow-y-auto text-xs">
      <h3 className="text-gray-500 font-medium mb-2">Annotations</h3>

      {hasHeader && (
        <div className="flex items-center justify-between gap-1 px-2 py-1.5 bg-success/10 border border-success/20 rounded mb-1.5">
          <div className="flex items-center gap-1.5 text-success min-w-0">
            <Type className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">Header</span>
          </div>
          <button
            onClick={onClearHeader}
            className="text-gray-400 hover:text-danger transition-colors flex-shrink-0"
            title="Clear header"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {markings.map((_, idx) => (
        <div
          key={idx}
          className="flex items-center justify-between gap-1 px-2 py-1.5 bg-warning/10 border border-warning/20 rounded mb-1.5"
        >
          <div className="flex items-center gap-1.5 text-warning min-w-0">
            <Clock className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">Marking {idx + 1}</span>
          </div>
          <button
            onClick={() => onRemoveMarking(idx)}
            className="text-gray-400 hover:text-danger transition-colors flex-shrink-0"
            title="Remove marking"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}

      {markings.length > 1 && (
        <button
          onClick={onClearMarkings}
          className="w-full mt-1 px-2 py-1 text-gray-400 hover:text-danger hover:bg-red-50 rounded transition-colors text-center"
        >
          Clear all markings
        </button>
      )}
    </div>
  );
};

export default AnnotationsPanel;
