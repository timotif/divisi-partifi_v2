import { useState, useRef, useCallback, useEffect } from 'react';
import UploadScreen from './components/UploadScreen';
import ExportResults from './components/ExportResults';
import PageNavigation from './components/PageNavigation';
import Toolbar from './components/Toolbar';
import StripNamesColumn from './components/StripNamesColumn';
import ScoreCanvas from './components/ScoreCanvas';

const STRIP_COLUMN_WIDTH = 160;
const GAP = 16;
const MIN_PAGE_WIDTH = 400;

const MusicPartitioner = () => {
  // --- App lifecycle ---
  const [phase, setPhase] = useState('upload'); // 'upload' | 'edit' | 'exporting'

  // --- Score metadata from backend ---
  const [scoreId, setScoreId] = useState(null);
  const [scoreMetadata, setScoreMetadata] = useState(null);

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
  const availableWidth = Math.max(MIN_PAGE_WIDTH, measuredSize.width - STRIP_COLUMN_WIDTH - GAP);
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
  const autoFillStripNames = useCallback((names, currentStrips, editedIndex) => {
    const stripCount = currentStrips.length;
    const knownNames = [];
    const seen = new Set();
    for (let i = 0; i < names.length && i < stripCount; i++) {
      if (i > 0 && currentStrips[i].isSystemStart) break;
      const name = names[i];
      if (name === undefined || name === '') break;
      if (seen.has(name)) break;
      seen.add(name);
      knownNames.push(name);
    }
    if (knownNames.length === 0) return names;

    const editedName = names[editedIndex];
    let seqIndex = knownNames.indexOf(editedName);
    if (seqIndex === -1) return names;

    const result = [...names];
    for (let i = editedIndex + 1; i < stripCount; i++) {
      if (currentStrips[i].isSystemStart) {
        seqIndex = -1;
      }
      seqIndex++;
      result[i] = knownNames[seqIndex % knownNames.length];
    }
    return result;
  }, []);

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

    if (!confirmedPages.has(pageNum)) {
      const latestDividers = getLatestConfirmedDividers(pageNum);
      const latestStripNames = getLatestConfirmedStripNames(pageNum);
      const latestSystemDividers = getLatestConfirmedSystemDividers(pageNum);

      const derivedStrips = [];
      for (let j = 0; j < latestDividers.length - 1; j++) {
        if (latestSystemDividers[j + 1]) continue;
        derivedStrips.push({
          start: latestDividers[j],
          end: latestDividers[j + 1],
          height: latestDividers[j + 1] - latestDividers[j],
          isSystemStart: !!latestSystemDividers[j],
        });
      }
      const filledNames = derivedStrips.length > 0
        ? autoFillStripNames([...latestStripNames], derivedStrips, 0)
        : [...latestStripNames];

      setDividersByPage(prev => ({
        ...prev,
        [pageNum]: prev[pageNum]?.length ? prev[pageNum] : [...latestDividers],
      }));
      setStripNamesByPage(prev => ({
        ...prev,
        [pageNum]: prev[pageNum]?.length ? prev[pageNum] : filledNames,
      }));
      setSystemDividersByPage(prev => ({
        ...prev,
        [pageNum]: prev[pageNum]?.length ? prev[pageNum] : [...latestSystemDividers],
      }));
    }

    setCurrentPage(pageNum);
    setPageImageUrl(`/api/scores/${scoreId}/pages/${pageNum}`);
  }, [scoreMetadata, scoreId, confirmedPages, getLatestConfirmedDividers, getLatestConfirmedStripNames, getLatestConfirmedSystemDividers, autoFillStripNames]);

  // --- Divider management ---
  const addDividerAtY = (y, isSystem = false) => {
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
    const minY = dragIndex === 0 ? 20 : divs[dragIndex - 1] + 20;
    const maxY = dragIndex === divs.length - 1 ? pageHeight - 20 : divs[dragIndex + 1] - 20;

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

    const pagesPayload = {};
    for (let i = 0; i < scoreMetadata.page_count; i++) {
      const dividers = dividersByPage[i] || dividersByPage[0] || [];
      const systemFlags = systemDividersByPage[i] || systemDividersByPage[0] || [];
      const names = stripNamesByPage[i] || stripNamesByPage[0] || [];

      if (dividers.length < 2) continue;

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
      setExportResult(data.parts);
      setPhase('edit');
    } catch (err) {
      setError(err.message);
      setPhase('edit');
    }
  };

  // --- Render: Upload phase ---
  if (phase === 'upload') {
    return <UploadScreen onUpload={handleUpload} uploading={uploading} error={error} />;
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
            onClearHeader={() => setHeaderRegion(null)}
            onToggleSelectMarking={() => { setIsSelectingMarking(!isSelectingMarking); setIsSelectingHeader(false); }}
            onClearMarkings={() => setMarkings([])}
            isRectSelecting={isRectSelecting}
            isSelectingHeader={isSelectingHeader}
            isSelectingMarking={isSelectingMarking}
            hasHeader={!!headerRegion}
            markingCount={markings.length}
            isExporting={phase === 'exporting'}
            stripCount={strips.length}
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
            />
          </div>

          {/* Page navigation */}
          <PageNavigation
            currentPage={currentPage}
            pageCount={scoreMetadata?.page_count || 0}
            confirmedPages={confirmedPages}
            onGoToPage={goToPage}
          />

          {/* Export results — download links */}
          {exportResult && (
            <ExportResults parts={exportResult} scoreId={scoreId} onError={setError} />
          )}

          {/* Status info */}
          <div className="mt-2 text-center text-xs text-gray-400">
            {currentDividers.length} dividers, {strips.length} parts • Click to add divider, Shift+click for system divider • Type part names to auto-fill
          </div>
        </div>
      </div>
    </div>
  );
};

export default MusicPartitioner;
