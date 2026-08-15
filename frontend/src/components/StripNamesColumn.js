import { pickGhostCompletion } from '../utils/stripNameSuggest';

// Shared font/box metrics between the ghost overlay and the real input so
// typed text and ghost text stay pixel-aligned. Must mirror the input's
// className below (text-sm font-medium, px-3 py-1.5, border-none).
const FIELD_STYLE = {
  fontSize: '0.875rem',      // text-sm
  fontWeight: 500,           // font-medium
  lineHeight: '1.25rem',
  padding: '0.375rem 0.75rem', // py-1.5 px-3
  border: '1px solid transparent',
  boxSizing: 'border-box',
};

const StripNamesColumn = ({
  strips,
  stripNames,
  pageHeight,
  onUpdateName,
  onBlurName,
  nameCandidates = [],
  suggestedNames = [],
}) => {
  if (strips.length === 0) return <div className="w-40 flex-shrink-0" style={{ height: pageHeight }} />;

  // Compute per-system part numbers (resets at each system divider)
  const partNumbers = [];
  let num = 0;
  for (const strip of strips) {
    if (strip.isSystemStart) num = 0;
    num++;
    partNumbers.push(num);
  }

  const acceptAndAdvance = (index, e, value) => {
    onUpdateName(index, value);
    onBlurName(index);
    // Let the browser move focus to the next field; we only supplied the value.
    e.preventDefault();
    requestAnimationFrame(() => {
      const form = e.target.form || document;
      const focusables = Array.from(form.querySelectorAll('input[type="text"]'));
      const pos = focusables.indexOf(e.target);
      if (pos >= 0 && pos + 1 < focusables.length) focusables[pos + 1].focus();
    });
  };

  const handleKeyDown = (index, e) => {
    if (e.key !== 'Tab' || e.shiftKey) return;
    const value = stripNames[index] || '';
    const ghost = pickGhostCompletion(value, nameCandidates);
    if (ghost) {
      acceptAndAdvance(index, e, ghost);
      return;
    }
    const suggestion = suggestedNames[index];
    if (!value && suggestion) {
      acceptAndAdvance(index, e, suggestion);
    }
    // Else: plain Tab navigation, do not preventDefault.
  };

  return (
    <div className="w-40 flex-shrink-0 relative" style={{ height: pageHeight }}>
      <div className="text-xs font-medium text-gray-400 mb-2">Parts</div>
      {strips.map((strip, index) => {
        const value = stripNames[index] || '';
        const ghost = pickGhostCompletion(value, nameCandidates);
        const suggestion = suggestedNames[index];
        return (
          <div
            key={`name-${index}`}
            className="absolute flex items-center"
            style={{
              top: strip.start,
              height: strip.height,
              width: '100%'
            }}
          >
            <div className="relative w-full">
              {ghost && (
                <div
                  aria-hidden="true"
                  className="absolute inset-0 rounded-md whitespace-pre overflow-hidden pointer-events-none"
                  style={FIELD_STYLE}
                >
                  <span style={{ color: 'transparent' }}>{value}</span>
                  <span className="text-gray-400">{ghost.slice(value.length)}</span>
                </div>
              )}
              <input
                type="text"
                value={value}
                onChange={(e) => onUpdateName(index, e.target.value)}
                onBlur={() => onBlurName(index)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                className="relative w-full bg-accent text-white px-3 py-1.5 rounded-md text-sm font-medium border-none outline-none focus:bg-accent/80 focus:ring-2 focus:ring-accent/40"
                style={{ cursor: 'text', backgroundColor: ghost ? 'transparent' : undefined }}
                onClick={(e) => e.stopPropagation()}
                placeholder={suggestion || `Part ${partNumbers[index]}`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default StripNamesColumn;
