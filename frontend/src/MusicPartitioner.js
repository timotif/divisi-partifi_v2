import { useState, useRef, useCallback, useEffect } from 'react';
import UploadScreen from './components/UploadScreen';
import ExportResults from './components/ExportResults';
import PageNavigation from './components/PageNavigation';
import Toolbar from './components/Toolbar';
import StripNamesColumn from './components/StripNamesColumn';
import ScoreCanvas from './components/ScoreCanvas';

const MAX_DISPLAY_WIDTH = 600;

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
  // systemDividersByPage[pageNum][i] = true means dividersByPage[pageNum][i] is a system divider.
  // System dividers mark system boundaries (rendered in red). Regular dividers mark staves (blue).
  // Auto-fill resets at system dividers.
  const [systemDividersByPage, setSystemDividersByPage] = useState({});

  // --- Per-page strip names: { pageNum: ['Violin I', 'Violin II', ...] } ---
  // Each strip (gap between consecutive dividers) has its own name.
  const [stripNamesByPage, setStripNamesByPage] = useState({});

  // --- Export results ---
  const [exportResult, setExportResult] = useState(null);

  // --- Header region: rectangle selection for piece title ---
  const [headerRegion, setHeaderRegion] = useState(null); // { page, x, y, w, h } in display pixels
  const [isSelectingHeader, setIsSelectingHeader] = useState(false);

  // --- Score markings: multiple rectangle selections ---
  const [markings, setMarkings] = useState([]); // [{ page, x, y, w, h }]
  const [isSelectingMarking, setIsSelectingMarking] = useState(false);

  // --- Shared rectangle drag state (used by header and tempo selection) ---
  const [rectDragStart, setRectDragStart] = useState(null); // { x, y }
  const [rectDragCurrent, setRectDragCurrent] = useState(null); // { x, y }

  // --- UI state ---
  const [dragIndex, setDragIndex] = useState(-1);
  const [dragOffset, setDragOffset] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const containerRef = useRef(null);

  // --- Computed display dimensions ---
  const currentPageMeta = scoreMetadata?.pages?.[currentPage];
  const backendWidth = currentPageMeta?.width || 1;
  const backendHeight = currentPageMeta?.height || 1;
  const displayScale = MAX_DISPLAY_WIDTH / backendWidth;
  const pageWidth = MAX_DISPLAY_WIDTH;
  const pageHeight = Math.round(backendHeight * displayScale);

  // --- Current page dividers, strip names, and system divider flags ---
  const currentDividers = dividersByPage[currentPage] || [];
  const currentStripNames = stripNamesByPage[currentPage] || [];
  const currentSystemDividers = systemDividersByPage[currentPage] || [];

  // --- Strips computation ---
  // Strips form between consecutive dividers, EXCEPT:
  // - No strip between a part divider and the next system divider (dead space between systems)
  // A system divider is an upper bound: it's the top edge of the next system's first strip.
  const getStrips = useCallback(() => {
    if (currentDividers.length < 2) return [];
    // Dividers are already sorted. Walk pairs and create strips where appropriate.
    const strips = [];
    for (let j = 0; j < currentDividers.length - 1; j++) {
      const isTopSystem = !!currentSystemDividers[j];
      const isBotSystem = !!currentSystemDividers[j + 1];
      // Skip if the bottom divider is a system divider — that gap is dead space
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

  // --- Auto-fill: when user edits a strip and blurs, fill subsequent strips ---
  // The known sequence = first system's instrument order.
  // Sequence ends at the first name repeat OR at a system divider boundary.
  // Auto-fill finds the edited name in the sequence and continues cyclically,
  // resetting at each system divider.
  const autoFillStripNames = useCallback((names, currentStrips, editedIndex) => {
    const stripCount = currentStrips.length;
    // Build the known sequence: consecutive non-empty unique names from strip 0,
    // stopping at the first repeat or system divider
    const knownNames = [];
    const seen = new Set();
    for (let i = 0; i < names.length && i < stripCount; i++) {
      if (i > 0 && currentStrips[i].isSystemStart) break; // system divider = new system
      const name = names[i];
      if (name === undefined || name === '') break;
      if (seen.has(name)) break; // repeat = next system started
      seen.add(name);
      knownNames.push(name);
    }
    if (knownNames.length === 0) return names;

    // Find where the edited strip's name falls in the known sequence
    const editedName = names[editedIndex];
    let seqIndex = knownNames.indexOf(editedName);
    if (seqIndex === -1) return names; // name not in known sequence, don't auto-fill

    // Fill strips after editedIndex by continuing from seqIndex+1 in the cycle.
    // Reset the cycle at each system divider.
    const result = [...names];
    for (let i = editedIndex + 1; i < stripCount; i++) {
      if (currentStrips[i].isSystemStart) {
        // System divider: reset cycle to the beginning of the sequence
        seqIndex = -1;
      }
      seqIndex++;
      result[i] = knownNames[seqIndex % knownNames.length];
    }
    return result;
  }, []);

  // --- Helper: get the most recently confirmed page's dividers (before pageNum) ---
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

      // Build strips from propagated dividers/flags for autofill
      const derivedStrips = [];
      for (let j = 0; j < latestDividers.length - 1; j++) {
        if (latestSystemDividers[j + 1]) continue; // dead-space gap
        derivedStrips.push({
          start: latestDividers[j],
          end: latestDividers[j + 1],
          height: latestDividers[j + 1] - latestDividers[j],
          isSystemStart: !!latestSystemDividers[j],
        });
      }
      // Run autofill on propagated names so subsequent pages get filled names
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
    // Dividers are always kept sorted. Insert system flag at the matching sorted position.
    setDividersByPage(prev => {
      const divs = prev[currentPage] || [];
      // Find the sorted insertion index for y
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
    // Place new divider below the last existing one, or at 1/3 of the page if none exist
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
    // Don't add divider if we were dragging, in rect selection mode,
    // or if a rect drag just finished (mouseup resets the mode before click fires)
    if (dragIndex !== -1 || isRectSelecting || suppressNextClick.current) {
      suppressNextClick.current = false;
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    // Shift+click = system divider, regular click = part divider
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

  // Compute the preview rect from drag start/current
  const rectPreview = rectDragStart && rectDragCurrent ? {
    x: Math.min(rectDragStart.x, rectDragCurrent.x),
    y: Math.min(rectDragStart.y, rectDragCurrent.y),
    w: Math.abs(rectDragCurrent.x - rectDragStart.x),
    h: Math.abs(rectDragCurrent.y - rectDragStart.y),
  } : null;

  const removeDivider = (index) => {
    updateCurrentPageDividers(prev => prev.filter((_, i) => i !== index));
    // Remove the system divider flag at this index
    setSystemDividersByPage(prev => {
      const flags = [...(prev[currentPage] || [])];
      flags.splice(index, 1);
      return { ...prev, [currentPage]: flags };
    });
    // Remove the strip name corresponding to the deleted divider.
    // With N dividers there are N-1 strips. Strip j sits between divider j and divider j+1.
    // Deleting divider at index i:
    //   i === 0: strip 0 becomes dead space → remove name 0
    //   i === N-1 (last): strip N-2 becomes dead space → remove name N-2
    //   otherwise: strips i-1 and i merge → remove name i (keep upper strip's name)
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
    // Update only this strip on every keystroke (no auto-fill yet)
    setStripNamesByPage(prev => {
      const names = [...(prev[currentPage] || [])];
      names[stripIndex] = name;
      return { ...prev, [currentPage]: names };
    });
    setConfirmedPages(prev => new Set(prev).add(currentPage));
  };

  const handleStripNameBlur = (stripIndex) => {
    // On blur, auto-fill strips after this one by continuing from its position in the known sequence
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

    // Send raw markings — the backend handles coordinate conversion,
    // dead-space filtering, auto-fill, and part deduplication.
    const pagesPayload = {};
    for (let i = 0; i < scoreMetadata.page_count; i++) {
      const dividers = dividersByPage[i] || dividersByPage[0] || [];
      const systemFlags = systemDividersByPage[i] || systemDividersByPage[0] || [];
      const names = stripNamesByPage[i] || stripNamesByPage[0] || [];

      if (dividers.length < 2) continue;

      // strip_names: one entry per gap between consecutive dividers.
      // Dead-space gaps (where systemFlags[j+1] is true) get "".
      // Real strips map to stripNamesByPage entries by counting real strips seen.
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
          display_width: MAX_DISPLAY_WIDTH,
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
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-6">
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
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
              <span className="text-red-700">{error}</span>
              <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 font-bold">
                ×
              </button>
            </div>
          )}

          {/* Sheet music container */}
          <div className="flex items-start gap-4">
            {/* Strip names column */}
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
          <div className="mt-4 text-center text-sm text-gray-600">
            {currentDividers.length} dividers, {strips.length} strips • Click to add divider, Shift+click for system divider • Type part names to auto-fill
          </div>
        </div>
      </div>
    </div>
  );
};

export default MusicPartitioner;
