import { pickGhostCompletion } from '../utils/stripNameSuggest';

// The ghost layer and the input must render text identically or the ghost
// drifts out of alignment -- Inter is a proportional webfont, so even a small
// metric mismatch is visible. Both use this exact class list, and the ghost
// re-renders the typed prefix transparently so the browser itself positions
// the remainder in normal inline flow rather than us computing an offset.
const FIELD_TEXT = 'w-full px-3 py-1.5 rounded-md text-sm font-medium border-none';

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
            {/* The accent background lives on the wrapper, so the input can be
                transparent over the ghost without the field losing its look. */}
            <div className="relative w-full rounded-md bg-accent focus-within:bg-accent/80 focus-within:ring-2 focus-within:ring-accent/40">
              {ghost && (
                <div
                  aria-hidden="true"
                  className={`absolute inset-0 whitespace-pre overflow-hidden pointer-events-none ${FIELD_TEXT}`}
                >
                  <span className="invisible">{value}</span>
                  <span className="text-white/50">{ghost.slice(value.length)}</span>
                </div>
              )}
              <input
                type="text"
                value={value}
                onChange={(e) => onUpdateName(index, e.target.value)}
                onBlur={() => onBlurName(index)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                spellCheck="false"
                autoComplete="off"
                className={`relative bg-transparent text-white placeholder-white/50 outline-none ${FIELD_TEXT}`}
                style={{ cursor: 'text' }}
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
