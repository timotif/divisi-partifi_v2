const StripNamesColumn = ({ strips, stripNames, pageHeight, onUpdateName, onBlurName }) => {
  return (
    <div className="w-40 flex-shrink-0 relative" style={{ height: pageHeight }}>
      <div className="text-sm font-medium text-gray-600 mb-2">Strip Names</div>
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
            className="w-full bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium border-none outline-none focus:bg-blue-700 focus:ring-2 focus:ring-blue-300"
            style={{ cursor: 'text' }}
            onClick={(e) => e.stopPropagation()}
            placeholder={`Part ${index + 1}`}
          />
        </div>
      ))}
    </div>
  );
};

export default StripNamesColumn;
