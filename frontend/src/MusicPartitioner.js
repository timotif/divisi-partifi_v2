import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import UploadScreen from './components/UploadScreen';
import ExportResults from './components/ExportResults';
import PageNavigation from './components/PageNavigation';
import Toolbar from './components/Toolbar';
import StripNamesColumn from './components/StripNamesColumn';
import ScoreCanvas from './components/ScoreCanvas';
import AnnotationsPanel from './components/AnnotationsPanel';
import LayoutPreview from './components/LayoutPreview';
import LibraryScreen from './components/LibraryScreen';
import { isPageInRange as isInRange, updateRange } from './utils/scoreRange';
import {
  pickMostCommonSequence,
  fillNames,
  pickSuggestionSequence,
  buildKnownSequence as buildSequence,
  autoFillNames,
  propagationStartIndex,
} from './utils/knownSequence';

const STRIP_COLUMN_WIDTH = 160;
const ANNOTATIONS_PANEL_WIDTH = 176; // w-44 = 11rem = 176px
const GAP = 16;
const MIN_PAGE_WIDTH = 400;

const MusicPartitioner = () => {
  // --- App lifecycle ---
  const [phase, setPhase] = useState('upload'); // 'upload' | 'library' | 'edit' | 'exporting' | 'preview' | 'generating'

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

  // --- Snap flags: per-page, parallel boolean array (true = snapped to clear row) ---
  // Only populated for auto-detected dividers; cleared when dividers are manually edited.
  const [snapFlagsByPage, setSnapFlagsByPage] = useState({});

  // --- Per-page strip names ---
  const [stripNamesByPage, setStripNamesByPage] = useState({});

  // --- Export results ---
  const [exportResult, setExportResult] = useState(null);

  // --- Staff detection state ---
  const [autoDetect, setAutoDetect] = useState(true);
  // Score page range (1-indexed, inclusive) — pages outside it are front matter,
  // blanks, or pre-extracted parts and are excluded from detection and export.
  const [scoreRange, setScoreRange] = useState({ from: 1, to: 1 });
  // { done, total } while a whole-document rescan runs; null otherwise.
  const [rescanProgress, setRescanProgress] = useState(null);
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

  // --- Library state ---
  const [libraryScores, setLibraryScores] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState(null);

  // --- Duplicate upload modal ---
  const [duplicateInfo, setDuplicateInfo] = useState(null); // { score_id, title, composer, pendingFile }

  // --- Auto-save version name (editable by user) ---
  const [autoSaveVersionName, setAutoSaveVersionName] = useState('Default');

  const containerRef = useRef(null);

  // --- Per-page undo stack ---
  // Each entry: { page, dividers, systemFlags, snapFlags, stripNames }
  // Capped at 20 entries to avoid unbounded memory use.
  const undoStackRef = useRef([]);
  const UNDO_LIMIT = 20;

  const pushUndo = useCallback((page) => {
    const entry = {
      page,
      dividers: [...(dividersByPage[page] || [])],
      systemFlags: [...(systemDividersByPage[page] || [])],
      snapFlags: [...(snapFlagsByPage[page] || [])],
      stripNames: [...(stripNamesByPage[page] || [])],
    };
    undoStackRef.current = [
      ...undoStackRef.current.slice(-(UNDO_LIMIT - 1)),
      entry,
    ];
  }, [dividersByPage, systemDividersByPage, snapFlagsByPage, stripNamesByPage]);

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

  // --- Current page dividers, strip names, system divider flags, and snap flags ---
  const currentDividers = dividersByPage[currentPage] || [];
  const currentStripNames = stripNamesByPage[currentPage] || [];
  const currentSystemDividers = systemDividersByPage[currentPage] || [];
  const currentSnapFlags = snapFlagsByPage[currentPage] || [];

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
  const buildKnownSequence = useCallback(
    (names, pageStrips) => buildSequence(names, pageStrips),
    []
  );

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

  // Fill empty strip names on a single page using a known sequence, restarting
  // it at each system divider. For non-empty names (user-typed), sync the
  // sequence position to that name so subsequent fills continue correctly.
  //
  // startIdx moves where each system starts in the sequence, for pages that
  // omit the opening instruments and so have no name of their own to resync on.
  const fillPageNames = useCallback(
    (names, pageStrips, knownSeq, startIdx) => fillNames(names, pageStrips, knownSeq, startIdx),
    []
  );

  // Build the global known sequence by letting every page vote for the sequence
  // it shows, then taking the most common one.
  //
  // This used to return the first page with any sequence, which let a single
  // unrepresentative page set the naming for the whole score. A real case: a
  // score whose opening page carries 7 instruments while the remaining 14 pages
  // carry 11. The 7-name sequence won on page order alone and then miscycled
  // across every later page, so names had to be retyped on each one. By vote,
  // the 11-name sequence wins 14-to-1 and 13 of 15 pages fill correctly.
  //
  // Ties break toward the longer sequence, then toward the earlier page: a
  // longer sequence names more strips, and a shorter one is usually a page
  // where fewer instruments happen to play.
  const buildGlobalKnownSequence = useCallback((allNames, allDividers, allSystemFlags) => {
    const pageCount = scoreMetadata?.page_count || 0;
    const perPage = [];

    for (let p = 0; p < pageCount; p++) {
      const divs = allDividers[p];
      const names = allNames[p];
      // Only pages inside the score range vote: front matter and pre-extracted
      // parts have their own unrelated layouts.
      //
      // And only pages the user has actually typed on. Auto-filled names are
      // this function's own output cycled back in: after one name is typed,
      // prefill writes it to every strip, buildKnownSequence stops at that
      // repeat, and the one-name sequence gets a majority over the page being
      // typed -- so the whole score locks onto the first name entered.
      if (!divs || divs.length < 2 || !names || !isInRange(p, scoreRange)
          || !confirmedPages.has(p)) {
        perPage.push([]);
        continue;
      }
      perPage.push(buildKnownSequence(names, deriveStrips(divs, allSystemFlags[p])));
    }

    return pickMostCommonSequence(perPage);
  }, [scoreMetadata, scoreRange, confirmedPages, deriveStrips, buildKnownSequence]);

  const autoFillStripNames = useCallback(
    (names, currentStrips, editedIndex, globalSeq = []) =>
      autoFillNames(names, currentStrips, editedIndex, globalSeq),
    []
  );

  // Sequence the ghost narrows against. See pickSuggestionSequence for why a
  // one-name page sequence must lose to the score-wide vote.
  const currentPageSequence = useMemo(() => {
    const pageSeq = buildKnownSequence(currentStripNames, strips);
    const globalSeq = buildGlobalKnownSequence(stripNamesByPage, dividersByPage, systemDividersByPage);
    return pickSuggestionSequence(pageSeq, globalSeq);
  }, [buildKnownSequence, currentStripNames, strips, buildGlobalKnownSequence, stripNamesByPage, dividersByPage, systemDividersByPage]);

  // --- Score range change handler (clamped, keeps from <= to) ---
  const handleChangeScoreRange = useCallback((field, rawValue) => {
    const pageCount = scoreMetadata?.page_count || 1;
    setScoreRange(prev => updateRange(prev, field, rawValue, pageCount));
  }, [scoreMetadata]);

  // --- Helper: is a 0-indexed page inside the score range? ---
  const isPageInRange = useCallback(
    (pageIdx) => isInRange(pageIdx, scoreRange),
    [scoreRange]
  );

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

  // --- Auto-save effect (debounced 2 seconds, fires during edit phase) ---
  useEffect(() => {
    if (!scoreId || phase !== 'edit') return;
    const timer = setTimeout(() => {
      const setupPayload = {
        dividersByPage,
        systemDividersByPage,
        snapFlagsByPage,
        stripNamesByPage,
        confirmedPages: [...confirmedPages],
        headerRegion,
        markings,
        spacingByPart,
        offsetsByPart,
        pageBreaksByPart: Object.fromEntries(
          Object.entries(pageBreaksByPart).map(([k, v]) => [k, [...v]])
        ),
        scoreRange,
      };
      fetch(`/api/scores/${scoreId}/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_width: pageWidth,
          version_name: autoSaveVersionName,
          setup: setupPayload,
        }),
      }).catch(err => console.warn('Auto-save failed:', err));
    }, 2000);
    return () => clearTimeout(timer);
  }, [
    scoreId, phase, pageWidth, autoSaveVersionName,
    dividersByPage, systemDividersByPage, snapFlagsByPage,
    stripNamesByPage, confirmedPages, headerRegion, markings,
    spacingByPart, offsetsByPart, pageBreaksByPart, scoreRange,
  ]);

  // --- Helpers: reset all editor state ---
  const _resetEditorState = (pageCount) => {
    const initialDividers = {};
    const initialStripNames = {};
    const initialSystemDividers = {};
    for (let i = 0; i < pageCount; i++) {
      initialDividers[i] = [];
      initialStripNames[i] = [];
      initialSystemDividers[i] = [];
    }
    setDividersByPage(initialDividers);
    setStripNamesByPage(initialStripNames);
    setSystemDividersByPage(initialSystemDividers);
    setSnapFlagsByPage({});
    undoStackRef.current = [];
    setConfirmedPages(new Set());
    setDetectedPages(new Set());
    setDetectingPage(null);
    setDetectionWarnings({});
    setHeaderRegion(null);
    setMarkings([]);
    setSpacingByPart({});
    setOffsetsByPart({});
    setPageBreaksByPart({});
    setExportResult(null);
    setScoreRange({ from: 1, to: Math.max(1, pageCount) });
    prevPageWidthRef.current = null;
  };

  // --- Upload handler ---
  const handleUpload = async (fileOrObj, forceUpload = false) => {
    const file        = fileOrObj?.file ?? fileOrObj;
    const title       = fileOrObj?.title ?? '';
    const composerObj = fileOrObj?.composerObj ?? null; // { composer_id, displayName } | null

    if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please select a PDF file.');
      return;
    }

    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);
    if (title) formData.append('title', title);
    // composer text is no longer sent; link is made via the composers endpoint below

    const url = forceUpload ? '/api/upload?force=1' : '/api/upload';

    try {
      const response = await fetch(url, {
        method: 'POST',
        body: formData,
      });

      // Duplicate detection
      if (response.status === 409) {
        const dupData = await response.json();
        setDuplicateInfo({ ...dupData, pendingFile: file });
        setUploading(false);
        return;
      }

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || `Upload failed: ${response.status}`);
      }

      const data = await response.json();

      // Link the selected/created composer (non-fatal if it fails)
      if (composerObj?.composer_id) {
        fetch(`/api/scores/${data.score_id}/composers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ composer_id: composerObj.composer_id }),
        }).catch(err => console.warn('Composer link failed:', err));
      }

      setScoreId(data.score_id);
      setScoreMetadata({ page_count: data.page_count, pages: data.pages });
      setCurrentPage(0);
      _resetEditorState(data.page_count);
      setAutoSaveVersionName('Default');

      setPageImageUrl(`/api/scores/${data.score_id}/pages/0`);
      setPhase('edit');
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  // --- Library handlers ---
  const handleOpenLibrary = async () => {
    setLibraryError(null);
    setLibraryLoading(true);
    setPhase('library');
    try {
      const res = await fetch('/api/library');
      if (!res.ok) throw new Error(`Failed to load library: ${res.status}`);
      const data = await res.json();
      setLibraryScores(data.scores);
    } catch (err) {
      setLibraryError(err.message);
    } finally {
      setLibraryLoading(false);
    }
  };

  const handleRestoreScore = async (restoredScoreId, versionName = null) => {
    setError(null);
    try {
      const versionParam = versionName ? `?version=${encodeURIComponent(versionName)}` : '';
      const res = await fetch(`/api/scores/${restoredScoreId}/setup${versionParam}`);
      if (!res.ok) throw new Error(`Failed to load score: ${res.status}`);
      const data = await res.json();

      // data.pages contains the backend page dimensions for rescaling
      const pages = data.pages || [];
      const pageCount = pages.length;
      if (pageCount === 0) throw new Error('Score has no pages');

      setScoreId(restoredScoreId);
      setScoreMetadata({ page_count: pageCount, pages });
      setCurrentPage(0);
      _resetEditorState(pageCount);
      setAutoSaveVersionName(data.version_name || 'Default');

      if (data.setup) {
        const s = data.setup;
        const savedDisplayWidth = data.display_width || pageWidth || 600;

        // Dividers are stored in display-pixel space at saved display width.
        // Rescaling happens later via the pageWidth effect once layout is measured.
        // We store them verbatim here; prevPageWidthRef drives automatic rescaling.
        // To bootstrap correctly: set prevPageWidthRef to savedDisplayWidth so the
        // rescale effect can compute the right ratio once pageWidth is measured.
        prevPageWidthRef.current = savedDisplayWidth;

        const restoreDividers = s.dividersByPage || {};
        const restoreSysFlags = s.systemDividersByPage || {};
        const restoreSnapFlags = s.snapFlagsByPage || {};
        const restoreNames = s.stripNamesByPage || {};

        // Convert string keys (JSON) back to integer-keyed objects expected by the rest of the code
        const toIntKeys = obj => {
          const out = {};
          for (const [k, v] of Object.entries(obj)) out[parseInt(k, 10)] = v;
          return out;
        };

        setDividersByPage(toIntKeys(restoreDividers));
        setSystemDividersByPage(toIntKeys(restoreSysFlags));
        setSnapFlagsByPage(toIntKeys(restoreSnapFlags));
        setStripNamesByPage(toIntKeys(restoreNames));
        setConfirmedPages(new Set((s.confirmedPages || []).map(Number)));
        setHeaderRegion(s.headerRegion || null);
        setMarkings(s.markings || []);
        setSpacingByPart(s.spacingByPart || {});
        setOffsetsByPart(s.offsetsByPart || {});

        // pageBreaksByPart: arrays in JSON → Sets in state
        const rawBreaks = s.pageBreaksByPart || {};
        const restoredBreaks = {};
        for (const [partName, arr] of Object.entries(rawBreaks)) {
          restoredBreaks[partName] = new Set(arr);
        }
        setPageBreaksByPart(restoredBreaks);

        // Setups saved before the score-range feature have no scoreRange:
        // fall back to the whole document so they behave as before.
        if (s.scoreRange && s.scoreRange.from && s.scoreRange.to) {
          setScoreRange(s.scoreRange);
        } else {
          setScoreRange({ from: 1, to: Math.max(1, pageCount) });
        }
      }

      // If generated parts exist, expose them for download
      if (data.generated_parts && data.generated_parts.length > 0) {
        setExportResult(data.generated_parts.map(p => ({
          name: p.name,
          short_name: p.name,
          page_count: p.page_count,
          staves_count: p.staves_count,
        })));
      }

      setPageImageUrl(`/api/scores/${restoredScoreId}/pages/0`);
      setPhase('edit');
    } catch (err) {
      setError(err.message);
      setPhase('upload');
    }
  };

  const handleDeleteScore = async (delScoreId) => {
    try {
      const res = await fetch(`/api/scores/${delScoreId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      setLibraryScores(prev => prev.filter(s => s.score_id !== delScoreId));
    } catch (err) {
      setLibraryError(err.message);
    }
  };

  const handleUpdateScore = (updatedScoreId, updated) => {
    setLibraryScores(prev =>
      prev.map(s => s.score_id === updatedScoreId ? { ...s, ...updated } : s)
    );
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
  // `force` bypasses the skip guards: used by "Rescan all", which has already
  // cleared page state and drives pages sequentially itself.
  const detectStavesForPage = useCallback(async (pageNum, force = false) => {
    if (!force) {
      // Skip if already detected, already confirmed, currently detecting, or dividers present
      if (detectedPages.has(pageNum) || confirmedPages.has(pageNum)) return;
      if (detectingPage !== null) return;
      if (dividersByPage[pageNum]?.length > 0) return;
    }

    setDetectingPage(pageNum);

    try {
      const response = await fetch(`/api/scores/${scoreId}/pages/${pageNum}/detect`, {
        method: 'POST',
      });

      if (!response.ok) {
        console.warn(`Detection failed for page ${pageNum}: HTTP ${response.status}`);
        setDetectionWarnings(prev => ({
          ...prev,
          [pageNum]: 'Auto-detection failed. You can add dividers manually.',
        }));
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

      const snapFlags = data.snap_flags || [];
      const snapFailCount = snapFlags.filter(f => f === false).length;

      if (data.confidence < 0.7) {
        setDetectionWarnings(prev => ({
          ...prev,
          [pageNum]: `Low-confidence detection (${Math.round(data.confidence * 100)}%) \u2014 please review.`,
        }));
      } else if (snapFailCount > 0) {
        setDetectionWarnings(prev => ({
          ...prev,
          [pageNum]: `${snapFailCount} divider${snapFailCount > 1 ? 's' : ''} couldn\u2019t snap to a clear gap \u2014 check for clipping.`,
        }));
      }

      // Convert backend-pixel dividers to display pixels.
      // Use prevPageWidthRef.current as the ground-truth current display width:
      // pageWidth in this closure may be stale if a ResizeObserver fired while
      // the request was in-flight (most likely on page 0 during initial load).
      const pageMeta = scoreMetadata?.pages?.[pageNum];
      const bw = pageMeta?.width || 1;
      const currentWidth = prevPageWidthRef.current || pageWidth;
      const scale = currentWidth / bw;
      const dividers = data.dividers.map(d => Math.round(d * scale));

      // Populate dividers only if page still has none (race-condition guard)
      setDividersByPage(prev => {
        if (prev[pageNum]?.length > 0) return prev;
        return { ...prev, [pageNum]: dividers };
      });
      setSystemDividersByPage(prev => {
        if (prev[pageNum]?.length > 0) return prev;
        return { ...prev, [pageNum]: data.system_flags };
      });
      setSnapFlagsByPage(prev => {
        if (prev[pageNum]?.length > 0) return prev;
        return { ...prev, [pageNum]: snapFlags };
      });
      // Auto-fill strip names from the global known sequence
      setStripNamesByPage(prev => {
        const pageStrips = deriveStrips(dividers, data.system_flags);
        // Bail only when the page already carries real names. Testing for a
        // non-empty array instead let a page detected before any naming keep
        // the empty strip_names detection wrote, and nothing filled it later.
        const existing = prev[pageNum] || [];
        if (pageStrips.length > 0 && pageStrips.every((_, i) => existing[i])) return prev;
        // Overlay this page's freshly detected geometry onto the closure
        // snapshot before voting: during a sequential rescan, dividersByPage
        // is the value captured when this callback was built and does not yet
        // include the page being detected.
        const allDividers = { ...dividersByPage, [pageNum]: dividers };
        const allSysFlags = { ...systemDividersByPage, [pageNum]: data.system_flags };
        const globalSeq = buildGlobalKnownSequence(prev, allDividers, allSysFlags);
        if (globalSeq.length > 0 && pageStrips.length > 0) {
          return { ...prev, [pageNum]: fillPageNames(existing, pageStrips, globalSeq) };
        }
        // No sequence yet: keep what the user has and take the backend's names
        // only for strips still empty.
        const merged = [...existing];
        (data.strip_names || []).forEach((n, i) => { if (!merged[i]) merged[i] = n; });
        return { ...prev, [pageNum]: merged };
      });

      // Mark as detected but NOT confirmed — user must review
      setDetectedPages(prev => new Set(prev).add(pageNum));
    } catch (err) {
      console.warn(`Detection request failed for page ${pageNum}:`, err);
      setDetectionWarnings(prev => ({
        ...prev,
        [pageNum]: 'Auto-detection failed. You can add dividers manually.',
      }));
      setDetectedPages(prev => new Set(prev).add(pageNum));
    } finally {
      setDetectingPage(null);
    }
  }, [scoreId, pageWidth, scoreMetadata, detectedPages, confirmedPages, detectingPage, dividersByPage, systemDividersByPage, deriveStrips, buildGlobalKnownSequence, fillPageNames]);

  // Trigger detection when a page is viewed in edit mode and pageWidth is ready
  useEffect(() => {
    // Skip out-of-range pages: running detection on title pages or pre-extracted
    // parts wastes a request and produces spurious dividers from text lines.
    if (autoDetect && phase === 'edit' && scoreId && pageWidth > 1 && isPageInRange(currentPage)) {
      detectStavesForPage(currentPage);
    }
  }, [autoDetect, phase, scoreId, pageWidth, currentPage, detectStavesForPage, isPageInRange]);

  // Force-rescan the current page: clear all detection state so the auto-detect
  // useEffect re-triggers. Intended to be called after user confirmation.
  const forceRescanPage = useCallback(() => {
    const p = currentPage;
    setDividersByPage(prev => ({ ...prev, [p]: [] }));
    setSystemDividersByPage(prev => ({ ...prev, [p]: [] }));
    setSnapFlagsByPage(prev => ({ ...prev, [p]: [] }));
    setStripNamesByPage(prev => ({ ...prev, [p]: [] }));
    setDetectionWarnings(prev => { const n = { ...prev }; delete n[p]; return n; });
    setDetectedPages(prev => { const s = new Set(prev); s.delete(p); return s; });
    setConfirmedPages(prev => { const s = new Set(prev); s.delete(p); return s; });
    // Detection re-triggers automatically via the useEffect above once state is cleared
  }, [currentPage]);

  // Clear every divider on the current page without re-running detection.
  // Marks the page as "detected" so the auto-detect effect does not immediately
  // repopulate it — the user asked for an empty page, so leave it empty.
  const clearPageDividers = useCallback(() => {
    const p = currentPage;
    pushUndo(p);
    setDividersByPage(prev => ({ ...prev, [p]: [] }));
    setSystemDividersByPage(prev => ({ ...prev, [p]: [] }));
    setSnapFlagsByPage(prev => ({ ...prev, [p]: [] }));
    setStripNamesByPage(prev => ({ ...prev, [p]: [] }));
    setDetectionWarnings(prev => { const n = { ...prev }; delete n[p]; return n; });
    setDetectedPages(prev => new Set(prev).add(p));
  }, [currentPage, pushUndo]);

  // Re-run detection across every page in the score range, sequentially.
  // Detection is serialized backend-side (one in-flight request at a time), so
  // pages are awaited one by one rather than fired in parallel.
  const rescanAllPages = useCallback(async () => {
    if (!scoreMetadata || !scoreId) return;
    const from = scoreRange.from - 1;
    const to = scoreRange.to - 1;

    // Clear state for the whole range up front so detection is not skipped by
    // the "already detected / dividers present" guards in detectStavesForPage.
    const cleared = {};
    for (let i = from; i <= to; i++) cleared[i] = [];
    setDividersByPage(prev => ({ ...prev, ...cleared }));
    setSystemDividersByPage(prev => ({ ...prev, ...cleared }));
    setSnapFlagsByPage(prev => ({ ...prev, ...cleared }));
    setStripNamesByPage(prev => ({ ...prev, ...cleared }));
    setDetectionWarnings({});
    setDetectedPages(prev => {
      const s = new Set(prev);
      for (let i = from; i <= to; i++) s.delete(i);
      return s;
    });
    setConfirmedPages(prev => {
      const s = new Set(prev);
      for (let i = from; i <= to; i++) s.delete(i);
      return s;
    });
    undoStackRef.current = [];

    setRescanProgress({ done: 0, total: to - from + 1 });
    for (let i = from; i <= to; i++) {
      // eslint-disable-next-line no-await-in-loop
      await detectStavesForPage(i, true);
      setRescanProgress({ done: i - from + 1, total: to - from + 1 });
    }
    setRescanProgress(null);
  }, [scoreMetadata, scoreId, scoreRange, detectStavesForPage]);

  // --- Divider management ---
  const addDividerAtY = (y, isSystem = false) => {
    pushUndo(currentPage);
    // Both setters independently compute insertIdx from y against their
    // own prev state. This avoids stale-closure issues without nesting
    // setters (which causes double-execution in StrictMode).
    setDividersByPage(prev => {
      const divs = prev[currentPage] || [];
      let insertIdx = 0;
      while (insertIdx < divs.length && divs[insertIdx] < y) insertIdx++;
      const newDividers = [...divs];
      newDividers.splice(insertIdx, 0, y);
      return { ...prev, [currentPage]: newDividers };
    });
    setSystemDividersByPage(prev => {
      const divs = dividersByPage[currentPage] || [];
      let insertIdx = 0;
      while (insertIdx < divs.length && divs[insertIdx] < y) insertIdx++;
      const flags = [...(prev[currentPage] || [])];
      flags.splice(insertIdx, 0, isSystem);
      return { ...prev, [currentPage]: flags };
    });
    setSnapFlagsByPage(prev => {
      const divs = dividersByPage[currentPage] || [];
      let insertIdx = 0;
      while (insertIdx < divs.length && divs[insertIdx] < y) insertIdx++;
      const flags = [...(prev[currentPage] || [])];
      flags.splice(insertIdx, 0, null);  // null = manual, no snap attempted
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

  // --- Keyboard shortcuts (edit phase) ---
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
      } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const stack = undoStackRef.current;
        if (stack.length === 0) return;
        const prev = stack[stack.length - 1];
        undoStackRef.current = stack.slice(0, -1);
        setDividersByPage(d => ({ ...d, [prev.page]: prev.dividers }));
        setSystemDividersByPage(f => ({ ...f, [prev.page]: prev.systemFlags }));
        setSnapFlagsByPage(s => ({ ...s, [prev.page]: prev.snapFlags }));
        setStripNamesByPage(n => ({ ...n, [prev.page]: prev.stripNames }));
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
    pushUndo(currentPage);
    updateCurrentPageDividers(prev => prev.filter((_, i) => i !== index));
    setSystemDividersByPage(prev => {
      const flags = [...(prev[currentPage] || [])];
      flags.splice(index, 1);
      return { ...prev, [currentPage]: flags };
    });
    setSnapFlagsByPage(prev => {
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

      // Built before this page is filled, so the fill can continue the score's
      // established order rather than only this page's own names. Auto-filled
      // names are excluded from the vote anyway (see buildGlobalKnownSequence),
      // so this page's prefill output cannot feed back into it.
      const globalSeq = buildGlobalKnownSequence(prev, dividersByPage, systemDividersByPage);

      const filled = autoFillStripNames(names, strips, stripIndex, globalSeq);
      const next = { ...prev, [currentPage]: filled };

      // Push the sequence out to every page the user has not touched.
      //
      // Detection runs when a page is first viewed, before any name exists to
      // build a sequence from, so it leaves the page unnamed and marks it done.
      // goToPage then skips it (auto-detect is on) and nothing fills it again.
      // Naming a strip here is the moment a sequence exists, so it is the
      // moment to propagate.
      //
      // Unconfirmed pages are re-filled from scratch, not just gap-filled: the
      // sequence grows as the user types, so a page seeded earlier from a
      // one-name sequence holds "vl1" on every strip and must be redone once
      // "vl2" exists. confirmedPages marks the pages the user typed on -- those
      // are theirs and are never overwritten.
      // Recomputed with this page included: naming a strip here may be what
      // extends the score-wide sequence in the first place.
      const propagateSeq = buildGlobalKnownSequence(next, dividersByPage, systemDividersByPage);
      if (propagateSeq.length === 0) return next;

      // Propagated pages start at the top of the sequence unless the typed
      // name says this ensemble opens mid-sequence. See propagationStartIndex.
      const startIdx = propagationStartIndex(
        filled[stripIndex], stripIndex, strips, propagateSeq,
      );

      const pageCount = scoreMetadata?.page_count || 0;
      for (let p = 0; p < pageCount; p++) {
        if (p === currentPage || !isInRange(p, scoreRange)) continue;
        if (confirmedPages.has(p)) continue;

        const divs = dividersByPage[p];
        if (!divs || divs.length < 2) continue;

        const pageStrips = deriveStrips(divs, systemDividersByPage[p]);
        if (pageStrips.length === 0) continue;

        next[p] = fillPageNames([], pageStrips, propagateSeq, startIdx);
      }
      return next;
    });
  };

  // --- Drag handling ---
  const handleMouseDown = (e, index) => {
    e.preventDefault();
    pushUndo(currentPage);
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
    if (dragIndex !== -1) {
      suppressNextClick.current = true;
    }
    setDragIndex(-1);
    setDragOffset(0);
  }, [dragIndex]);

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
    // Count only in-range pages: out-of-range pages are never partitioned,
    // so they should not trigger the review warning.
    const inRangeCount = scoreRange.to - scoreRange.from + 1;
    let confirmedInRange = 0;
    for (const p of confirmedPages) {
      if (isPageInRange(p)) confirmedInRange++;
    }
    const unconfirmedCount = inRangeCount - confirmedInRange;
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
    // Only pages inside the score range are partitioned; front matter, blanks
    // and pre-extracted parts are skipped entirely.
    const firstIdx = scoreRange.from - 1;
    for (let i = firstIdx; i <= scoreRange.to - 1; i++) {
      // Fall back to the first in-range page (not page 0, which may be a title page).
      const dividers = dividersByPage[i] || dividersByPage[firstIdx] || [];
      const systemFlags = systemDividersByPage[i] || systemDividersByPage[firstIdx] || [];
      let names = stripNamesByPage[i] || stripNamesByPage[firstIdx] || [];

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

  // --- Render: Library phase ---
  if (phase === 'library') {
    return (
      <LibraryScreen
        scores={libraryScores}
        loading={libraryLoading}
        error={libraryError}
        onRestore={handleRestoreScore}
        onDelete={handleDeleteScore}
        onUpdate={handleUpdateScore}
        onUpload={() => setPhase('upload')}
      />
    );
  }

  // --- Render: Upload phase ---
  if (phase === 'upload') {
    return (
      <>
        <UploadScreen
          onUpload={handleUpload}
          uploading={uploading}
          error={error}
          onOpenLibrary={handleOpenLibrary}
        />
        {/* Duplicate upload modal */}
        {duplicateInfo && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
              <h2 className="text-base font-semibold text-gray-800 mb-2">Already in library</h2>
              <p className="text-sm text-gray-600 mb-4">
                <strong>{duplicateInfo.title}</strong>
                {duplicateInfo.composer ? ` — ${duplicateInfo.composer}` : ''}
                {' '}is already saved. Open the existing score or upload as a new copy?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const info = duplicateInfo;
                    setDuplicateInfo(null);
                    handleRestoreScore(info.score_id);
                  }}
                  className="flex-1 px-3 py-2 bg-accent text-white rounded text-sm hover:bg-accent/80 transition-colors"
                >
                  Open existing
                </button>
                <button
                  onClick={() => {
                    const info = duplicateInfo;
                    setDuplicateInfo(null);
                    handleUpload(info.pendingFile, true);
                  }}
                  className="flex-1 px-3 py-2 border border-surface-border rounded text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Upload as new
                </button>
                <button
                  onClick={() => setDuplicateInfo(null)}
                  className="px-3 py-2 text-gray-400 hover:text-gray-600 text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
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
            onGoToLibrary={handleOpenLibrary}
            onAddDivider={addDivider}
            onExport={handleExport}
            scoreRange={scoreRange}
            onChangeScoreRange={handleChangeScoreRange}
            pageCount={scoreMetadata?.page_count || 0}
            onRescanAll={rescanAllPages}
            onClearPageDividers={clearPageDividers}
            hasDividersOnPage={currentDividers.length > 0}
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
            onForceRescan={forceRescanPage}
            isDetecting={detectingPage !== null || rescanProgress !== null}
            rescanProgress={rescanProgress}
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
              sequence={currentPageSequence}
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
              snapFlags={currentSnapFlags}
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
            isPageInRange={isPageInRange}
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
