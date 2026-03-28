import React, { useState, useRef, useEffect } from "react";
import Toolbar from "./Toolbar";
import CanvasBoard from "./CanvasBoard";
import SuggestionPanel from "./SuggestionPanel";
import MathSolver from "./MathSolver";
import "./styles.css";

import AiStatusIndicator from "./AiStatusIndicator";

// Basic icons for the UI
const BrainIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
    <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
  </svg>
);

/**
 * Main Application Component
 * 
 * Layout: Full-screen Canvas
 * Overlays:
 * - Top Left: Floating Logo
 * - Left: Vertical Floating Dock (Tools + Undo/Redo)
 * - Bottom Center: Floating MathSolver / Tool Bar
 * - Bottom Right: Zoom controls
 * - Top Right: Suggestion Panel Toggle / Slider
 * - Top Center (absolute): AI status bubble
 */
export default function App() {
  const [activeTool, setActiveTool] = useState("select");
  const [brushColor, setBrushColor] = useState("#1e293b"); // default dark for Excalidraw style
  const [brushSize, setBrushSize] = useState(3);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [aiState, setAiState] = useState({ status: "idle", message: "" });
  const [error, setError] = useState(null);

  const [zoomLevel, setZoomLevel] = useState(100);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });

  const canvasRef = useRef(null);
  const API_URL = "http://localhost:3001/api";

  const handleZoom = (direction) => {
    if (canvasRef.current && canvasRef.current.zoomCanvas) {
      canvasRef.current.zoomCanvas(direction);
    }
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Do not trigger if user is typing in an input, textarea, or contenteditable
      const target = e.target;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      // Undo / Redo
      if (cmdOrCtrl) {
        if (e.key.toLowerCase() === 'z') {
          e.preventDefault();
          if (e.shiftKey) handleRedo(); else handleUndo();
        } else if (e.key.toLowerCase() === 'y') {
          e.preventDefault();
          handleRedo();
        }
      }
      // Tool Shortcuts
      else if (!e.shiftKey && !e.altKey && !e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'v': setActiveTool("select"); break;
          case 'p': setActiveTool("pen"); break;
          case 'r': setActiveTool("rectangle"); break;
          case 'c': setActiveTool("circle"); break;
          case 'a': setActiveTool("arrow"); break;
          case 't': setActiveTool("text"); break;
          case 'e': setActiveTool("eraser"); break;
          default: break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleUndo = () => {
    if (canvasRef.current && canvasRef.current.undo) {
      canvasRef.current.undo();
    }
  };

  const handleRedo = () => {
    if (canvasRef.current && canvasRef.current.redo) {
      canvasRef.current.redo();
    }
  };

  const handleClearCanvas = () => {
    if (canvasRef.current && canvasRef.current.clearCanvas) {
      canvasRef.current.clearCanvas();
      // Optional: bring back placeholder on clear
      setShowPlaceholder(true);
    }
  };

  const [showPlaceholder, setShowPlaceholder] = useState(true);

  const handleTopicSearch = async (topic) => {
    if (!topic.trim()) return;
    setLoading(true);
    setAiState({ status: "loading", message: "Solving..." });
    setError(null);
    try {
      const res = await fetch(`${API_URL}/topic-suggestions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSuggestions(data.suggestions);
      setShowSuggestions(true);
      setAiState({ status: "success", message: "Solved" });
    } catch (err) {
      setError("Failed to get suggestions.");
      setAiState({ status: "error", message: "Failed, retrying..." });
    } finally {
      setLoading(false);
    }
  };

  const handleSolveSketchStart = async () => {
    setAiState({ status: "loading", message: "Solving..." });
    if (canvasRef.current) {
      try {
        const count = await canvasRef.current.solveSketchMath(API_URL);
        if (count > 0) {
          setAiState({ status: "success", message: "Solved" });
        } else {
          setAiState({ status: "error", message: "Failed, retrying..." });
        }
      } catch (err) {
        console.error(err);
        setAiState({ status: "error", message: "Error parsing sketch" });
        setError(err.message);
      }
    }
  };

  return (
    <div
      className="app-container"
      onMouseDown={() => { if (showPlaceholder) setShowPlaceholder(false); }}
    >
      {/* ── Background Canvas ── */}
      <main className="canvas-area">
        <div className="canvas-vignette" />
        <div className={`canvas-placeholder ${!showPlaceholder ? 'hidden' : ''}`}>
          Draw, write, or type anything...
        </div>
        <CanvasBoard
          ref={canvasRef}
          activeTool={activeTool}
          brushColor={brushColor}
          brushSize={brushSize}
          onZoomChange={setZoomLevel}
          onHistoryChange={setHistoryState}
          onAiStatusChange={setAiState}
        />
      </main>

      {/* ── Floating Logo ── */}
      <div className="floating-logo glass-panel">
        <div className="logo-icon">N</div>
        <h1>NeuroBoard</h1>
      </div>

      {/* ── AI Status Bubble ── */}
      <AiStatusIndicator
        key={aiState.message + aiState.status}
        status={aiState.status}
        message={aiState.message}
        onClose={() => setAiState({ status: "idle", message: "" })}
      />

      {/* ── Floating Toolbars (Left) ── */}
      <Toolbar
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        onClearCanvas={handleClearCanvas}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={historyState.canUndo}
        canRedo={historyState.canRedo}
        brushColor={brushColor}
        setBrushColor={setBrushColor}
        brushSize={brushSize}
        setBrushSize={setBrushSize}
      />

      {/* ── Bottom Right: Zoom Controls ── */}
      <div className="bottom-right-controls glass-panel">
        <button className="zoom-btn" onClick={() => handleZoom("out")} data-tooltip="Zoom Out">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        </button>
        <div className="zoom-level" data-tooltip="Reset Zoom" style={{ cursor: "pointer" }} onClick={() => { }}>
          {zoomLevel}%
        </div>
        <button className="zoom-btn" onClick={() => handleZoom("in")} data-tooltip="Zoom In">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        </button>
      </div>

      {/* ── Top Right: AI Suggestions Toggle ── */}
      <button
        className="suggestion-toggle-btn glass-panel"
        onClick={() => setShowSuggestions(!showSuggestions)}
      >
        <BrainIcon /> {showSuggestions ? "Hide Suggestions" : "Suggestions"}
      </button>

      {/* ── Floating Suggestion Panel ── */}
      {showSuggestions && (
        <div className="floating-suggestion-panel glass-panel">
          <SuggestionPanel
            suggestions={suggestions}
            onSearch={handleTopicSearch}
            loading={loading}
          />
        </div>
      )}

      {/* ── Bottom Center: Math Solver ── */}
      <div className="bottom-center-panel glass-panel">
        <MathSolver
          onSolve={(text) => canvasRef.current.addText(text)}
          onSolveSketch={handleSolveSketchStart}
          apiUrl={API_URL}
          setError={setError}
        />
      </div>

      {/* ── Error Toast ── */}
      {error && (
        <div className="error-toast" onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </div>
  );
}
