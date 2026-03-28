import React, {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
} from "react";
import { fabric } from "fabric";
import { cachedEval, normalizeExpression, evaluateLines, cleanMathOutput } from "./mathUtils";


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
const CanvasBoard = forwardRef(({ activeTool, brushColor, brushSize, onZoomChange, onHistoryChange, onAiStatusChange }, ref) => {
  const canvasElRef = useRef(null);
  const fabricRef = useRef(null);
  const containerRef = useRef(null);
  const drawingRef = useRef(null);

  // Track the floating AI label so we can remove/update it
  const aiStatusLabelRef = useRef(null);

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

      // Debounce: 120ms for instant feel
      if (mathDebounceRef.current) clearTimeout(mathDebounceRef.current);
      mathDebounceRef.current = setTimeout(() => {
        handleInlineMath(canvas, obj);
      }, 120);
    });

    // ── AUTO-SOLVE SKETCH (debounced 2.5s) ────────────────────────────────
    let sketchTimer = null;
    canvas.on("path:created", () => {
      // Only auto-solve if pen tool is active
      if (sketchTimer) clearTimeout(sketchTimer);

      sketchTimer = setTimeout(async () => {
        try {
          await solveSketchMathInternal("http://localhost:3001/api");
        } catch (e) {
          // console.log("Auto sketch solver: no math detected");
        }
      }, 1500); // Shorter duration for auto-scans
    });

    // Initialize brush
    canvas.freeDrawingBrush.color = brushColor;
    canvas.freeDrawingBrush.width = brushSize;

    return () => {
      window.removeEventListener("resize", handleResize);
      if (mathDebounceRef.current) clearTimeout(mathDebounceRef.current);
      if (sketchTimer) clearTimeout(sketchTimer);
      canvas.off("object:added", saveHistory);
      canvas.off("object:modified", saveHistory);
      canvas.off("object:removed", saveHistory);
      canvas.dispose();
    };
  }, []);

  // ── Inline Multi-Line Math Handler ─────────────────────────────────────────
  //
  // Each \n-separated line is evaluated independently using evaluateLines().
  // Results are stored/updated by key = "${uid}_line_${lineIndex}" so each
  // line's answer can be independently updated or removed.
  //
  async function handleInlineMath(canvas, obj) {
    if (!obj.__uid) obj.__uid = `${Date.now()}_${Math.random()}`;
    const uid = obj.__uid;
    const rawText = obj.text;
    const linesArr = rawText.split('\n');
    const totalLines = linesArr.length;

    // Evaluate all lines independently
    const lineResults = evaluateLines(rawText);

    // Fabric IText layout constants
    const fontSize = Math.max(20, Math.min(100, obj.fontSize || 40));
    const lineHeightPx = fontSize * (obj.lineHeight || 1.16);

    const bounds = obj.getBoundingRect(true);
    const canvasW = canvas.getWidth();
    const canvasH = canvas.getHeight();
    const GAP = 22;

    // If right side is too close to canvas edge, stack answers below instead
    const stackBelow = (bounds.left + bounds.width + GAP + fontSize * 1.5) > canvasW - 20;
    const rightX = bounds.left + bounds.width + GAP;

    for (let i = 0; i < lineResults.length; i++) {
      const { lineIndex, actionable, formatted, error, expression } = lineResults[i];
      const key = `${uid}_line_${lineIndex}`;

      if (!actionable) {
        removeResultByKey(canvas, key);
        continue;
      }

      // If any actionable math is found (ends with =), show "Solving..." immediately
      if (actionable) {
        if (onAiStatusChange) {
          onAiStatusChange({ status: "loading", message: "Solving..." });
        }
      }

      // Check if we need AI fallback
      if ((error || formatted === undefined) && expression) {
        // Show canvas loading indicator
        let resLeft, resTop, originY;
        if (stackBelow) {
          resLeft = bounds.left;
          resTop = bounds.top + bounds.height + GAP + lineIndex * (fontSize + 8);
          originY = "top";
        } else {
          resLeft = rightX;
          resTop = bounds.top + lineIndex * lineHeightPx + lineHeightPx / 2;
          originY = "center";
        }

        const aiStatusKey = `${key}_ai_loading`;
        placeResultAt(canvas, aiStatusKey, "🧠 Solving...", resLeft, resTop, Math.max(14, fontSize * 0.5), originY, "'Inter', sans-serif", "#3b82f6");

        try {
          const res = await fetch(`http://localhost:3001/api/solve-math`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ expression }),
          });
          const data = await res.json();
          removeResultByKey(canvas, aiStatusKey);
          
          if (data.answer && !data.error) {
            const displayFontSize = Math.max(16, Math.min(48, fontSize * 1.05));
            const humanExpr = expression.split('').map(c => /[+*/=-]/.test(c) ? ` ${c} ` : c).join('').replace(/\s+/g, ' ').trim();
            const fullResultText = `${humanExpr} = ${cleanMathOutput(data.answer)}`;
            placeResultAt(canvas, key, fullResultText, resLeft, resTop, displayFontSize, originY, obj.fontFamily || "'Inter', sans-serif");
            if (onAiStatusChange) {
              onAiStatusChange({ status: "success", message: "Solved" });
              setTimeout(() => onAiStatusChange({ status: "idle", message: "" }), 3000);
            }
          } else {
            if (onAiStatusChange) onAiStatusChange({ status: "error", message: "Couldn't understand this line" });
          }
        } catch (err) {
          removeResultByKey(canvas, aiStatusKey);
          if (onAiStatusChange) onAiStatusChange({ status: "error", message: "Error parsing line" });
        }
        continue;
      }

      if (error || formatted === undefined) {
        removeResultByKey(canvas, key);
        continue;
      }

      // Local Success
      if (onAiStatusChange) onAiStatusChange({ status: "success", message: "Solved" });

      // Calculate position for this specific line
      let resLeft, resTop, originY;

      if (stackBelow) {
        resLeft = bounds.left;
        resTop = bounds.top + bounds.height + GAP + lineIndex * (fontSize + 8);
        originY = "top";
      } else {
        resLeft = rightX;
        resTop = bounds.top + lineIndex * lineHeightPx + lineHeightPx / 2;
        originY = "center";
      }

      const displayFontSize = Math.max(16, Math.min(48, fontSize * 1.05));
      resLeft = Math.max(4, Math.min(resLeft, canvasW - displayFontSize * 8 - 4));
      resTop = Math.max(displayFontSize / 2, Math.min(resTop, canvasH - displayFontSize));

      const humanExpr = expression.split('').map(c => /[+*/=-]/.test(c) ? ` ${c} ` : c).join('').replace(/\s+/g, ' ').trim();
      const fullResultText = `${humanExpr} = ${formatted}`;
      
      placeResultAt(canvas, key, fullResultText, resLeft, resTop, displayFontSize, originY, obj.fontFamily || "'Inter', sans-serif");
      if (onAiStatusChange) {
        onAiStatusChange({ status: "success", message: "Solved" });
        setTimeout(() => onAiStatusChange({ status: "idle", message: "" }), 3000);
      }
    }

    // Clean up results for lines that no longer exist
    for (const key of resultMapRef.current.keys()) {
      if (!key.startsWith(`${uid}_line_`)) continue;
      const idx = parseInt(key.split('_line_')[1], 10);
      if (idx >= totalLines) removeResultByKey(canvas, key);
    }
  }

  // ── Place or Replace a Result Object at an exact canvas position ───────────
  function placeResultAt(canvas, key, formatted, left, top, fontSize, originY = "center", fontFamily = "'Kalam', 'Rock Salt', cursive", color = "#10b981") {
    removeResultByKey(canvas, key);

    const resText = new fabric.Text(formatted, {
      left,
      top,
      fontSize,
      fill: color,
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


  // ── AI Status Utility ────────────────────────────────────────────────────────
  function showCanvasAiStatus(text) {
    if (aiStatusLabelRef.current) {
      fabricRef.current.remove(aiStatusLabelRef.current);
    }
    const label = new fabric.Text(text, {
      left: 20,
      top: 20,
      fontSize: 20,
      fill: "#3b82f6",
      fontFamily: "'Outfit', sans-serif",
      fontWeight: 600,
      selectable: false,
      evented: false,
      opacity: 0,
    });
    aiStatusLabelRef.current = label;
    fabricRef.current.add(label);
    animateFadeIn(fabricRef.current, label, 200);

    if (onHistoryChange) {
      // We don't have a direct status bubble in history change 
      // but we could extend it if needed.
    }
  }

  function hideCanvasAiStatus() {
    if (aiStatusLabelRef.current) {
      fabricRef.current.remove(aiStatusLabelRef.current);
      aiStatusLabelRef.current = null;
    }
    // We don't call onAiStatusChange to idle here because of the indicator's auto-hide logic
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
    if (data.error) {
      if (onAiStatusChange) onAiStatusChange({ status: "error", message: "Failed, retrying..." });
      throw new Error(data.error);
    }

    const answers = Array.isArray(data.solution)
      ? data.solution
      : Array.isArray(data.answer)
        ? data.answer
        : [];

    if (answers.length > 0) {
      // ── Smart placement: cluster strokes into lines ──────
      const drawnObjects = canvas.getObjects().filter(
        (o) => !o.__isMathResult && o !== aiStatusLabelRef.current && o.type !== "i-text"
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

      const GAP = 14;
      const canvasW = canvas.getWidth();
      const canvasH = canvas.getHeight();

      // Helper to clean up math output for display
      const cleanMathOutput = (str) => {
        if (!str) return "";
        return str.replace(/\\frac{([^}]+)}{([^}]+)}/g, "($1)/($2)") // Fractions
                  .replace(/\\cdot/g, "*") // Multiplication dot
                  .replace(/\\times/g, "*") // Multiplication cross
                  .replace(/\\div/g, "/") // Division
                  .replace(/\\sqrt{([^}]+)}/g, "sqrt($1)") // Square root
                  .replace(/\\left\(/g, "(") // Left parenthesis
                  .replace(/\\right\)/g, ")") // Right parenthesis
                  .replace(/\\ /g, " ") // Escaped spaces
                  .replace(/\\text{([^}]+)}/g, "$1") // Text
                  .replace(/\\/g, "") // Any remaining backslashes
                  .trim();
      };

      // Use the new structured 'results' array from backend if available, otherwise fallback to index mapping
      const resultData = data.results || answers;

      resultData.forEach((item, index) => {
        const lineBox = lines[index] || lines[lines.length - 1];
        const exprHeight = lineBox.maxY - lineBox.minY;

        // Structured or simple?
        const answerText = typeof item === "object" ? (item.solution ? item.solution[0] : JSON.stringify(item)) : item;
        const inputExpression = typeof item === "object" ? item.expression : "";

        // Smart Scaling: 1.1x of expression height, clamped 16-40
        const displayFontSize = Math.max(16, Math.min(40, exprHeight * 1.1));

        let ansLeft = lineBox.maxX + GAP;
        let ansTop = lineBox.centerY;
        let ansOriginY = "center";

        // If the expression itself contains an '=', we should probably just show the solution
        const displayText = inputExpression && inputExpression.includes('=') ? cleanMathOutput(answerText) : `${cleanMathOutput(inputExpression)} = ${cleanMathOutput(answerText)}`;

        // Wrap to next line if it would overflow right edge
        const estimatedW = displayFontSize * displayText.length * 0.6;
        if (ansLeft + estimatedW > canvasW - 20) {
          ansLeft = lineBox.minX;
          ansTop = lineBox.maxY + 10;
          ansOriginY = "top";
        }
        ansTop = Math.max(displayFontSize / 2 + 4, Math.min(ansTop, canvasH - displayFontSize - 4));

        const key = `sketch_line_${Date.now()}_${index}`;
        placeResultAt(canvas, key, String(displayText), ansLeft, ansTop, displayFontSize, ansOriginY);
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
