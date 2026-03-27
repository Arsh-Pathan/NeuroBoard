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
const CanvasBoard = forwardRef(({ activeTool, brushColor, brushSize }, ref) => {
  const canvasElRef = useRef(null);
  const fabricRef = useRef(null);
  const containerRef = useRef(null);
  const drawingRef = useRef(null);

  // Track the last result object per source IText so we can remove/replace it
  // Map<fabricObjId -> fabric.Text>
  const resultMapRef = useRef(new Map());

  // Debounce timer for text:changed
  const mathDebounceRef = useRef(null);

  // ── Initialize fabric canvas ───────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const canvas = new fabric.Canvas(canvasElRef.current, {
      width: container.offsetWidth,
      height: container.offsetHeight,
      backgroundColor: "#1e1e2e",
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
      resLeft = Math.max(4, Math.min(resLeft, canvasW - fontSize * 2 - 4));
      resTop  = Math.max(fontSize / 2, Math.min(resTop, canvasH - fontSize));

      placeResultAt(canvas, key, formatted, resLeft, resTop, fontSize, originY);
    });

    // Clean up results for lines that no longer exist (user deleted a line)
    for (const key of resultMapRef.current.keys()) {
      if (!key.startsWith(`${uid}_line_`)) continue;
      const idx = parseInt(key.split('_line_')[1], 10);
      if (idx >= totalLines) removeResultByKey(canvas, key);
    }
  }

  // ── Place or Replace a Result Object at an exact canvas position ───────────
  function placeResultAt(canvas, key, formatted, left, top, fontSize, originY = "center") {
    removeResultByKey(canvas, key);

    const resText = new fabric.Text(formatted, {
      left,
      top,
      fontSize,
      fill: "#a6e3a1",
      fontFamily: "'Rock Salt', cursive",
      selectable: true,
      evented: true,
      opacity: 0,
      originX: "left",
      originY,
      shadow: "rgba(0,0,0,0.5) 2px 2px 6px",
      __isMathResult: true,
      __resultKey: key,
    });

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
      const opacity = step / steps;
      obj.set("opacity", Math.min(1, opacity));
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

    // Status indicator
    const status = new fabric.Text("🧠 AI Solving...", {
      left: canvas.getWidth() / 2,
      top: 20,
      fontSize: 16,
      fill: "#a6e3a1",
      fontFamily: "Outfit",
      selectable: false,
      originX: "center",
      backgroundColor: "rgba(0,0,0,0.4)",
      padding: 8,
      __isMathResult: true,
    });
    canvas.add(status);
    canvas.renderAll();

    const dataURL = canvas.toDataURL({ format: "png", quality: 0.8, multiplier: 2 });

    try {
      const res = await fetch(`${apiUrl}/solve-sketch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataURL }),
      });
      const data = await res.json();
      canvas.remove(status);

      if (data.error) throw new Error(data.error);

      if (data.answer && Array.isArray(data.answer) && data.answer.length > 0) {
        // ── Smart placement: measure actual drawn content bounding box ──────
        // Ignore any existing result/UI objects so we only measure user strokes
        const drawnObjects = canvas.getObjects().filter(
          (o) => !o.__isMathResult && o !== status
        );

        // Compute the union bounding box of all drawn objects
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        drawnObjects.forEach((o) => {
          const b = o.getBoundingRect(true); // true = include stroke width
          if (b.left < minX) minX = b.left;
          if (b.top < minY) minY = b.top;
          if (b.left + b.width > maxX) maxX = b.left + b.width;
          if (b.top + b.height > maxY) maxY = b.top + b.height;
        });

        // Fallback if nothing drawn yet (shouldn't happen, but just in case)
        if (!isFinite(minX)) { minX = 50; minY = 50; maxX = 200; maxY = 100; }

        const exprHeight = maxY - minY;
        const exprCenterY = (minY + maxY) / 2;

        // Font size based on actual drawing height — clamped min 20, max 100
        const fontSize = Math.max(20, Math.min(100, exprHeight * 0.85));

        const GAP = 28; // gap between expression end and answer start
        const canvasW = canvas.getWidth();
        const canvasH = canvas.getHeight();

        // Default: place answer immediately to the RIGHT of the expression
        let ansLeft = maxX + GAP;
        let ansTop = exprCenterY;
        let ansOriginY = "center";

        // If placing to the right would overflow the canvas, drop BELOW instead
        const estimatedAnswerW = fontSize * 1.2; // conservative 1-char width estimate
        if (ansLeft + estimatedAnswerW > canvasW - 20) {
          ansLeft = minX;
          ansTop = maxY + GAP;
          ansOriginY = "top";
        }

        // Clamp vertically
        ansTop = Math.max(fontSize / 2 + 4, Math.min(ansTop, canvasH - fontSize - 4));

        data.answer.forEach((item) => {
          const marker = new fabric.Text(item.ans.toString(), {
            left: ansLeft,
            top: ansTop,
            fill: "#a6e3a1",
            fontSize,
            fontFamily: "'Rock Salt', cursive",
            selectable: true,
            originX: "left",
            originY: ansOriginY,
            shadow: "rgba(0,0,0,0.55) 2px 2px 7px",
            opacity: 0,
            __isMathResult: true,
          });
          canvas.add(marker);
          animateFadeIn(canvas, marker, 250);

          // Shift right for any subsequent answers (multiple expressions on canvas)
          ansLeft += marker.getBoundingRect().width + GAP;
        });
      } else {
        const noMath = new fabric.Text("❓ No Math Detected", {
          left: canvas.getWidth() / 2,
          top: 20,
          fontSize: 16,
          fill: "#f38ba8",
          fontFamily: "Outfit",
          selectable: false,
          originX: "center",
          __isMathResult: true,
        });
        canvas.add(noMath);
        setTimeout(() => { canvas.remove(noMath); canvas.renderAll(); }, 3000);
      }
      canvas.renderAll();
    } catch (err) {
      canvas.remove(status);
      console.error("Sketch solver error:", err);
      const errorBanner = new fabric.Text("❌ Error: Check AI Key", {
        left: canvas.getWidth() / 2,
        top: 20,
        fontSize: 16,
        fill: "white",
        backgroundColor: "#f38ba8",
        padding: 10,
        selectable: false,
        originX: "center",
        __isMathResult: true,
      });
      canvas.add(errorBanner);
      setTimeout(() => { canvas.remove(errorBanner); canvas.renderAll(); }, 4000);
    }
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
        break;
      case "pen":
        canvas.isDrawingMode = true;
        canvas.freeDrawingBrush.color = brushColor;
        canvas.freeDrawingBrush.width = brushSize * 1.5;
        break;
      case "eraser":
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
      canvas.clear();
      canvas.setBackgroundColor("#1e1e2e", () => canvas.renderAll());
    },

    solveSketchMath(apiUrl) {
      solveSketchMathInternal(apiUrl);
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
