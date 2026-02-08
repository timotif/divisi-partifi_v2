import { useState, useRef, useCallback, useEffect } from 'react';
import { Music, Download, Plus, Trash2, Upload, ChevronLeft, ChevronRight, Type, X, Clock } from 'lucide-react';

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

  // --- Tempo markings: multiple rectangle selections ---
  const [tempoMarkings, setTempoMarkings] = useState([]); // [{ page, x, y, w, h }]
  const [isSelectingTempo, setIsSelectingTempo] = useState(false);

  // --- Shared rectangle drag state (used by header and tempo selection) ---
  const [rectDragStart, setRectDragStart] = useState(null); // { x, y }
  const [rectDragCurrent, setRectDragCurrent] = useState(null); // { x, y }

  // --- UI state ---
  const [dragIndex, setDragIndex] = useState(-1);
  const [dragOffset, setDragOffset] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const containerRef = useRef(null);
  const fileInputRef = useRef(null);

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

  const isRectSelecting = isSelectingHeader || isSelectingTempo;

  const handleContainerClick = (e) => {
    // Don't add divider if we were dragging or in rect selection mode
    if (dragIndex !== -1 || isRectSelecting) return;
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
    const x = Math.min(rectDragStart.x, rectDragCurrent.x);
    const y = Math.min(rectDragStart.y, rectDragCurrent.y);
    const w = Math.abs(rectDragCurrent.x - rectDragStart.x);
    const h = Math.abs(rectDragCurrent.y - rectDragStart.y);
    if (w > 5 && h > 5) {
      const region = { page: currentPage, x, y, w, h };
      if (isSelectingHeader) {
        setHeaderRegion(region);
        setIsSelectingHeader(false);
      } else if (isSelectingTempo) {
        setTempoMarkings(prev => [...prev, region]);
        setIsSelectingTempo(false);
      }
    }
    setRectDragStart(null);
    setRectDragCurrent(null);
  }, [rectDragStart, rectDragCurrent, currentPage, isSelectingHeader, isSelectingTempo]);

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

    // Send raw annotations — the backend handles coordinate conversion,
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
          ...(tempoMarkings.length > 0 ? { tempo_markings: tempoMarkings } : {}),
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
    return (
      <div className="p-6 bg-gray-50 min-h-screen">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex items-center gap-2 mb-8">
              <Music className="w-6 h-6 text-blue-600" />
              <h1 className="text-2xl font-bold text-gray-800">Music Score Partitioner</h1>
            </div>

            <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files[0]) handleUpload(e.target.files[0]);
                }}
              />
              <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 mb-4">Upload a PDF score to extract individual parts</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {uploading ? 'Processing...' : 'Select PDF Score'}
              </button>
              {error && <p className="mt-4 text-red-600">{error}</p>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- Render: Edit / Exporting phase ---
  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Music className="w-6 h-6 text-blue-600" />
              <h1 className="text-2xl font-bold text-gray-800">Music Score Partitioner</h1>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setPhase('upload');
                  setScoreId(null);
                  setScoreMetadata(null);
                  setExportResult(null);
                  setError(null);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              >
                <Upload className="w-4 h-4" />
                New Score
              </button>
              <button
                onClick={addDivider}
                disabled={isRectSelecting}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Divider
              </button>
              <button
                onClick={() => { setIsSelectingHeader(!isSelectingHeader); setIsSelectingTempo(false); }}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                  isSelectingHeader
                    ? 'bg-green-700 text-white ring-2 ring-green-300'
                    : headerRegion
                      ? 'bg-green-600 text-white hover:bg-green-700'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                <Type className="w-4 h-4" />
                {isSelectingHeader ? 'Draw Header...' : headerRegion ? 'Header Set' : 'Select Header'}
              </button>
              {headerRegion && !isSelectingHeader && (
                <button
                  onClick={() => setHeaderRegion(null)}
                  className="flex items-center gap-1 px-3 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
                  title="Clear header selection"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => { setIsSelectingTempo(!isSelectingTempo); setIsSelectingHeader(false); }}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                  isSelectingTempo
                    ? 'bg-amber-700 text-white ring-2 ring-amber-300'
                    : tempoMarkings.length > 0
                      ? 'bg-amber-600 text-white hover:bg-amber-700'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                <Clock className="w-4 h-4" />
                {isSelectingTempo ? 'Draw Tempo...' : tempoMarkings.length > 0 ? `Tempo (${tempoMarkings.length})` : 'Select Tempo'}
              </button>
              {tempoMarkings.length > 0 && !isSelectingTempo && (
                <button
                  onClick={() => setTempoMarkings([])}
                  className="flex items-center gap-1 px-3 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
                  title="Clear all tempo markings"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={handleExport}
                disabled={phase === 'exporting' || strips.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                <Download className="w-4 h-4" />
                {phase === 'exporting' ? 'Exporting...' : `Export Parts (${strips.length} strips)`}
              </button>
            </div>
          </div>

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
            <div className="w-40 flex-shrink-0 relative" style={{ height: pageHeight }}>
              <div className="text-sm font-medium text-gray-600 mb-2">Strip Names</div>
              {strips.map((strip, index) => (
                <div
                  key={`name-${index}`}
                  className="absolute flex items-center"
                  style={{
                    top: strip.start,
                    height: strip.height,
                    width: '100%'
                  }}
                >
                  <input
                    type="text"
                    value={currentStripNames[index] || ''}
                    onChange={(e) => updateStripName(index, e.target.value)}
                    onBlur={() => handleStripNameBlur(index)}
                    className="w-full bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium border-none outline-none focus:bg-blue-700 focus:ring-2 focus:ring-blue-300"
                    style={{ cursor: 'text' }}
                    onClick={(e) => e.stopPropagation()}
                    placeholder={`Part ${index + 1}`}
                  />
                </div>
              ))}
            </div>

            {/* Sheet music */}
            <div className="border-2 border-gray-200 rounded-lg overflow-hidden" style={{ width: pageWidth }}>
              <div
                ref={containerRef}
                className={`relative bg-white select-none ${isSelectingHeader ? 'cursor-crosshair' : 'cursor-crosshair'}`}
                style={{ width: pageWidth, height: pageHeight }}
                onClick={handleContainerClick}
                onMouseDown={handleRectMouseDown}
              >
                {/* Real page image from backend */}
                {pageImageUrl && (
                  <img
                    src={pageImageUrl}
                    alt={`Page ${currentPage + 1}`}
                    style={{ width: pageWidth, height: pageHeight }}
                    className="absolute inset-0"
                    draggable={false}
                  />
                )}

                {/* Dead zone overlays: above first, below last, and between systems */}
                {currentDividers.length >= 2 && (() => {
                  const zones = [];
                  // Above first divider
                  zones.push({ top: 0, height: currentDividers[0] });
                  // Below last divider
                  const last = currentDividers[currentDividers.length - 1];
                  zones.push({ top: last, height: pageHeight - last });
                  // Between systems: gap from a part divider to the next system divider
                  for (let j = 0; j < currentDividers.length - 1; j++) {
                    if (currentSystemDividers[j + 1]) {
                      zones.push({
                        top: currentDividers[j],
                        height: currentDividers[j + 1] - currentDividers[j],
                      });
                    }
                  }
                  return zones.filter(z => z.height > 0).map((zone, i) => (
                    <div
                      key={`dead-${i}`}
                      className="absolute bg-gray-500 bg-opacity-30 z-5"
                      style={{ top: zone.top, left: 0, width: '100%', height: zone.height }}
                    />
                  ));
                })()}

                {/* Strip visualization */}
                {strips.map((strip, index) => (
                  <div
                    key={index}
                    className="absolute border-2 border-dashed border-blue-400 bg-blue-50 bg-opacity-20 group hover:bg-opacity-30 transition-colors"
                    style={{
                      top: strip.start,
                      left: 0,
                      width: '100%',
                      height: strip.height
                    }}
                  >
                    <div className="absolute top-1 left-2 bg-blue-600 text-white px-2 py-0.5 rounded text-xs opacity-70">
                      {currentStripNames[index] || `Strip ${index + 1}`}
                    </div>
                    <div className="absolute top-2 right-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                      {strip.height}px tall
                    </div>
                  </div>
                ))}

                {/* Draggable dividers */}
                {currentDividers.map((y, index) => {
                  const isSystem = !!currentSystemDividers[index];
                  const lineClass = isSystem
                    ? 'absolute w-full border-t-4 border-red-600 z-10'
                    : 'absolute w-full border-t-2 border-blue-500 z-10';
                  const handleClass = isSystem
                    ? 'absolute w-8 h-8 bg-red-600 rounded-full cursor-ns-resize z-20 flex items-center justify-center hover:bg-red-700 transition-colors shadow-lg'
                    : 'absolute w-8 h-8 bg-blue-500 rounded-full cursor-ns-resize z-20 flex items-center justify-center hover:bg-blue-600 transition-colors shadow-lg';
                  const removeClass = isSystem
                    ? 'absolute w-6 h-6 bg-red-600 rounded-full cursor-pointer z-20 flex items-center justify-center hover:bg-red-700 transition-colors text-white'
                    : 'absolute w-6 h-6 bg-blue-500 rounded-full cursor-pointer z-20 flex items-center justify-center hover:bg-blue-600 transition-colors text-white';
                  return (
                  <div key={index}>
                    {/* Divider line */}
                    <div
                      className={lineClass}
                      style={{ top: y }}
                    />

                    {/* Draggable handle */}
                    <div
                      className={handleClass}
                      style={{
                        top: y - 16,
                        left: pageWidth - 32
                      }}
                      onMouseDown={(e) => handleMouseDown(e, index)}
                      onClick={(e) => e.stopPropagation()}
                      title={isSystem ? 'System divider — drag to adjust' : 'Drag to adjust strip boundary'}
                    >
                      {isSystem
                        ? <div className="w-4 h-0.5 bg-white" />
                        : <div className="w-2 h-2 bg-white rounded-full" />
                      }
                    </div>

                    {/* Remove button */}
                    <button
                      className={removeClass}
                      style={{
                        top: y - 12,
                        left: pageWidth - 52
                      }}
                      onClick={(e) => { e.stopPropagation(); removeDivider(index); }}
                      title="Remove this divider"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  );
                })}

                {/* Rectangle selection preview (while dragging) */}
                {rectPreview && rectPreview.w > 0 && rectPreview.h > 0 && (
                  <div
                    className={`absolute border-2 border-dashed bg-opacity-30 z-30 pointer-events-none ${
                      isSelectingHeader ? 'border-green-500 bg-green-200' : 'border-amber-500 bg-amber-200'
                    }`}
                    style={{
                      left: rectPreview.x,
                      top: rectPreview.y,
                      width: rectPreview.w,
                      height: rectPreview.h,
                    }}
                  />
                )}

                {/* Header region overlay (finalized) */}
                {headerRegion && currentPage === headerRegion.page && (
                  <div
                    className="absolute border-2 border-green-600 bg-green-200 bg-opacity-30 z-30"
                    style={{
                      left: headerRegion.x,
                      top: headerRegion.y,
                      width: headerRegion.w,
                      height: headerRegion.h,
                    }}
                  >
                    <div className="absolute top-1 left-2 bg-green-700 text-white px-2 py-0.5 rounded text-xs">
                      Header
                    </div>
                    <button
                      className="absolute top-1 right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center hover:bg-red-600 transition-colors text-white z-40"
                      onClick={(e) => { e.stopPropagation(); setHeaderRegion(null); }}
                      title="Clear header"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}

                {/* Tempo marking overlays (finalized) */}
                {tempoMarkings.map((tm, idx) => tm.page === currentPage && (
                  <div
                    key={`tempo-${idx}`}
                    className="absolute border-2 border-amber-500 bg-amber-200 bg-opacity-30 z-30"
                    style={{
                      left: tm.x,
                      top: tm.y,
                      width: tm.w,
                      height: tm.h,
                    }}
                  >
                    <div className="absolute top-1 left-2 bg-amber-600 text-white px-2 py-0.5 rounded text-xs">
                      Tempo
                    </div>
                    <button
                      className="absolute top-1 right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center hover:bg-red-600 transition-colors text-white z-40"
                      onClick={(e) => {
                        e.stopPropagation();
                        setTempoMarkings(prev => prev.filter((_, j) => j !== idx));
                      }}
                      title="Remove tempo marking"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Page navigation */}
          {scoreMetadata && scoreMetadata.page_count > 1 && (
            <div className="mt-4 flex items-center justify-center gap-4">
              <button
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 0}
                className="p-2 rounded-lg bg-gray-200 hover:bg-gray-300 disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {/* Page dots */}
              <div className="flex items-center gap-1.5">
                {Array.from({ length: scoreMetadata.page_count }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => goToPage(i)}
                    className={`w-3 h-3 rounded-full transition-colors ${
                      i === currentPage
                        ? 'bg-blue-600 ring-2 ring-blue-300'
                        : confirmedPages.has(i)
                          ? 'bg-green-500 hover:bg-green-600'
                          : 'bg-gray-300 hover:bg-gray-400'
                    }`}
                    title={`Page ${i + 1}${confirmedPages.has(i) ? ' (confirmed)' : ''}`}
                  />
                ))}
              </div>

              <button
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage === scoreMetadata.page_count - 1}
                className="p-2 rounded-lg bg-gray-200 hover:bg-gray-300 disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              <span className="text-sm text-gray-600 ml-2">
                Page {currentPage + 1} of {scoreMetadata.page_count}
              </span>
            </div>
          )}

          {/* Export results — download links */}
          {exportResult && (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
              <h3 className="font-medium text-green-800 mb-2">Parts generated successfully:</h3>
              <ul className="space-y-1">
                {exportResult.map((part) => (
                  <li key={part.name} className="flex items-center gap-2">
                    <Download className="w-4 h-4 text-green-600" />
                    <button
                      onClick={async () => {
                        const res = await fetch(`/api/scores/${scoreId}/parts/${encodeURIComponent(part.name)}`);
                        if (!res.ok) { setError(`Download failed: ${res.status}`); return; }
                        const blob = await res.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${part.name}.pdf`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="text-blue-600 hover:underline"
                    >
                      {part.name}.pdf
                    </button>
                    <span className="text-xs text-gray-500">
                      ({part.staves_count} staves, {part.page_count} output pages)
                    </span>
                  </li>
                ))}
              </ul>
            </div>
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
