import React, { useState, useRef, useEffect } from "react";

// Inline SVGs for minimalist look
const icons = {
  select: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" strokeLinejoin="round" />
      <path d="M13 13l6 6" strokeLinecap="round" />
    </svg>
  ),
  pen: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19l7-7 3 3-7 7-3-3z" />
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
      <path d="M2 2l7.586 7.586" />
      <circle cx="11" cy="11" r="2" />
    </svg>
  ),
  rectangle: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    </svg>
  ),
  palette: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.992 6.012 17.5 2 12 2z" />
    </svg>
  ),
  circle: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
    </svg>
  ),
  arrow: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  ),
  text: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 7 4 4 20 4 20 7" />
      <line x1="9" y1="20" x2="15" y2="20" />
      <line x1="12" y1="4" x2="12" y2="20" />
    </svg>
  ),
  eraser: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 20H7L3 16C2.5 15.5 2.5 14.5 3 14L13 4C13.5 3.5 14.5 3.5 15 4L20 9C20.5 9.5 20.5 10.5 20 11L11 20" />
      <line x1="6" y1="11" x2="15" y2="20" />
    </svg>
  ),
  undo: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </svg>
  ),
  redo: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 7v6h-6" />
      <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
    </svg>
  ),
  trash: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
};

const toolGroups = [
  [
    { id: "select", label: "Select (V)", type: "tool" },
    { id: "pen", label: "Draw (P)", type: "tool" },
    { id: "eraser", label: "Eraser (E)", type: "tool" }
  ],
  [
    { id: "rectangle", label: "Rectangle (R)", type: "tool" },
    { id: "circle", label: "Circle (O)", type: "tool" },
    { id: "arrow", label: "Arrow (A)", type: "tool" }
  ],
  [
    { id: "text", label: "Text (T)", type: "tool" },
    { id: "palette", label: "Color & Stroke", type: "action" },
    { id: "trash", label: "Clear Canvas", type: "action" }
  ]
];

export default function Toolbar({
  activeTool,
  setActiveTool,
  onUndo,
  onRedo,
  onClearCanvas,
  canUndo = false,
  canRedo = false,
  brushColor = "#1e293b",
  setBrushColor,
  brushSize = 3,
  setBrushSize
}) {
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (settingsRef.current && !settingsRef.current.contains(event.target) && !event.target.closest('.palette-btn')) {
        setShowSettings(false);
      }
    }
    if (showSettings) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showSettings]);

  const presetColors = [
    "#1e293b", "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#ffffff"
  ];

  return (
    <div className="floating-toolbars-container">
      {/* ── Main Tool Dock ── */}
      <div className="floating-toolbar glass-panel">
        {toolGroups.map((group, groupIdx) => (
          <div key={groupIdx} className="tool-group">
            {group.map((tool) => (
              <button
                key={tool.id}
                className={`tool-btn ${tool.id === "palette" ? "palette-btn" : ""} ${activeTool === tool.id && tool.type === "tool" ? "active" : ""} ${tool.id === "palette" && showSettings ? "active" : ""}`}
                onClick={() => {
                  if (tool.type === "tool") setActiveTool(tool.id);
                  else if (tool.id === "trash" && onClearCanvas) onClearCanvas();
                  else if (tool.id === "palette") setShowSettings(!showSettings);
                }}
                data-tooltip={tool.label}
              >
                {icons[tool.id]}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* ── Settings Popover ── */}
      {showSettings && (
        <div className="settings-popover glass-panel" ref={settingsRef}>
          <div className="settings-section">
            <label>Color</label>
            <div className="color-grid">
              {presetColors.map(c => (
                <button
                  key={c}
                  className={`color-swatch ${brushColor === c ? 'active' : ''}`}
                  style={{ backgroundColor: c }}
                  onClick={() => { if (setBrushColor) setBrushColor(c); }}
                />
              ))}
            </div>
          </div>
          <div className="settings-section">
            <label>Stroke Size: <span>{brushSize}px</span></label>
            <input 
              type="range" 
              className="stroke-slider" 
              min="1" 
              max="10" 
              value={brushSize}
              onChange={(e) => { if (setBrushSize) setBrushSize(parseInt(e.target.value)); }}
            />
          </div>
        </div>
      )}

      {/* ── Undo / Redo Panel ── */}
      <div className="floating-toolbar glass-panel">
        <button 
          className="tool-btn" 
          onClick={onUndo} 
          disabled={!canUndo}
          data-tooltip="Undo (Ctrl+Z)"
        >
          {icons.undo}
        </button>
        <button 
          className="tool-btn" 
          onClick={onRedo} 
          disabled={!canRedo}
          data-tooltip="Redo (Ctrl+Y)"
        >
          {icons.redo}
        </button>
      </div>
    </div>
  );
}
