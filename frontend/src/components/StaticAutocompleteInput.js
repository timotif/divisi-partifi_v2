import { useState, useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';

/**
 * Searchable single-select input backed by a static local list.
 *
 * Filters the list as the user types (case-insensitive substring match),
 * shows a scrollable dropdown, supports full keyboard navigation, and
 * locks the field once a valid item is selected.
 *
 * Props:
 *   items        {string[]}      Full list of options
 *   value        {string}        Controlled value
 *   onChange     {fn(string)}    Called on every keystroke (unlocked) or on clear
 *   placeholder  {string}        Input placeholder text
 */
const StaticAutocompleteInput = ({ items, value, onChange, placeholder = '' }) => {
  const [open, setOpen]               = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // locked = user has confirmed a value from the list
  const [locked, setLocked]           = useState(false);

  const wrapperRef = useRef(null);
  const listRef    = useRef(null);

  // Filtered suggestions: substring match, max 50 to keep the list snappy
  const suggestions = locked ? [] : items.filter(
    item => item.toLowerCase().includes(value.toLowerCase())
  ).slice(0, 50);

  // Open dropdown whenever there are matches and input is non-empty
  useEffect(() => {
    if (!locked && value.length > 0 && suggestions.length > 0) {
      setOpen(true);
      setActiveIndex(-1);
    } else if (suggestions.length === 0) {
      setOpen(false);
    }
  }, [value, locked, suggestions.length]);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = useCallback((item) => {
    onChange(item);
    setLocked(true);
    setOpen(false);
    setActiveIndex(-1);
  }, [onChange]);

  const handleClear = useCallback(() => {
    onChange('');
    setLocked(false);
    setOpen(false);
    setActiveIndex(-1);
  }, [onChange]);

  const scrollTo = useCallback((idx) => {
    listRef.current?.children[idx]?.scrollIntoView({ block: 'nearest' });
  }, []);

  const handleKeyDown = useCallback((e) => {
    if (!open) {
      // Re-open on any printable key if there are matches
      if (e.key.length === 1) setOpen(suggestions.length > 0);
      return;
    }
    const total = suggestions.length;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => {
        const next = prev < total - 1 ? prev + 1 : 0;
        scrollTo(next);
        return next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => {
        const next = prev > 0 ? prev - 1 : total - 1;
        scrollTo(next);
        return next;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < total) {
        handleSelect(suggestions[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  }, [open, suggestions, activeIndex, handleSelect, scrollTo]);

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <input
          type="text"
          placeholder={placeholder}
          value={value}
          readOnly={locked}
          onChange={(e) => { onChange(e.target.value); setLocked(false); }}
          onFocus={() => { if (!locked && suggestions.length > 0) setOpen(true); }}
          onKeyDown={handleKeyDown}
          className={[
            'w-full px-3 py-2 border border-surface-border rounded-md text-sm text-gray-700 placeholder-gray-400',
            'focus:outline-none focus:border-accent',
            locked ? 'bg-blue-50 cursor-default pr-8' : '',
          ].join(' ')}
        />
        {locked && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            title="Clear"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && suggestions.length > 0 && (
        <ul
          ref={listRef}
          className="absolute z-50 left-0 right-0 mt-1 bg-white border border-surface-border rounded-md shadow-lg max-h-52 overflow-y-auto text-sm"
        >
          {suggestions.map((item, i) => (
            <li
              key={item}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(item); }}
              onMouseEnter={() => setActiveIndex(i)}
              className={[
                'px-3 py-2 cursor-pointer text-gray-700',
                activeIndex === i ? 'bg-blue-50' : 'hover:bg-blue-50',
              ].join(' ')}
            >
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default StaticAutocompleteInput;
