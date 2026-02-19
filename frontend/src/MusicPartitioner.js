import { useState, useRef, useCallback, useEffect } from 'react';
import UploadScreen from './components/UploadScreen';
import ExportResults from './components/ExportResults';
import PageNavigation from './components/PageNavigation';
import Toolbar from './components/Toolbar';
import StripNamesColumn from './components/StripNamesColumn';
import ScoreCanvas from './components/ScoreCanvas';
import AnnotationsPanel from './components/AnnotationsPanel';
import LayoutPreview from './components/LayoutPreview';

const STRIP_COLUMN_WIDTH = 160;
const ANNOTATIONS_PANEL_WIDTH = 176; // w-44 = 11rem = 176px
const GAP = 16;
const MIN_PAGE_WIDTH = 400;

const MusicPartitioner = () => {
  // --- App lifecycle ---
  const [phase, setPhase] = useState('upload'); // 'upload' | 'edit' | 'exporting' | 'preview' | 'generating'

  // --- Score metadata from backend ---
  const [scoreId, setScoreId] = useState(null);
  const [scoreMetadata, setScoreMetadata] = useState(null);

  // --- Layout preview state ---
  const [previewData, setPreviewData] = useState(null);
  const [spacingByPart, setSpacingByPart] = useState({});
  const [offsetsByPart, setOffsetsByPart] = useState({});
  const [pageBreaksByPart, setPageBreaksByPart] = useState({});
  const [selectedPartIndex, setSelectedPartIndex] = useState(0);

  // --- Current page ---
  const [currentPage, setCurrentPage] = useState(0);
  const [pageImageUrl, setPageImageUrl] = useState(null);

  // --- Dividers: per-page, in display-pixel space ---
  // Dividers define strip boundaries. N dividers = N-1 strips (between consecutive dividers).
  // Area above first divider and below last divider is excluded (dead space).
  const [dividersByPage, setDividersByPage] = useState({});
  const [confirmedPages, setConfirmedPages] = useState(new Set());

  // --- System dividers: per-page, parallel boolean array ---
  const [systemDividersByPage, setSystemDividersByPage] = useState({});

  // --- Per-page strip names ---
  const [stripNamesByPage, setStripNamesByPage] = useState({});

  // --- Export results ---
  const [exportResult, setExportResult] = useState(null);

  // --- Staff detection state ---
  const [autoDetect, setAutoDetect] = useState(true);
  const [detectedPages, setDetectedPages] = useState(new Set());
  const [detectingPage, setDetectingPage] = useState(null); // page number or null
  const [detectionWarnings, setDetectionWarnings] = useState({});

  // --- Header region: rectangle selection for piece title ---
  const [headerRegion, setHeaderRegion] = useState(null); // { page, x, y, w, h } in display pixels
  const [isSelectingHeader, setIsSelectingHeader] = useState(false);

  // --- Score markings: multiple rectangle selections ---
  const [markings, setMarkings] = useState([]); // [{ page, x, y, w, h }]
  const [isSelectingMarking, setIsSelectingMarking] = useState(false);

  // --- Shared rectangle drag state ---
  const [rectDragStart, setRectDragStart] = useState(null);
  const [rectDragCurrent, setRectDragCurrent] = useState(null);

  // --- UI state ---
  const [dragIndex, setDragIndex] = useState(-1);
  const [dragOffset, setDragOffset] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const containerRef = useRef(null);

  // --- Responsive size measurement ---
  const scoreAreaRef = useRef(null);
  const [measuredSize, setMeasuredSize] = useState({ width: 800, height: 600 });
  const prevPageWidthRef = useRef(null);

  useEffect(() => {
    if (!scoreAreaRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setMeasuredSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(scoreAreaRef.current);
    return () => observer.disconnect();
  }, [phase]); // re-attach when phase changes (upload -> edit)

  // --- Computed display dimensions ---
  // Fit page within both available width and height
  const currentPageMeta = scoreMetadata?.pages?.[currentPage];
  const backendWidth = currentPageMeta?.width || 1;
  const backendHeight = currentPageMeta?.height || 1;
  const hasAnnotations = !!headerRegion || markings.length > 0;
  const annotationsPanelSpace = hasAnnotations ? ANNOTATIONS_PANEL_WIDTH + GAP : 0;
  const availableWidth = Math.max(MIN_PAGE_WIDTH, measuredSize.width - STRIP_COLUMN_WIDTH - GAP - annotationsPanelSpace);
  const availableHeight = measuredSize.height > 100 ? measuredSize.height : 600;
  const scaleByWidth = availableWidth / backendWidth;
  const scaleByHeight = availableHeight / backendHeight;
  const displayScale = Math.min(scaleByWidth, scaleByHeight);
  const pageWidth = Math.round(backendWidth * displayScale);
  const pageHeight = Math.round(backendHeight * displayScale);

  // --- Rescale annotations when pageWidth changes ---
  useEffect(() => {
    const oldWidth = prevPageWidthRef.current;
    if (oldWidth === null || oldWidth === pageWidth) {
      prevPageWidthRef.current = pageWidth;
      return;
    }
    const ratio = pageWidth / oldWidth;
    prevPageWidthRef.current = pageWidth;

    // Rescale all dividers
    setDividersByPage(prev => {
      const next = {};
      for (const [page, divs] of Object.entries(prev)) {
        next[page] = divs.map(y => Math.round(y * ratio));
      }
      return next;
    });

    // Rescale header region
    setHeaderRegion(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        x: Math.round(prev.x * ratio),
        y: Math.round(prev.y * ratio),
        w: Math.round(prev.w * ratio),
        h: Math.round(prev.h * ratio),
      };
    });

    // Rescale markings
    setMarkings(prev => prev.map(m => ({
      ...m,
      x: Math.round(m.x * ratio),
      y: Math.round(m.y * ratio),
      w: Math.round(m.w * ratio),
      h: Math.round(m.h * ratio),
    })));
  }, [pageWidth]);

  // --- Current page dividers, strip names, and system divider flags ---
  const currentDividers = dividersByPage[currentPage] || [];
  const currentStripNames = stripNamesByPage[currentPage] || [];
  const currentSystemDividers = systemDividersByPage[currentPage] || [];

  // --- Strips computation ---
  const getStrips = useCallback(() => {
    if (currentDividers.length < 2) return [];
    const strips = [];
    for (let j = 0; j < currentDividers.length - 1; j++) {
      const isTopSystem = !!currentSystemDividers[j];
      const isBotSystem = !!currentSystemDividers[j + 1];
      if (isBotSystem) continue;
      strips.push({
        start: currentDividers[j],
        end: currentDividers[j + 1],
        height: currentDividers[j + 1] - currentDividers[j],
        isSystemStart: isTopSystem,
      });
    }
    return strips;
  }, [currentDividers, currentSystemDividers]);

  const strips = getStrips();

  // --- Auto-fill ---

  // Build known instrument sequence from a page's strip names + strips.
  // Returns array of unique names from the first system, e.g. ["Vln I", "Vln II", "Vla"].
  const buildKnownSequence = useCallback((names, pageStrips) => {
    const known = [];
    const seen = new Set();
    for (let i = 0; i < names.length && i < pageStrips.length; i++) {
      if (i > 0 && pageStrips[i].isSystemStart) break;
      const name = names[i];
      if (name === undefined || name === '') break;
      if (seen.has(name)) break;
      seen.add(name);
      known.push(name);
    }
    return known;
  }, []);

  // Derive strip objects from raw divider/system-flag arrays (same logic as getStrips
  // but works for any page, not just currentPage).
  const deriveStrips = useCallback((dividers, systemFlags) => {
    if (!dividers || dividers.length < 2) return [];
    const result = [];
    for (let j = 0; j < dividers.length - 1; j++) {
      if (systemFlags[j + 1]) continue;
      result.push({
        start: dividers[j],
        end: dividers[j + 1],
        height: dividers[j + 1] - dividers[j],
        isSystemStart: !!systemFlags[j],
      });
    }
    return result;
  }, []);

  // Fill empty strip names on a single page using a known sequence, cycling and
  // resetting at system dividers. For non-empty names (user-typed), sync the
  // sequence position to that name so subsequent fills continue correctly.
  const fillPageNames = useCallback((names, pageStrips, knownSeq) => {
    if (!knownSeq.length || !pageStrips.length) return names;
    const result = [...names];
    let seqIdx = 0;
    for (let i = 0; i < pageStrips.length; i++) {
      if (pageStrips[i].isSystemStart) seqIdx = 0;
      if (!result[i] || result[i] === '') {
        // Empty: fill from sequence
        result[i] = knownSeq[seqIdx % knownSeq.length];
        seqIdx++;
      } else {
        // Non-empty (user-typed): sync sequence position to this name
        const pos = knownSeq.indexOf(result[i]);
        if (pos !== -1) {
          seqIdx = pos + 1;
        } else {
          seqIdx++;
        }
      }
    }
    return result;
  }, []);

  // Build the global known sequence by scanning ALL pages for the first one that
  // has a complete sequence in its first system.
  const buildGlobalKnownSequence = useCallback((allNames, allDividers, allSystemFlags) => {
    const pageCount = scoreMetadata?.page_count || 0;
    for (let p = 0; p < pageCount; p++) {
      const divs = allDividers[p];
      const sysFlags = allSystemFlags[p];
      const names = allNames[p];
      if (!divs || divs.length < 2 || !names) continue;
      const pageStrips = deriveStrips(divs, sysFlags);
      const seq = buildKnownSequence(names, pageStrips);
      if (seq.length > 0) return seq;
    }
    return [];
  }, [scoreMetadata, deriveStrips, buildKnownSequence]);

  const autoFillStripNames = useCallback((names, currentStrips, editedIndex) => {
    const knownNames = buildKnownSequence(names, currentStrips);
    if (knownNames.length === 0) return names;

    const editedName = names[editedIndex];
    let seqIndex = knownNames.indexOf(editedName);
    if (seqIndex === -1) return names;

    const result = [...names];
    for (let i = editedIndex + 1; i < currentStrips.length; i++) {
      if (currentStrips[i].isSystemStart) {
        seqIndex = -1;
      }
      seqIndex++;
      result[i] = knownNames[seqIndex % knownNames.length];
    }
    return result;
  }, [buildKnownSequence]);

  // --- Helper: get the most recently confirmed page's dividers ---
  const getLatestConfirmedDividers = useCallback((beforePage) => {
    for (let i = beforePage - 1; i >= 0; i--) {
      if (confirmedPages.has(i)) {
        return dividersByPage[i] || [];
      }
    }
    return dividersByPage[0] || [];
  }, [confirmedPages, dividersByPage]);

  const getLatestConfirmedStripNames = useCallback((beforePage) => {
    for (let i = beforePage - 1; i >= 0; i--) {
      if (confirmedPages.has(i)) {
        return stripNamesByPage[i] || [];
      }
    }
    return stripNamesByPage[0] || [];
  }, [confirmedPages, stripNamesByPage]);

  const getLatestConfirmedSystemDividers = useCallback((beforePage) => {
    for (let i = beforePage - 1; i >= 0; i--) {
      if (confirmedPages.has(i)) {
        return systemDividersByPage[i] || [];
      }
    }
    return systemDividersByPage[0] || [];
  }, [confirmedPages, systemDividersByPage]);

  // --- Helper: update current page's dividers and mark as confirmed ---
  const updateCurrentPageDividers = useCallback((updater) => {
    setDividersByPage(prev => ({
      ...prev,
      [currentPage]: updater(prev[currentPage] || []),
    }));
    setConfirmedPages(prev => new Set(prev).add(currentPage));
  }, [currentPage]);

  // --- Upload handler ---
  const handleUpload = async (file) => {
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please select a PDF file.');
      return;
    }

    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || `Upload failed: ${response.status}`);
      }

      const data = await response.json();
      setScoreId(data.score_id);
      setScoreMetadata({ page_count: data.page_count, pages: data.pages });
      setCurrentPage(0);

      const initialDividers = {};
      const initialStripNames = {};
      const initialSystemDividers = {};
      for (let i = 0; i < data.page_count; i++) {
        initialDividers[i] = [];
        initialStripNames[i] = [];
        initialSystemDividers[i] = [];
      }
      setDividersByPage(initialDividers);
      setStripNamesByPage(initialStripNames);
      setSystemDividersByPage(initialSystemDividers);
      setConfirmedPages(new Set());
      setDetectedPages(new Set());
      setDetectingPage(null);
      setDetectionWarnings({});
      setExportResult(null);
      // Reset prevPageWidthRef so rescaling doesn't trigger on fresh upload
      prevPageWidthRef.current = null;

      setPageImageUrl(`/api/scores/${data.score_id}/pages/0`);
      setPhase('edit');
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  // --- Page navigation ---
  const goToPage = useCallback((pageNum) => {
    if (!scoreMetadata || pageNum < 0 || pageNum >= scoreMetadata.page_count) return;

    // Propagate dividers from the latest confirmed page — but only when
    // auto-detect is off (or the page already has dividers from detection).
    // When auto-detect is on and the page is fresh, let detection fill it.
    const pageHasDividers = dividersByPage[pageNum]?.length > 0;
    const shouldPropagate = !confirmedPages.has(pageNum)
      && !pageHasDividers
      && !autoDetect;

    if (shouldPropagate) {
      const latestDividers = getLatestConfirmedDividers(pageNum);
      const latestSystemDividers = getLatestConfirmedSystemDividers(pageNum);

      // Pre-compute the target dividers/flags for this page so all setters
      // use consistent values (avoids stale closure reads).
      const targetDividers = dividersByPage[pageNum]?.length ? dividersByPage[pageNum] : latestDividers;
      const targetSysFlags = dividersByPage[pageNum]?.length ? (systemDividersByPage[pageNum] || []) : latestSystemDividers;

      setDividersByPage(prev => ({
        ...prev,
        [pageNum]: prev[pageNum]?.length ? prev[pageNum] : [...latestDividers],
      }));
      setSystemDividersByPage(prev => ({
        ...prev,
        [pageNum]: prev[pageNum]?.length ? prev[pageNum] : [...latestSystemDividers],
      }));
      setStripNamesByPage(prev => {
        const pageStrips = deriveStrips(targetDividers, targetSysFlags);

        // Try global sequence first, fall back to latest confirmed page's names.
        // Use targetDividers/targetSysFlags for all pages to stay consistent.
        const allDividers = { ...dividersByPage, [pageNum]: targetDividers };
        const allSysFlags = { ...systemDividersByPage, [pageNum]: targetSysFlags };
        const globalSeq = buildGlobalKnownSequence(prev, allDividers, allSysFlags);
        let filledNames;
        if (globalSeq.length > 0 && pageStrips.length > 0) {
          filledNames = fillPageNames(prev[pageNum] || [], pageStrips, globalSeq);
        } else {
          const latestNames = getLatestConfirmedStripNames(pageNum);
          filledNames = [...latestNames];
        }

        return {
          ...prev,
          [pageNum]: prev[pageNum]?.length ? prev[pageNum] : filledNames,
        };
      });
    }

    setCurrentPage(pageNum);
    setPageImageUrl(`/api/scores/${scoreId}/pages/${pageNum}`);
  }, [scoreMetadata, scoreId, confirmedPages, autoDetect, getLatestConfirmedDividers, getLatestConfirmedStripNames, getLatestConfirmedSystemDividers, dividersByPage, systemDividersByPage, deriveStrips, buildGlobalKnownSequence, fillPageNames]);

  // --- Staff detection ---
  const detectStavesForPage = useCallback(async (pageNum) => {
    // Skip if already detected, already confirmed, currently detecting, or dividers present
    if (detectedPages.has(pageNum) || confirmedPages.has(pageNum)) return;
    if (detectingPage !== null) return;
    if (dividersByPage[pageNum]?.length > 0) return;

    // Capture the pageWidth at request time so we can rescale if it changed
    const requestWidth = pageWidth;
    setDetectingPage(pageNum);

    try {
      const response = await fetch(`/api/scores/${scoreId}/pages/${pageNum}/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_width: requestWidth }),
      });

      if (!response.ok) {
        console.warn(`Detection failed for page ${pageNum}`);
        setDetectedPages(prev => new Set(prev).add(pageNum));
        return;
      }

      const data = await response.json();

      if (data.confidence < 0.3 || data.dividers.length < 2) {
        setDetectionWarnings(prev => ({
          ...prev,
          [pageNum]: 'Auto-detection could not find staves on this page.',
        }));
        setDetectedPages(prev => new Set(prev).add(pageNum));
        return;
      }

      if (data.confidence < 0.7) {
        setDetectionWarnings(prev => ({
          ...prev,
          [pageNum]: `Low-confidence detection (${Math.round(data.confidence * 100)}%) \u2014 please review.`,
        }));
      }

      // Rescale if pageWidth changed while the request was in flight.
      // prevPageWidthRef tracks the current display width that all dividers
      // are calibrated to — use it as the ground truth for the current scale.
      const currentWidth = prevPageWidthRef.current || requestWidth;
      const ratio = currentWidth / requestWidth;
      const dividers = ratio === 1
        ? data.dividers
        : data.dividers.map(d => Math.round(d * ratio));

      // Populate dividers only if page still has none (race-condition guard)
      setDividersByPage(prev => {
        if (prev[pageNum]?.length > 0) return prev;
        return { ...prev, [pageNum]: dividers };
      });
      setSystemDividersByPage(prev => {
        if (prev[pageNum]?.length > 0) return prev;
        return { ...prev, [pageNum]: data.system_flags };
      });
      // Auto-fill strip names from the global known sequence
      setStripNamesByPage(prev => {
        if (prev[pageNum]?.length > 0) return prev;
        const pageStrips = deriveStrips(dividers, data.system_flags);
        const globalSeq = buildGlobalKnownSequence(prev, dividersByPage, systemDividersByPage);
        if (globalSeq.length > 0 && pageStrips.length > 0) {
          return { ...prev, [pageNum]: fillPageNames([], pageStrips, globalSeq) };
        }
        return { ...prev, [pageNum]: data.strip_names };
      });

      // Mark as detected but NOT confirmed — user must review
      setDetectedPages(prev => new Set(prev).add(pageNum));
    } catch (err) {
      console.warn(`Detection request failed for page ${pageNum}:`, err);
      setDetectedPages(prev => new Set(prev).add(pageNum));
    } finally {
      setDetectingPage(null);
    }
  }, [scoreId, pageWidth, detectedPages, confirmedPages, detectingPage, dividersByPage, systemDividersByPage, deriveStrips, buildGlobalKnownSequence, fillPageNames]);

  // Trigger detection when a page is viewed in edit mode and pageWidth is ready
  useEffect(() => {
    if (autoDetect && phase === 'edit' && scoreId && pageWidth > 1) {
      detectStavesForPage(currentPage);
    }
  }, [autoDetect, phase, scoreId, pageWidth, currentPage, detectStavesForPage]);

  // --- Divider management ---
  const addDividerAtY = (y, isSystem = false) => {
    // Both setters independently compute insertIdx from y against their
    // own prev state. This avoids stale-closure issues without nesting
    // setters (which causes double-execution in StrictMode).
    setDividersByPage(prev => {
      const divs = prev[currentPage] || [];
      let insertIdx = 0;
      while (insertIdx < divs.length && divs[insertIdx] < y) insertIdx++;
      const newDividers = [...divs];
      newDividers.splice(insertIdx, 0, y);

      // Nested to avoid stale-closure read of dividersByPage for insertIdx
      setSystemDividersByPage(flagsPrev => {
        const flags = [...(flagsPrev[currentPage] || [])];
        flags.splice(insertIdx, 0, isSystem);
        return { ...flagsPrev, [currentPage]: flags };
      });

      return { ...prev, [currentPage]: newDividers };
    });
    setSystemDividersByPage(prev => {
      // Compute insertIdx from the dividers for this page (read from
      // dividersByPage which is the current render's snapshot — matches
      // the array that setDividersByPage's updater will also see).
      const divs = dividersByPage[currentPage] || [];
      let insertIdx = 0;
      while (insertIdx < divs.length && divs[insertIdx] < y) insertIdx++;
      const flags = [...(prev[currentPage] || [])];
      flags.splice(insertIdx, 0, isSystem);
      return { ...prev, [currentPage]: flags };
    });
    // Insert an empty name for the new strip and auto-fill using the
    // known sequence. We recompute new dividers/flags from the render
    // snapshot (same values the setters above will produce).
    setStripNamesByPage(prev => {
      const divs = dividersByPage[currentPage] || [];
      let insertIdx = 0;
      while (insertIdx < divs.length && divs[insertIdx] < y) insertIdx++;

      const newDividers = [...divs];
      newDividers.splice(insertIdx, 0, y);
      const oldFlags = systemDividersByPage[currentPage] || [];
      const newFlags = [...oldFlags];
      newFlags.splice(insertIdx, 0, isSystem);

      const oldStrips = deriveStrips(divs, oldFlags);
      const newStrips = deriveStrips(newDividers, newFlags);

      // Map old names onto new strip positions: match by old strip's
      // start position so names stay with their original strip.
      const oldNames = prev[currentPage] || [];
      const names = new Array(newStrips.length).fill('');
      let oldIdx = 0;
      for (let i = 0; i < newStrips.length && oldIdx < oldStrips.length; i++) {
        if (newStrips[i].start === oldStrips[oldIdx].start &&
            newStrips[i].end === oldStrips[oldIdx].end) {
          names[i] = oldNames[oldIdx] || '';
          oldIdx++;
        }
      }

      // Auto-fill empty slots using the global known sequence
      const allDividers = { ...dividersByPage, [currentPage]: newDividers };
      const allSysFlags = { ...systemDividersByPage, [currentPage]: newFlags };
      const globalSeq = buildGlobalKnownSequence(prev, allDividers, allSysFlags);
      if (globalSeq.length > 0) {
        return { ...prev, [currentPage]: fillPageNames(names, newStrips, globalSeq) };
      }
      return { ...prev, [currentPage]: names };
    });
    setConfirmedPages(prev => new Set(prev).add(currentPage));
  };

  const addDivider = () => {
    const divs = currentDividers;
    let newY;
    if (divs.length === 0) {
      newY = pageHeight / 3;
    } else {
      const lastDivider = Math.max(...divs);
      newY = Math.min(lastDivider + 60, pageHeight - 20);
    }
    addDividerAtY(newY, false);
  };

  const isRectSelecting = isSelectingHeader || isSelectingMarking;

  const suppressNextClick = useRef(false);

  const handleContainerClick = (e) => {
    if (dragIndex !== -1 || isRectSelecting || suppressNextClick.current) {
      suppressNextClick.current = false;
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    addDividerAtY(clickY, e.shiftKey);
  };

  // --- Shared rectangle selection drag handlers ---
  const handleRectMouseDown = (e) => {
    if (!isRectSelecting) return;
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    const start = {
      x: Math.max(0, Math.min(e.clientX - rect.left, pageWidth)),
      y: Math.max(0, Math.min(e.clientY - rect.top, pageHeight)),
    };
    setRectDragStart(start);
    setRectDragCurrent(start);
  };

  const handleRectMouseMove = useCallback((e) => {
    if (!rectDragStart) return;
    const rect = containerRef.current.getBoundingClientRect();
    setRectDragCurrent({
      x: Math.max(0, Math.min(e.clientX - rect.left, pageWidth)),
      y: Math.max(0, Math.min(e.clientY - rect.top, pageHeight)),
    });
  }, [rectDragStart, pageWidth, pageHeight]);

  const handleRectMouseUp = useCallback(() => {
    if (!rectDragStart || !rectDragCurrent) return;
    suppressNextClick.current = true;
    const x = Math.min(rectDragStart.x, rectDragCurrent.x);
    const y = Math.min(rectDragStart.y, rectDragCurrent.y);
    const w = Math.abs(rectDragCurrent.x - rectDragStart.x);
    const h = Math.abs(rectDragCurrent.y - rectDragStart.y);
    if (w > 5 && h > 5) {
      const region = { page: currentPage, x, y, w, h };
      if (isSelectingHeader) {
        setHeaderRegion(region);
        setIsSelectingHeader(false);
      } else if (isSelectingMarking) {
        setMarkings(prev => [...prev, region]);
        setIsSelectingMarking(false);
      }
    }
    setRectDragStart(null);
    setRectDragCurrent(null);
  }, [rectDragStart, rectDragCurrent, currentPage, isSelectingHeader, isSelectingMarking]);

  useEffect(() => {
    if (rectDragStart) {
      document.addEventListener('mousemove', handleRectMouseMove);
      document.addEventListener('mouseup', handleRectMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleRectMouseMove);
        document.removeEventListener('mouseup', handleRectMouseUp);
      };
    }
  }, [rectDragStart, handleRectMouseMove, handleRectMouseUp]);

  // --- Keyboard shortcuts for header (H) and marking (M) selection ---
  useEffect(() => {
    if (phase !== 'edit') return;
    const handleKeyDown = (e) => {
      // Ignore when typing in an input/textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'h' || e.key === 'H') {
        setIsSelectingHeader(prev => !prev);
        setIsSelectingMarking(false);
      } else if (e.key === 'm' || e.key === 'M') {
        setIsSelectingMarking(prev => !prev);
        setIsSelectingHeader(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [phase]);

  const rectPreview = rectDragStart && rectDragCurrent ? {
    x: Math.min(rectDragStart.x, rectDragCurrent.x),
    y: Math.min(rectDragStart.y, rectDragCurrent.y),
    w: Math.abs(rectDragCurrent.x - rectDragStart.x),
    h: Math.abs(rectDragCurrent.y - rectDragStart.y),
  } : null;

  const removeDivider = (index) => {
    updateCurrentPageDividers(prev => prev.filter((_, i) => i !== index));
    setSystemDividersByPage(prev => {
      const flags = [...(prev[currentPage] || [])];
      flags.splice(index, 1);
      return { ...prev, [currentPage]: flags };
    });
    setStripNamesByPage(prev => {
      const names = [...(prev[currentPage] || [])];
      const divCount = currentDividers.length;
      let removeIdx;
      if (index === 0) {
        removeIdx = 0;
      } else if (index === divCount - 1) {
        removeIdx = divCount - 2;
      } else {
        removeIdx = index;
      }
      if (removeIdx >= 0 && removeIdx < names.length) {
        names.splice(removeIdx, 1);
      }
      return { ...prev, [currentPage]: names };
    });
  };

  const updateStripName = (stripIndex, name) => {
    setStripNamesByPage(prev => {
      const names = [...(prev[currentPage] || [])];
      names[stripIndex] = name;
      return { ...prev, [currentPage]: names };
    });
    setConfirmedPages(prev => new Set(prev).add(currentPage));
  };

  const handleStripNameBlur = (stripIndex) => {
    setStripNamesByPage(prev => {
      const names = [...(prev[currentPage] || [])];
      const filled = autoFillStripNames(names, strips, stripIndex);
      return { ...prev, [currentPage]: filled };
    });
  };

  // --- Drag handling ---
  const handleMouseDown = (e, index) => {
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    setDragIndex(index);
    setDragOffset(mouseY - currentDividers[index]);
  };

  const handleMouseMove = useCallback((e) => {
    if (dragIndex === -1) return;

    const rect = containerRef.current.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    const newY = mouseY - dragOffset;

    const divs = dividersByPage[currentPage] || [];
    const minY = dragIndex === 0 ? 12 : divs[dragIndex - 1] + 12;
    const maxY = dragIndex === divs.length - 1 ? pageHeight - 12 : divs[dragIndex + 1] - 12;

    const constrainedY = Math.max(minY, Math.min(maxY, newY));

    updateCurrentPageDividers(prev => {
      const newDividers = [...prev];
      newDividers[dragIndex] = constrainedY;
      return newDividers;
    });
  }, [dragIndex, dragOffset, dividersByPage, currentPage, pageHeight, updateCurrentPageDividers]);

  const handleMouseUp = useCallback(() => {
    setDragIndex(-1);
    setDragOffset(0);
  }, []);

  useEffect(() => {
    if (dragIndex !== -1) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [dragIndex, handleMouseMove, handleMouseUp]);

  // --- Export handler ---
  const handleExport = async () => {
    const unconfirmedCount = scoreMetadata.page_count - confirmedPages.size;
    if (unconfirmedCount > 0) {
      const proceed = window.confirm(
        `${unconfirmedCount} page(s) have not been reviewed. Proceed with export?`
      );
      if (!proceed) return;
    }

    setPhase('exporting');
    setError(null);

    // Build global known sequence and fill all pages before sending
    const globalSeq = buildGlobalKnownSequence(stripNamesByPage, dividersByPage, systemDividersByPage);

    const pagesPayload = {};
    for (let i = 0; i < scoreMetadata.page_count; i++) {
      const dividers = dividersByPage[i] || dividersByPage[0] || [];
      const systemFlags = systemDividersByPage[i] || systemDividersByPage[0] || [];
      let names = stripNamesByPage[i] || stripNamesByPage[0] || [];

      if (dividers.length < 2) continue;

      // Apply global auto-fill to ensure all strips are named
      if (globalSeq.length > 0) {
        const pageStrips = deriveStrips(dividers, systemFlags);
        names = fillPageNames(names, pageStrips, globalSeq);
      }

      const stripNames = [];
      let realIdx = 0;
      for (let j = 0; j < dividers.length - 1; j++) {
        if (systemFlags[j + 1]) {
          stripNames.push("");
        } else {
          stripNames.push(names[realIdx] || "");
          realIdx++;
        }
      }

      pagesPayload[String(i)] = {
        dividers: [...dividers],
        system_flags: [...systemFlags],
        strip_names: stripNames,
      };
    }

    try {
      const response = await fetch(`/api/scores/${scoreId}/partition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_width: pageWidth,
          ...(headerRegion ? { header: headerRegion } : {}),
          ...(markings.length > 0 ? { markings } : {}),
          pages: pagesPayload,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || `Partition failed: ${response.status}`);
      }

      const data = await response.json();
      setPreviewData(data.parts);
      // Initialize per-part adjustment state
      const initSpacing = {};
      const initOffsets = {};
      const initBreaks = {};
      for (const part of data.parts) {
        initSpacing[part.name] = part.layout.default_spacing_px;
        initOffsets[part.name] = new Array(part.staves_count).fill(0);
        initBreaks[part.name] = new Set();
      }
      setSpacingByPart(initSpacing);
      setOffsetsByPart(initOffsets);
      setPageBreaksByPart(initBreaks);
      setSelectedPartIndex(0);
      setPhase('preview');
    } catch (err) {
      setError(err.message);
      setPhase('edit');
    }
  };

  // --- Generate handler (from preview phase) ---
  const handleGenerate = async () => {
    if (!previewData) return;
    setPhase('generating');
    setError(null);

    const partsPayload = {};
    for (const part of previewData) {
      const spacingPx = spacingByPart[part.name] ?? part.layout.default_spacing_px;
      const spacingMm = spacingPx * 25.4 / 300;
      const offsets = offsetsByPart[part.name] || new Array(part.staves_count).fill(0);
      const breaks = pageBreaksByPart[part.name] || new Set();
      partsPayload[part.name] = {
        spacing_mm: Math.round(spacingMm * 10) / 10,
        offsets: offsets,
        page_breaks_after: [...breaks],
      };
    }

    try {
      const response = await fetch(`/api/scores/${scoreId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parts: partsPayload }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || `Generate failed: ${response.status}`);
      }

      const data = await response.json();
      setExportResult(data.parts);
      setPhase('edit');
    } catch (err) {
      setError(err.message);
      setPhase('preview');
    }
  };

  // --- Render: Upload phase ---
  if (phase === 'upload') {
    return <UploadScreen onUpload={handleUpload} uploading={uploading} error={error} />;
  }

  // --- Render: Preview / Generating phase ---
  if (phase === 'preview' || phase === 'generating') {
    return (
      <LayoutPreview
        scoreId={scoreId}
        previewData={previewData}
        spacingByPart={spacingByPart}
        offsetsByPart={offsetsByPart}
        pageBreaksByPart={pageBreaksByPart}
        selectedPartIndex={selectedPartIndex}
        onSelectPart={setSelectedPartIndex}
        onSpacingChange={(partName, val) => setSpacingByPart(prev => ({ ...prev, [partName]: val }))}
        onOffsetsChange={(partName, offsets) => setOffsetsByPart(prev => ({ ...prev, [partName]: offsets }))}
        onPageBreaksChange={(partName, breaks) => setPageBreaksByPart(prev => ({ ...prev, [partName]: breaks }))}
        onResetPart={(partName, defaultSpacing) => {
          const part = previewData.find(p => p.name === partName);
          setSpacingByPart(prev => ({ ...prev, [partName]: defaultSpacing }));
          setOffsetsByPart(prev => ({ ...prev, [partName]: new Array(part.staves_count).fill(0) }));
          setPageBreaksByPart(prev => ({ ...prev, [partName]: new Set() }));
        }}
        onBackToEdit={() => setPhase('edit')}
        onGenerate={handleGenerate}
        isGenerating={phase === 'generating'}
        error={error}
        onClearError={() => setError(null)}
      />
    );
  }

  // --- Render: Edit / Exporting phase ---
  return (
    <div className="flex flex-col h-screen bg-surface-bg">
      <div className="max-w-screen-xl mx-auto w-full flex flex-col min-h-0 flex-1 px-6 pt-4 pb-2">
        <div className="bg-surface-card rounded-md shadow-sm border border-surface-border px-6 pt-4 pb-3 flex flex-col min-h-0 flex-1">
          {/* Header */}
          <Toolbar
            onNewScore={() => {
              setPhase('upload');
              setScoreId(null);
              setScoreMetadata(null);
              setExportResult(null);
              setError(null);
            }}
            onAddDivider={addDivider}
            onExport={handleExport}
            onToggleSelectHeader={() => { setIsSelectingHeader(!isSelectingHeader); setIsSelectingMarking(false); }}
            onToggleSelectMarking={() => { setIsSelectingMarking(!isSelectingMarking); setIsSelectingHeader(false); }}
            isRectSelecting={isRectSelecting}
            isSelectingHeader={isSelectingHeader}
            isSelectingMarking={isSelectingMarking}
            hasHeader={!!headerRegion}
            markingCount={markings.length}
            isExporting={phase === 'exporting'}
            stripCount={strips.length}
            autoDetect={autoDetect}
            onToggleAutoDetect={() => setAutoDetect(prev => !prev)}
          />

          {/* Error banner */}
          {error && (
            <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-md flex items-center justify-between">
              <span className="text-danger">{error}</span>
              <button onClick={() => setError(null)} className="text-danger hover:text-red-700 font-bold">
                ×
              </button>
            </div>
          )}

          {/* Sheet music container — fits viewport */}
          <div ref={scoreAreaRef} className="flex items-start gap-4 min-h-0 flex-1 overflow-hidden">
            {/* Part names column */}
            <StripNamesColumn
              strips={strips}
              stripNames={currentStripNames}
              pageHeight={pageHeight}
              onUpdateName={updateStripName}
              onBlurName={handleStripNameBlur}
            />

            {/* Sheet music */}
            <ScoreCanvas
              pageWidth={pageWidth}
              pageHeight={pageHeight}
              pageImageUrl={pageImageUrl}
              currentPage={currentPage}
              dividers={currentDividers}
              systemDividers={currentSystemDividers}
              strips={strips}
              stripNames={currentStripNames}
              onRemoveDivider={removeDivider}
              onDividerMouseDown={handleMouseDown}
              onContainerClick={handleContainerClick}
              onRectMouseDown={handleRectMouseDown}
              rectPreview={rectPreview}
              isSelectingHeader={isSelectingHeader}
              headerRegion={headerRegion}
              onClearHeader={() => setHeaderRegion(null)}
              markings={markings}
              onRemoveMarking={(idx) => setMarkings(prev => prev.filter((_, j) => j !== idx))}
              containerRef={containerRef}
              isRectSelecting={isRectSelecting}
              isDetecting={detectingPage === currentPage}
              detectionWarning={detectionWarnings[currentPage] || null}
            />

            {/* Annotations sidebar */}
            <AnnotationsPanel
              headerRegion={headerRegion}
              onClearHeader={() => setHeaderRegion(null)}
              markings={markings}
              onRemoveMarking={(idx) => setMarkings(prev => prev.filter((_, j) => j !== idx))}
              onClearMarkings={() => setMarkings([])}
            />
          </div>

          {/* Page navigation */}
          <PageNavigation
            currentPage={currentPage}
            pageCount={scoreMetadata?.page_count || 0}
            confirmedPages={confirmedPages}
            detectedPages={detectedPages}
            onGoToPage={goToPage}
          />

          {/* Status info */}
          <div className="mt-2 text-center text-xs text-gray-400">
            {currentDividers.length} dividers, {strips.length} parts • Click to add divider, Shift+click for system divider • Type part names to auto-fill • <kbd className="px-1 py-0.5 bg-gray-200 rounded text-[10px]">H</kbd> header, <kbd className="px-1 py-0.5 bg-gray-200 rounded text-[10px]">M</kbd> marking
          </div>
        </div>
      </div>

      {/* Export results — fixed side panel, doesn't affect main layout */}
      {exportResult && (
        <div className="fixed top-4 right-4 w-64 z-30">
          <ExportResults
            parts={exportResult}
            scoreId={scoreId}
            onError={setError}
            onDismiss={() => setExportResult(null)}
          />
        </div>
      )}
    </div>
  );
};

export default MusicPartitioner;
