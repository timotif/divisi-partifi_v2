import { useState } from 'react';
import { resolveGhostName } from '../utils/knownSequence';

// The ghost layer and the input must render text identically or the completion
// drifts out of alignment -- Inter is proportional, so even a small metric
// mismatch shows. Both use this exact class list, and the ghost re-renders the
// typed prefix invisibly so the browser positions the remainder in normal
// inline flow rather than us computing a pixel offset.
const FIELD_TEXT = 'w-full px-3 py-1.5 rounded-md text-sm font-medium border-none';

const StripNamesColumn = ({ strips, stripNames, sequence, pageHeight, onUpdateName, onBlurName }) => {
  const [focusedIndex, setFocusedIndex] = useState(-1);

  if (strips.length === 0) return <div className="w-40 flex-shrink-0" style={{ height: pageHeight }} />;

  // Compute per-system part numbers (resets at each system divider)
  const partNumbers = [];
  let num = 0;
  for (const strip of strips) {
    if (strip.isSystemStart) num = 0;
    num++;
    partNumbers.push(num);
  }

  // Ghost only fires on an empty focused field, narrowing as the user types.
  //
  // Prefill fills every strip, so the ghost is deliberately scarce: it appears
  // where a name has been erased, which is precisely where prefill guessed
  // wrong and help is wanted. Prefill does the bulk work; this assists the
  // repair. See docs/design/2026-08-16-strip-name-implementation-notes.md.
  const ghostFor = (index) => {
    if (index !== focusedIndex || !sequence || sequence.length === 0) return '';
    return resolveGhostName(stripNames, strips, sequence, index, stripNames[index] || '');
  };

  const acceptGhost = (index, ghost) => {
    onUpdateName(index, ghost);
    const next = document.getElementById(`strip-name-${index + 1}`);
    if (next) next.focus();
    else document.getElementById(`strip-name-${index}`)?.blur();
  };

  return (
    <div className="w-40 flex-shrink-0 relative" style={{ height: pageHeight }}>
      <div className="text-xs font-medium text-gray-400 mb-2">Parts</div>
      {strips.map((strip, index) => {
        const ghost = ghostFor(index);
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
                  className={`absolute inset-0 whitespace-pre overflow-hidden pointer-events-none ${FIELD_TEXT}`}
                  aria-hidden="true"
                >
                  {/* Reserves the exact width of what is typed, so the
                      completion starts at the caret instead of under it. */}
                  <span className="invisible">{stripNames[index] || ''}</span>
                  <span className="text-white/50">{ghost.slice((stripNames[index] || '').length)}</span>
                </div>
              )}
              <input
                id={`strip-name-${index}`}
                type="text"
                value={stripNames[index] || ''}
                onChange={(e) => onUpdateName(index, e.target.value)}
                onFocus={() => setFocusedIndex(index)}
                onBlur={() => {
                  setFocusedIndex(-1);
                  onBlurName(index);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Tab' && ghost) {
                    e.preventDefault();
                    acceptGhost(index, ghost);
                  }
                }}
                className={`relative bg-transparent text-white outline-none ${FIELD_TEXT}`}
                style={{ cursor: 'text' }}
                onClick={(e) => e.stopPropagation()}
                // The ghost occupies the same origin as the placeholder, so
                // showing both paints two strings over each other.
                placeholder={ghost ? '' : `Part ${partNumbers[index]}`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default StripNamesColumn;
