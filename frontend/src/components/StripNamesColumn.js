const StripNamesColumn = ({ strips, stripNames, pageHeight, onUpdateName, onBlurName }) => {
  if (strips.length === 0) return <div className="w-40 flex-shrink-0" style={{ height: pageHeight }} />;

  // Compute per-system part numbers (resets at each system divider)
  const partNumbers = [];
  let num = 0;
  for (const strip of strips) {
    if (strip.isSystemStart) num = 0;
    num++;
    partNumbers.push(num);
  }

  return (
    <div className="w-40 flex-shrink-0 relative" style={{ height: pageHeight }}>
      <div className="text-xs font-medium text-gray-400 mb-2">Parts</div>
      {strips.map((strip, index) => (
        <div
          key={`name-${index}`}
          className="absolute flex items-center"
          style={{
            top: strip.start,
            height: strip.height,
            width: '100%'
          }}
        >
          <input
            type="text"
            value={stripNames[index] || ''}
            onChange={(e) => onUpdateName(index, e.target.value)}
            onBlur={() => onBlurName(index)}
            className="w-full bg-accent text-white px-3 py-1.5 rounded-md text-sm font-medium border-none outline-none focus:bg-accent/80 focus:ring-2 focus:ring-accent/40"
            style={{ cursor: 'text' }}
            onClick={(e) => e.stopPropagation()}
            placeholder={`Part ${partNumbers[index]}`}
          />
        </div>
      ))}
    </div>
  );
};

export default StripNamesColumn;
