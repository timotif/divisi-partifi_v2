import { useCallback, useEffect, useRef } from 'react';
import useAutocomplete from '../hooks/useAutocomplete';

/**
 * Title input with autocomplete against existing score titles.
 *
 * Selecting a suggestion fills the field — no lock, no side effects.
 *
 * Props:
 *   value      {string}      Controlled value
 *   onChange   {fn(string)}  Called on every change
 */
const TitleInput = ({ value, onChange }) => {
  const wrapperRef = useRef(null);

  const fetchTitles = useCallback(async (q) => {
    const res = await fetch(`/api/scores/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.scores || [];
  }, []);

  const handleSelect = useCallback((score) => {
    onChange(score.title);
  }, [onChange]);

  const {
    suggestions,
    activeIndex,
    setActiveIndex,
    open,
    setOpen,
    loading,
    listRef,
    handleKeyDown,
  } = useAutocomplete(fetchTitles, value, { onSelect: handleSelect });

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [setOpen]);

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <input
          type="text"
          placeholder="Title"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
          onKeyDown={handleKeyDown}
          className="w-full px-3 py-2 border border-surface-border rounded-md text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-accent"
        />
        {loading && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">…</span>
        )}
      </div>

      {open && suggestions.length > 0 && (
        <ul
          ref={listRef}
          className="absolute z-50 left-0 right-0 mt-1 bg-white border border-surface-border rounded-md shadow-lg max-h-52 overflow-y-auto text-sm"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.score_id}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(s); }}
              onMouseEnter={() => setActiveIndex(i)}
              className={[
                'px-3 py-2 cursor-pointer text-gray-700',
                activeIndex === i ? 'bg-blue-50' : 'hover:bg-blue-50',
              ].join(' ')}
            >
              {s.title}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default TitleInput;
