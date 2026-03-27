import React, {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
} from "react";
import { fabric } from "fabric";
import { cachedEval, normalizeExpression, evaluateLines } from "./mathUtils";


/**
 * Fabric.js based CanvasBoard
 * Supports: Drawing Shapes, Text, AI Sketch Solve, Inline Math Solver
 *
 * Math Solver optimizations:
 *  - Debounced (150ms) text:changed handler — no heavy keystroke processing
 *  - Safe recursive-descent parser (no eval/Function)
 *  - Result cache prevents re-computation of same expression
 *  - Phantom result guard: marks result objects so text:changed skips them
 *  - Smart placement: auto-shifts answer if it would overflow canvas edges
 *  - Font size scales with surrounding text size (min 20, max 120)
 *  - Fade-in animation via opacity stepping
 *  - ×, ÷ symbol normalization before parsing
 */
const CanvasBoard = forwardRef(({ activeTool, brushColor, brushSize, onZoomChange, onHistoryChange }, ref) => {
  const canvasElRef = useRef(null);
  const fabricRef = useRef(null);
  const containerRef = useRef(null);
  const drawingRef = useRef(null);

  // Track the last result object per source IText so we can remove/replace it
  // Map<fabricObjId -> fabric.Text>
  const resultMapRef = useRef(new Map());

  // Debounce timer for text:changed
  const mathDebounceRef = useRef(null);

  // Undo / Redo stacks
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const isProcessingHistoryRef = useRef(false);
  const saveHistoryTimeoutRef = useRef(null);

  // Debounced save state helper
  const saveHistory = () => {
    if (isProcessingHistoryRef.current) return;
    
    if (saveHistoryTimeoutRef.current) {
      clearTimeout(saveHistoryTimeoutRef.current);
    }
    
    saveHistoryTimeoutRef.current = setTimeout(() => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      
      // Save current state with custom props
      const json = JSON.stringify(canvas.toJSON(["__uid", "__isMathResult", "__resultKey", "id"]));
      
      // Avoid identical consecutive states
      if (undoStackRef.current.length > 0 && undoStackRef.current[undoStackRef.current.length - 1] === json) {
        return;
      }

      undoStackRef.current.push(json);
      
      // Prevent unbounded memory growth
      if (undoStackRef.current.length > 50) {
        undoStackRef.current.shift();
      }
      
      redoStackRef.current = [];
      
      if (onHistoryChange) {
        onHistoryChange({ canUndo: undoStackRef.current.length > 1, canRedo: false });
      }
    }, 100);
  };


  // ── Initialize fabric canvas ───────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const canvas = new fabric.Canvas(canvasElRef.current, {
      width: container.offsetWidth,
      height: container.offsetHeight,
      backgroundColor: "transparent",
      selection: true,
    });
    fabricRef.current = canvas;

    // Resize handler
    const handleResize = () => {
      canvas.setWidth(container.offsetWidth);
      canvas.setHeight(container.offsetHeight);
      canvas.renderAll();
    };
    window.addEventListener("resize", handleResize);

    // Initial state save
    saveHistory();

    // Listen to changes for history
    canvas.on("object:added", saveHistory);
    canvas.on("object:modified", saveHistory);
    canvas.on("object:removed", saveHistory);

    // ── INLINE MATH SOLVER (IText) ─────────────────────────────────────────
    canvas.on("text:changed", (opt) => {
      const obj = opt.target;
      // Skip non-IText and skip our own result objects (phantom guard)
      if (!obj || obj.type !== "i-text" || obj.__isMathResult) return;

      // Debounce: 150ms window
      if (mathDebounceRef.current) clearTimeout(mathDebounceRef.current);
      mathDebounceRef.current = setTimeout(() => {
        handleInlineMath(canvas, obj);
      }, 150);
    });

    // ── AUTO-SOLVE SKETCH (debounced 2.5s) ────────────────────────────────
    let sketchTimer = null;
    canvas.on("path:created", () => {
      if (sketchTimer) clearTimeout(sketchTimer);
      sketchTimer = setTimeout(async () => {
        try {
          await solveSketchMathInternal("http://localhost:3001/api");
        } catch (e) {
          console.log("Auto sketch solver: no math detected");
        }
      }, 2500);
    });

    return () => {
      window.removeEventListener("resize", handleResize);
      if (mathDebounceRef.current) clearTimeout(mathDebounceRef.current);
      canvas.dispose();
    };
  }, []);

  // ── Inline Multi-Line Math Handler ─────────────────────────────────────────
  //
  // Each \n-separated line is evaluated independently using evaluateLines().
  // Results are stored/updated by key = "${uid}_line_${lineIndex}" so each
  // line's answer can be independently updated or removed.
  //
  function handleInlineMath(canvas, obj) {
    if (!obj.__uid) obj.__uid = `${Date.now()}_${Math.random()}`;
    const uid = obj.__uid;
    const rawText = obj.text;
    const totalLines = rawText.split('\n').length;

    // Evaluate all lines independently
    const lineResults = evaluateLines(rawText);

    // Fabric IText layout constants
    const fontSize     = Math.max(20, Math.min(100, obj.fontSize || 40));
    const lineHeightPx = fontSize * (obj.lineHeight || 1.16);

    const bounds  = obj.getBoundingRect(true);
    const canvasW = canvas.getWidth();
    const canvasH = canvas.getHeight();
    const GAP     = 22;

    // If right side is too close to canvas edge, stack answers below instead
    const stackBelow = (bounds.left + bounds.width + GAP + fontSize * 1.5) > canvasW - 20;
    const rightX     = bounds.left + bounds.width + GAP;

    lineResults.forEach(({ lineIndex, actionable, formatted, error }) => {
      const key = `${uid}_line_${lineIndex}`;

      if (!actionable || error || formatted === undefined) {
        removeResultByKey(canvas, key);
        return;
      }

      // Calculate position for this specific line
      let resLeft, resTop, originY;

      if (stackBelow) {
        // Stack answers horizontally below the full text block
        resLeft = bounds.left;
        resTop  = bounds.top + bounds.height + GAP + lineIndex * (fontSize + 8);
        originY = "top";
      } else {
        // Place answer to the right, vertically centered on the line
        resLeft = rightX;
        resTop  = bounds.top + lineIndex * lineHeightPx + lineHeightPx / 2;
        originY = "center";
      }

      // Clamp to canvas
      // Scale 1.15x of original line height, clamped 16-48
      const displayFontSize = Math.max(16, Math.min(48, fontSize * 1.15));

      // Clamp to canvas
      resLeft = Math.max(4, Math.min(resLeft, canvasW - displayFontSize * 2 - 4));
      resTop  = Math.max(displayFontSize / 2, Math.min(resTop, canvasH - displayFontSize));

      placeResultAt(canvas, key, formatted, resLeft, resTop, displayFontSize, originY, obj.fontFamily || "'Inter', sans-serif");
    });

    // Clean up results for lines that no longer exist (user deleted a line)
    for (const key of resultMapRef.current.keys()) {
      if (!key.startsWith(`${uid}_line_`)) continue;
      const idx = parseInt(key.split('_line_')[1], 10);
      if (idx >= totalLines) removeResultByKey(canvas, key);
    }
  }

  // ── Place or Replace a Result Object at an exact canvas position ───────────
  function placeResultAt(canvas, key, formatted, left, top, fontSize, originY = "center", fontFamily = "'Kalam', 'Rock Salt', cursive") {
    removeResultByKey(canvas, key);

    const resText = new fabric.Text(formatted, {
      left,
      top,
      fontSize,
      fill: "#10b981", // Success green (light theme context)
      fontFamily: fontFamily,
      selectable: true,
      evented: true,
      opacity: 0,
      scaleX: 0.95,
      scaleY: 0.95,
      originX: "left",
      originY,
      shadow: "rgba(0,0,0,0.1) 1px 1px 2px",
      __isMathResult: true,
      __resultKey: key,
    });

    // Simple Overlap Avoidance (shifts right if colliding with drawing objects)
    const padding = 12;
    let collisions = 0;
    while (collisions < 5) {
      resText.setCoords();
      const b = resText.getBoundingRect(true);
      const isOverlapping = canvas.getObjects().some(obj => {
         if (obj.__isMathResult || obj.type === "i-text") return false;
         const ob = obj.getBoundingRect(true);
         return !(
            b.left + b.width + padding < ob.left ||
            ob.left + ob.width + padding < b.left ||
            b.top + b.height + padding < ob.top ||
            ob.top + ob.height + padding < b.top
         );
      });
      if (!isOverlapping) break;
      resText.set({ left: resText.left + 24 });
      collisions++;
    }

    canvas.add(resText);
    animateFadeIn(canvas, resText, 200);
    resultMapRef.current.set(key, resText);
  }

  // ── Remove a single result by its tracking key ─────────────────────────────
  function removeResultByKey(canvas, key) {
    const existing = resultMapRef.current.get(key);
    if (existing) {
      canvas.remove(existing);
      resultMapRef.current.delete(key);
    }
  }

  // ── Remove ALL results belonging to a source uid (when IText is erased) ────
  function removeAllResultsForUid(canvas, uid) {
    for (const [key, obj] of resultMapRef.current.entries()) {
      if (key.startsWith(`${uid}_line_`)) {
        canvas.remove(obj);
        resultMapRef.current.delete(key);
      }
    }
  }

  // ── Fade-in animation using setInterval stepping ──────────────────────────
  function animateFadeIn(canvas, obj, durationMs) {
    const steps = 12;
    const stepMs = durationMs / steps;
    let step = 0;
    const interval = setInterval(() => {
      step++;
      const progress = step / steps;
      obj.set({
        opacity: Math.min(0.9, progress),
        scaleX: 0.95 + (0.05 * progress),
        scaleY: 0.95 + (0.05 * progress)
      });
      canvas.renderAll();
      if (step >= steps) clearInterval(interval);
    }, stepMs);
  }


  // ── AI Sketch Solver ──────────────────────────────────────────────────────
  async function solveSketchMathInternal(apiUrl) {
    const canvas = fabricRef.current;
    if (!canvas) return;

    // Remove empty placeholder ITexts
    canvas
      .getObjects()
      .filter((o) => o.type === "i-text" && (!o.text.trim() || o.text === "Type Here"))
      .forEach((o) => canvas.remove(o));

    const dataURL = canvas.toDataURL({ format: "png", quality: 0.8, multiplier: 2 });

    const res = await fetch(`${apiUrl}/solve-sketch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataURL }),
    });
    
    const data = await res.json();
    if (data.error) throw new Error(data.error);

      const answers = Array.isArray(data.solution)
        ? data.solution
        : Array.isArray(data.answer)
          ? data.answer
          : [];

      if (answers.length > 0) {
        // ── Smart placement: cluster strokes into lines ──────
        const drawnObjects = canvas.getObjects().filter(
          (o) => !o.__isMathResult && o !== status && o.type !== "i-text"
        );

        const lines = [];
        drawnObjects.forEach((o) => {
          const b = o.getBoundingRect(true);
          const centerY = b.top + b.height / 2;
          
          let foundLine = lines.find(l => Math.abs(l.centerY - centerY) < 40);
          if (foundLine) {
            foundLine.minX = Math.min(foundLine.minX, b.left);
            foundLine.minY = Math.min(foundLine.minY, b.top);
            foundLine.maxX = Math.max(foundLine.maxX, b.left + b.width);
            foundLine.maxY = Math.max(foundLine.maxY, b.top + b.height);
            foundLine.centerY = (foundLine.minY + foundLine.maxY) / 2;
          } else {
            lines.push({
              minX: b.left, minY: b.top, maxX: b.left + b.width, maxY: b.top + b.height,
              centerY: centerY
            });
          }
        });

        lines.sort((a, b) => a.centerY - b.centerY);

        if (lines.length === 0) {
          lines.push({ minX: 50, minY: 50, maxX: 200, maxY: 100, centerY: 75 });
        }

        const GAP = 16;
        const canvasW = canvas.getWidth();
        const canvasH = canvas.getHeight();

        answers.forEach((item, index) => {
          const lineBox = lines[index] || lines[lines.length - 1];
          const exprHeight = lineBox.maxY - lineBox.minY;
          
          // Size: ~1.2x of expression height, clamped between 16 and 48px
          const displayFontSize = Math.max(16, Math.min(48, exprHeight * 1.2));
          
          let ansLeft = lineBox.maxX + GAP;
          let ansTop = lineBox.centerY;
          let ansOriginY = "center";
          
          // Clamp to right edge or wrap
          const estimatedAnswerW = displayFontSize * 1.5;
          if (ansLeft + estimatedAnswerW > canvasW - 20) {
            ansLeft = lineBox.minX;
            ansTop = lineBox.maxY + GAP;
            ansOriginY = "top";
          }
          ansTop = Math.max(displayFontSize / 2 + 4, Math.min(ansTop, canvasH - displayFontSize - 4));

          const key = `sketch_line_${Date.now()}_${index}`;
          const answerText = typeof item === "object"
            ? (item.ans || item.value || JSON.stringify(item))
            : item;
          placeResultAt(canvas, key, String(answerText), ansLeft, ansTop, displayFontSize, ansOriginY);
        });
        
        canvas.renderAll();
        return answers.length;
      }
      return 0; // No math detected
  }

  // ── Tool / Brush Effect ───────────────────────────────────────────────────
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    canvas.isDrawingMode = false;
    canvas.selection = false;
    canvas.forEachObject((o) => (o.selectable = false));
    canvas.off("mouse:down");
    canvas.off("mouse:move");
    canvas.off("mouse:up");

    switch (activeTool) {
      case "select":
        canvas.selection = true;
        canvas.forEachObject((o) => (o.selectable = true));
        canvas.defaultCursor = "default";
        break;
      case "pen":
        canvas.isDrawingMode = true;
        canvas.freeDrawingBrush.color = brushColor;
        canvas.freeDrawingBrush.width = brushSize * 1.5;
        canvas.defaultCursor = "crosshair";
        break;
      case "eraser":
        canvas.defaultCursor = "not-allowed";
        canvas.on("mouse:down", (opt) => {
          const target = canvas.findTarget(opt.e);
          if (target) {
            // If erasing a result text, remove it from tracking map
            if (target.__isMathResult && target.__resultKey) {
              resultMapRef.current.delete(target.__resultKey);
            }
            // If erasing a source IText, remove ALL its line results
            if (target.type === "i-text" && target.__uid) {
              removeAllResultsForUid(canvas, target.__uid);
            }
            canvas.remove(target);
            canvas.renderAll();
          }
        });
        break;
      case "text":
        canvas.defaultCursor = "text";
        canvas.on("mouse:down", (opt) => {
          const pointer = canvas.getPointer(opt.e);
          const iText = new fabric.IText("Type Here", {
            left: pointer.x,
            top: pointer.y,
            fill: brushColor,
            fontSize: Math.max(24, brushSize * 8),
            fontFamily: "'Inter', sans-serif",
          });
          canvas.add(iText);
          canvas.setActiveObject(iText);
          iText.enterEditing();
          canvas.renderAll();
        });
        break;
      case "rectangle":
      case "circle":
      case "arrow":
        canvas.defaultCursor = "crosshair";
        canvas.on("mouse:down", handleShapeStart);
        canvas.on("mouse:move", handleShapeMove);
        canvas.on("mouse:up", handleShapeEnd);
        break;
    }
    canvas.renderAll();
  }, [activeTool, brushColor, brushSize]);

  // ── Shape Handlers ────────────────────────────────────────────────────────
  function handleShapeStart(opt) {
    const canvas = fabricRef.current;
    const pointer = canvas.getPointer(opt.e);
    drawingRef.current = { startX: pointer.x, startY: pointer.y, shape: null };
    const config = {
      fill: "transparent",
      stroke: brushColor,
      strokeWidth: brushSize,
      selectable: false,
    };
    let shp;
    if (activeTool === "rectangle")
      shp = new fabric.Rect({ ...config, left: pointer.x, top: pointer.y, width: 0, height: 0 });
    else if (activeTool === "circle")
      shp = new fabric.Ellipse({ ...config, left: pointer.x, top: pointer.y, rx: 0, ry: 0 });
    else if (activeTool === "arrow")
      shp = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], { ...config });
    if (shp) {
      drawingRef.current.shape = shp;
      canvas.add(shp);
    }
  }

  function handleShapeMove(opt) {
    if (!drawingRef.current?.shape) return;
    const canvas = fabricRef.current;
    const pointer = canvas.getPointer(opt.e);
    const { startX, startY, shape } = drawingRef.current;
    if (activeTool === "rectangle") {
      shape.set({
        left: Math.min(startX, pointer.x),
        top: Math.min(startY, pointer.y),
        width: Math.abs(pointer.x - startX),
        height: Math.abs(pointer.y - startY),
      });
    } else if (activeTool === "circle") {
      shape.set({
        left: Math.min(startX, pointer.x),
        top: Math.min(startY, pointer.y),
        rx: Math.abs(pointer.x - startX) / 2,
        ry: Math.abs(pointer.y - startY) / 2,
      });
    } else if (activeTool === "arrow") {
      shape.set({ x2: pointer.x, y2: pointer.y });
    }
    shape.setCoords();
    canvas.renderAll();
  }

  function handleShapeEnd() {
    drawingRef.current = null;
  }

  function processPathCleanup(obj) {
    if (!obj || obj.type !== "path") return;
    const canvas = fabricRef.current;
    const b = obj.getBoundingRect();
    if (b.width < 10 && b.height < 10) return;
    let s;
    const st = {
      left: b.left,
      top: b.top,
      fill: "transparent",
      stroke: "white",
      strokeWidth: 2,
      selectable: true,
    };
    if (Math.abs(b.width - b.height) < 20)
      s = new fabric.Circle({ ...st, radius: Math.max(b.width, b.height) / 2 });
    else if (b.height < 15)
      s = new fabric.Line(
        [b.left, b.top + b.height / 2, b.left + b.width, b.top + b.height / 2],
        { ...st }
      );
    else s = new fabric.Rect({ ...st, width: b.width, height: b.height });
    if (s) {
      canvas.remove(obj);
      canvas.add(s);
      canvas.renderAll();
    }
  }

  // ── Imperative API ────────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    undo: () => {
      const canvas = fabricRef.current;
      if (!canvas || undoStackRef.current.length <= 1) return;
      
      isProcessingHistoryRef.current = true;
      
      // Pop current state onto redo stack
      const currentState = undoStackRef.current.pop();
      redoStackRef.current.push(currentState);
      
      // Get previous state to render
      const previousState = undoStackRef.current[undoStackRef.current.length - 1];
      
      canvas.loadFromJSON(previousState, () => {
        canvas.renderAll();
        isProcessingHistoryRef.current = false;
        if (onHistoryChange) {
          onHistoryChange({
            canUndo: undoStackRef.current.length > 1,
            canRedo: redoStackRef.current.length > 0
          });
        }
      });
    },

    redo: () => {
      const canvas = fabricRef.current;
      if (!canvas || redoStackRef.current.length === 0) return;
      
      isProcessingHistoryRef.current = true;
      
      const nextState = redoStackRef.current.pop();
      undoStackRef.current.push(nextState);
      
      canvas.loadFromJSON(nextState, () => {
        canvas.renderAll();
        isProcessingHistoryRef.current = false;
        if (onHistoryChange) {
          onHistoryChange({
            canUndo: undoStackRef.current.length > 1,
            canRedo: redoStackRef.current.length > 0
          });
        }
      });
    },

    /**
     * addText — places a text label on canvas at a smart position.
     * Optionally accepts (content, x, y) to position explicitly.
     */
    addText(content, x, y) {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const cx = x !== undefined ? x : canvas.getWidth() / 2;
      const cy = y !== undefined ? y : canvas.getHeight() / 2;
      const text = new fabric.Text(content, {
        left: cx,
        top: cy,
        fill: "#a6e3a1",
        fontSize: 60,
        fontFamily: "'Rock Salt', cursive",
        originX: "center",
        originY: "center",
        opacity: 0,
        __isMathResult: true,
      });
      canvas.add(text);
      canvas.renderAll();
      animateFadeIn(canvas, text, 250);
    },

    clearCanvas() {
      const canvas = fabricRef.current;
      if (!canvas) return;
      
      resultMapRef.current.clear();
      
      isProcessingHistoryRef.current = true;
      canvas.clear();
      canvas.setBackgroundColor("transparent", () => {
        canvas.renderAll();
        isProcessingHistoryRef.current = false;
        saveHistory();
      });
    },

    zoomCanvas(direction) {
      const canvas = fabricRef.current;
      if (!canvas) return;
      let zoom = canvas.getZoom();
      if (direction === "in") zoom *= 1.2;
      else if (direction === "out") zoom /= 1.2;
      else if (direction === "reset") zoom = 1;
      
      // Keep scaling bounded
      zoom = Math.max(0.2, Math.min(zoom, 5));
      canvas.zoomToPoint(new fabric.Point(canvas.getWidth() / 2, canvas.getHeight() / 2), zoom);
      canvas.renderAll();

      if (onZoomChange) {
        onZoomChange(Math.round(zoom * 100));
      }
    },

    solveSketchMath(apiUrl) {
      return solveSketchMathInternal(apiUrl);
    },

    cleanDiagram() {
      const canvas = fabricRef.current;
      if (!canvas) return;
      canvas.getObjects().filter((o) => o.type === "path").forEach(processPathCleanup);
    },
  }));

  return (
    <div ref={containerRef} className="canvas-container">
      <canvas ref={canvasElRef} id="main-canvas" />
    </div>
  );
});

CanvasBoard.displayName = "CanvasBoard";
export default CanvasBoard;
