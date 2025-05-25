import React, { useState, useRef, useCallback } from 'react';
import { Music, Download, Plus, Trash2 } from 'lucide-react';

const MusicPartitioner = () => {
  // Mock sheet music dimensions - in real app, this would come from the uploaded PDF
  const pageWidth = 600;
  const pageHeight = 800;
  
  // State for strip dividers (y-coordinates where strips are separated)
  const [dividers, setDividers] = useState([200, 400, 600]);
  
  // State for part names
  const [partNames, setPartNames] = useState(['Violin I', 'Violin II', 'Viola', 'Cello']);
  
  // Dragging state
  const [dragIndex, setDragIndex] = useState(-1);
  const [dragOffset, setDragOffset] = useState(0);
  
  const containerRef = useRef(null);
  
  // Get strips based on dividers
  const getStrips = useCallback(() => {
    const strips = [];
    const allDividers = [0, ...dividers, pageHeight].sort((a, b) => a - b);
    
    for (let i = 0; i < allDividers.length - 1; i++) {
      strips.push({
        start: allDividers[i],
        end: allDividers[i + 1],
        height: allDividers[i + 1] - allDividers[i]
      });
    }
    
    return strips;
  }, [dividers, pageHeight]);
  
  const handleMouseDown = (e, index) => {
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    setDragIndex(index);
    setDragOffset(mouseY - dividers[index]);
  };
  
  const handleMouseMove = useCallback((e) => {
    if (dragIndex === -1) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    const newY = mouseY - dragOffset;
    
    // Constrain to page bounds and don't let dividers cross each other
    const minY = dragIndex === 0 ? 20 : dividers[dragIndex - 1] + 20;
    const maxY = dragIndex === dividers.length - 1 ? pageHeight - 20 : dividers[dragIndex + 1] - 20;
    
    const constrainedY = Math.max(minY, Math.min(maxY, newY));
    
    setDividers(prev => {
      const newDividers = [...prev];
      newDividers[dragIndex] = constrainedY;
      return newDividers;
    });
  }, [dragIndex, dragOffset, dividers, pageHeight]);
  
  const handleMouseUp = useCallback(() => {
    setDragIndex(-1);
    setDragOffset(0);
  }, []);
  
  React.useEffect(() => {
    if (dragIndex !== -1) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [dragIndex, handleMouseMove, handleMouseUp]);
  
  const addDivider = () => {
    const newY = pageHeight / 2;
    setDividers(prev => [...prev, newY].sort((a, b) => a - b));
    setPartNames(prev => [...prev, `Part ${prev.length + 1}`]);
  };
  
  const removeDivider = (index) => {
    setDividers(prev => prev.filter((_, i) => i !== index));
    setPartNames(prev => prev.filter((_, i) => i !== index + 1));
  };
  
  const updatePartName = (index, name) => {
    setPartNames(prev => {
      const newNames = [...prev];
      newNames[index] = name;
      return newNames;
    });
  };
  
  const strips = getStrips();
  
  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Music className="w-6 h-6 text-blue-600" />
              <h1 className="text-2xl font-bold text-gray-800">Music Score Partitioner</h1>
            </div>
            
            {/* Top controls */}
            <div className="flex gap-3">
              <button
                onClick={addDivider}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Divider
              </button>
              
              <button className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
                <Download className="w-4 h-4" />
                Export Parts ({strips.length})
              </button>
            </div>
          </div>
          
          {/* Sheet music container */}
          <div className="flex items-start gap-4">
            {/* Part names column */}
            <div className="w-40 flex-shrink-0 relative" style={{ height: pageHeight }}>
              <div className="text-sm font-medium text-gray-600 mb-2">Parts</div>
              {strips.map((strip, index) => (
                <div
                  key={`name-${index}`}
                  className="absolute flex items-center"
                  style={{
                    top: strip.start + 24, // offset for the "Parts" label
                    height: strip.height,
                    width: '100%'
                  }}
                >
                  <input
                    type="text"
                    value={partNames[index] || `Part ${index + 1}`}
                    onChange={(e) => updatePartName(index, e.target.value)}
                    className="w-full bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium border-none outline-none focus:bg-blue-700 focus:ring-2 focus:ring-blue-300"
                    style={{ cursor: 'text' }}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="Part name"
                  />
                </div>
              ))}
            </div>
            
            {/* Sheet music */}
            <div className="border-2 border-gray-200 rounded-lg overflow-hidden" style={{ width: pageWidth }}>
              <div 
                ref={containerRef}
                className="relative bg-white cursor-crosshair select-none"
                style={{ width: pageWidth, height: pageHeight }}
              >
              {/* Mock sheet music background */}
              <div className="absolute inset-0 bg-gradient-to-b from-gray-50 to-gray-100">
                {/* Staff lines simulation */}
                {Array.from({ length: 20 }, (_, i) => (
                  <div
                    key={i}
                    className="absolute w-full border-t border-gray-300"
                    style={{ top: `${(i + 1) * 40}px` }}
                  />
                ))}
                
                {/* Mock musical notation */}
                <div className="absolute top-16 left-8 text-6xl text-gray-800">♪</div>
                <div className="absolute top-24 left-24 text-4xl text-gray-700">♫</div>
                <div className="absolute top-32 left-40 text-5xl text-gray-800">♪</div>
                <div className="absolute top-56 left-12 text-6xl text-gray-800">♫</div>
                <div className="absolute top-64 left-32 text-4xl text-gray-700">♪</div>
                <div className="absolute top-72 left-48 text-5xl text-gray-800">♫</div>
                <div className="absolute top-96 left-16 text-6xl text-gray-800">♪</div>
                <div className="absolute top-104 left-36 text-4xl text-gray-700">♫</div>
              </div>
              
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
                  {/* Strip info */}
                  <div className="absolute top-2 right-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                    {strip.height}px tall
                  </div>
                </div>
              ))}
              
              
              {/* Draggable dividers */}
              {dividers.map((y, index) => (
                <div key={index}>
                  {/* Divider line */}
                  <div
                    className="absolute w-full border-t-2 border-red-500 z-10"
                    style={{ top: y }}
                  />
                  
                  {/* Draggable handle */}
                  <div
                    className="absolute w-8 h-8 bg-red-500 rounded-full cursor-ns-resize z-20 flex items-center justify-center hover:bg-red-600 transition-colors shadow-lg"
                    style={{
                      top: y - 16,
                      left: pageWidth - 32
                    }}
                    onMouseDown={(e) => handleMouseDown(e, index)}
                    title="Drag to adjust strip boundary"
                  >
                    <div className="w-2 h-2 bg-white rounded-full" />
                  </div>
                  
                  {/* Remove button */}
                  <button
                    className="absolute w-6 h-6 bg-red-500 rounded-full cursor-pointer z-20 flex items-center justify-center hover:bg-red-600 transition-colors text-white"
                    style={{
                      top: y - 12,
                      left: pageWidth - 52
                    }}
                    onClick={() => removeDivider(index)}
                    title="Remove this divider"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
          </div>
          
          {/* Status info */}
          <div className="mt-4 text-center text-sm text-gray-600">
            {strips.length} parts defined • Click part names to edit • Drag red circles to adjust boundaries
          </div>
        </div>
      </div>
    </div>
  );
};

export default MusicPartitioner;