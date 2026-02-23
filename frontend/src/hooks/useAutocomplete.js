import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Reusable autocomplete hook.
 *
 * Handles debounced fetching, open/close state, and full keyboard navigation
 * (ArrowDown, ArrowUp, Enter, Escape) so individual input components only
 * need to wire up the returned handlers and state.
 *
 * @param {function} fetchFn  - async (query: string) => suggestion[]
 *                              Called when value.length >= minLength and enabled.
 *                              Should return an array; any shape is fine — the
 *                              caller decides how to render items.
 * @param {string}   value    - Current input value (controlled by caller).
 * @param {object}   options
 *   @param {boolean} [options.enabled=true]     - Set false to suppress fetching (e.g. when locked).
 *   @param {number}  [options.minLength=2]       - Minimum chars before fetching.
 *   @param {number}  [options.debounceMs=300]    - Debounce delay in ms.
 *   @param {number}  [options.extraItems=0]      - Number of non-suggestion items appended
 *                                                  to the dropdown (e.g. "Add as new").
 *                                                  Included in the activeIndex range so
 *                                                  Enter on them is handled by the caller
 *                                                  via onEnterExtra(relativeIndex).
 *
 * @returns {object}
 *   suggestions   - Current suggestion array from fetchFn.
 *   activeIndex   - Highlighted index (-1 = none, 0..n-1 = suggestion, n+ = extra items).
 *   setActiveIndex
 *   open          - Whether the dropdown should be visible.
 *   setOpen
 *   loading       - True while a fetch is in-flight.
 *   listRef       - Ref to attach to the <ul> for scrollIntoView.
 *   handleKeyDown - onKeyDown handler to attach to the <input>.
 *                   Calls onSelect(suggestion) or onEnterExtra(relativeIndex) on Enter.
 *
 * Usage:
 *   const { suggestions, activeIndex, setActiveIndex, open, setOpen,
 *           loading, listRef, handleKeyDown } = useAutocomplete(
 *     async (q) => { const r = await fetch(`/api/things?q=${q}`); return (await r.json()).things; },
 *     value,
 *     { onSelect: handleSelect, onEnterExtra: handleExtra, extraItems: 1 }
 *   );
 */
export default function useAutocomplete(fetchFn, value, options = {}) {
  const {
    enabled      = true,
    minLength    = 2,
    debounceMs   = 300,
    extraItems   = 0,
    onSelect     = () => {},
    onEnterExtra = () => {},
  } = options;

  const [suggestions, setSuggestions] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen]               = useState(false);
  const [loading, setLoading]         = useState(false);

  const debounceRef = useRef(null);
  const listRef     = useRef(null);

  // Fetch when value changes (gated by enabled + minLength)
  useEffect(() => {
    if (!enabled) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.length < minLength) {
      setSuggestions([]);
      setActiveIndex(-1);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const results = await fetchFn(value);
        setSuggestions(results);
        setActiveIndex(-1);
        setOpen(true);
      } catch {
        // Network errors are non-fatal; leave current state
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, enabled]); // fetchFn and options are stable refs — intentionally omitted

  const scrollTo = useCallback((idx) => {
    listRef.current?.children[idx]?.scrollIntoView({ block: 'nearest' });
  }, []);

  const handleKeyDown = useCallback((e) => {
    if (!open) return;
    const total = suggestions.length + extraItems;

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
      if (activeIndex >= 0 && activeIndex < suggestions.length) {
        onSelect(suggestions[activeIndex]);
      } else if (activeIndex >= suggestions.length) {
        onEnterExtra(activeIndex - suggestions.length);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  }, [open, suggestions, extraItems, activeIndex, onSelect, onEnterExtra, scrollTo]);

  return {
    suggestions,
    activeIndex,
    setActiveIndex,
    open,
    setOpen,
    loading,
    listRef,
    handleKeyDown,
  };
}
