import { useState, useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import ComposerModal from './ComposerModal';
import useAutocomplete from '../hooks/useAutocomplete';

/**
 * Split a free-text composer name into { surname, name }.
 *   "Brahms, Johannes"  -> { surname: "Brahms",   name: "Johannes" }
 *   "Johannes Brahms"   -> { surname: "Brahms",   name: "Johannes" }
 *   "Brahms"            -> { surname: "Brahms",   name: "" }
 */
function splitComposerName(text) {
  const trimmed = text.trim();
  if (!trimmed) return { surname: '', name: '' };

  if (trimmed.includes(',')) {
    const [first, ...rest] = trimmed.split(',');
    return { surname: first.trim(), name: rest.join(',').trim() };
  }

  const words = trimmed.split(/\s+/);
  if (words.length === 1) return { surname: words[0], name: '' };
  return { surname: words[words.length - 1], name: words.slice(0, -1).join(' ') };
}

/**
 * Build the display label for a composer suggestion row.
 *   { surname: "Brahms", name: "Johannes", period: "Romantic", nationality: "German" }
 *   -> "Brahms, Johannes (Romantic · German)"
 */
function composerLabel(c) {
  const full = c.name ? `${c.surname}, ${c.name}` : c.surname;
  const tags = [c.period, c.nationality].filter(Boolean).join(' · ');
  return tags ? `${full} (${tags})` : full;
}

/**
 * Autocomplete input for composer names.
 *
 * Props:
 *   value        {string}        Controlled text value
 *   onChange     {fn(text)}      Called on every keystroke while unlocked
 *   onSelect     {fn(obj|null)}  Called with { composer_id, displayName } on lock,
 *                                or null on clear
 */
const ComposerInput = ({ value, onChange, onSelect }) => {
  const [locked, setLocked]                   = useState(false);
  const [pendingComposer, setPendingComposer] = useState(null);
  const wrapperRef = useRef(null);

  const fetchComposers = useCallback(async (q) => {
    const res = await fetch(`/api/composers?q=${encodeURIComponent(q)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.composers || [];
  }, []);

  const handleSelect = useCallback((composer) => {
    const displayName = composer.name
      ? `${composer.surname}, ${composer.name}`
      : composer.surname;
    onChange(displayName);
    setLocked(true);
    onSelect({ composer_id: composer.composer_id, displayName });
  }, [onChange, onSelect]);

  const handleAddNew = useCallback(() => {
    const split = splitComposerName(value);
    if (!split.surname) return;
    setPendingComposer(split);
  }, [value]);

  const {
    suggestions,
    activeIndex,
    setActiveIndex,
    open,
    setOpen,
    loading,
    listRef,
    handleKeyDown,
  } = useAutocomplete(fetchComposers, value, {
    enabled:      !locked,
    extraItems:   1,          // "Add as new" row
    onSelect:     handleSelect,
    onEnterExtra: () => handleAddNew(),
  });

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [setOpen]);

  // Modal saved — composer was created inside the modal, lock the input
  const handleModalSave = useCallback((composerObj) => {
    const displayName = composerObj.name
      ? `${composerObj.surname}, ${composerObj.name}`
      : composerObj.surname;
    onChange(displayName);
    setLocked(true);
    setPendingComposer(null);
    onSelect({ composer_id: composerObj.composer_id, displayName });
  }, [onChange, onSelect]);

  // Modal skipped — create bare row and lock without extra data
  const handleModalSkip = useCallback(() => {
    if (!pendingComposer) return;
    const displayName = pendingComposer.name
      ? `${pendingComposer.surname}, ${pendingComposer.name}`
      : pendingComposer.surname;
    fetch('/api/composers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pendingComposer),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.composer_id) {
          onChange(displayName);
          setLocked(true);
          onSelect({ composer_id: data.composer_id, displayName });
        }
      })
      .catch(() => {});
    setPendingComposer(null);
  }, [pendingComposer, onChange, onSelect]);

  const handleClear = useCallback(() => {
    onChange('');
    setLocked(false);
    setOpen(false);
    onSelect(null);
  }, [onChange, onSelect, setOpen]);

  return (
    <>
      <div ref={wrapperRef} className="relative">
        <div className="relative">
          <input
            type="text"
            placeholder="Composer"
            value={value}
            readOnly={locked}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => { if (!locked && suggestions.length > 0) setOpen(true); }}
            onKeyDown={handleKeyDown}
            className={[
              'w-full px-3 py-2 border border-surface-border rounded-md text-sm text-gray-700 placeholder-gray-400',
              'focus:outline-none focus:border-accent',
              locked ? 'bg-blue-50 cursor-default pr-8' : '',
            ].join(' ')}
          />
          {locked ? (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              title="Clear composer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : loading ? (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">…</span>
          ) : null}
        </div>

        {/* Dropdown */}
        {open && !locked && (
          <ul
            ref={listRef}
            className="absolute z-50 left-0 right-0 mt-1 bg-white border border-surface-border rounded-md shadow-lg max-h-52 overflow-y-auto text-sm"
          >
            {suggestions.map((c, i) => (
              <li
                key={c.composer_id}
                onMouseDown={(e) => { e.preventDefault(); handleSelect(c); }}
                onMouseEnter={() => setActiveIndex(i)}
                className={[
                  'px-3 py-2 cursor-pointer text-gray-700',
                  activeIndex === i ? 'bg-blue-50' : 'hover:bg-blue-50',
                ].join(' ')}
              >
                {composerLabel(c)}
              </li>
            ))}
            <li
              onMouseDown={(e) => { e.preventDefault(); handleAddNew(); }}
              onMouseEnter={() => setActiveIndex(suggestions.length)}
              className={[
                'px-3 py-2 cursor-pointer text-accent border-t border-surface-border',
                activeIndex === suggestions.length ? 'bg-gray-50' : 'hover:bg-gray-50',
              ].join(' ')}
            >
              Add "{value}" as new composer
            </li>
          </ul>
        )}
      </div>

      {/* Creation modal */}
      {pendingComposer && (
        <ComposerModal
          mode="create"
          composer={pendingComposer}
          onSave={handleModalSave}
          onSkip={handleModalSkip}
          onClose={() => setPendingComposer(null)}
        />
      )}
    </>
  );
};

export default ComposerInput;
