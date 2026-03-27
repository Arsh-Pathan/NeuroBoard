import React, {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
} from "react";
import { fabric } from "fabric";

/**
 * Fabric.js based CanvasBoard
 * Support for Drawing Shapes, Text, and "Cleaning" diagrams.
 */
const CanvasBoard = forwardRef(({ activeTool, brushColor, brushSize }, ref) => {
  const canvasElRef = useRef(null);
  const fabricRef = useRef(null);
  const containerRef = useRef(null);
  const drawingRef = useRef(null);

  // Initialize fabric canvas
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

    const handleResize = () => {
      canvas.setWidth(container.offsetWidth);
      canvas.setHeight(container.offsetHeight);
      canvas.renderAll();
    };
    window.addEventListener("resize", handleResize);

    // --- TYPED MATH SOLVER (IText) ---
    canvas.on("text:changed", (opt) => {
      const obj = opt.target;
      if (!obj || obj.type !== "i-text") return;
      const text = obj.text.trim();
      if (text.endsWith("=") && text.length > 2) {
        const expression = text.slice(0, -1);
        try {
          if (/^[0-9+\-*/().\s]+$/.test(expression)) {
            const result = eval(expression);
            const resText = new fabric.Text(result.toString(), {
              left: obj.left + obj.getBoundingRect().width + 25,
              top: obj.top,
              fontSize: 45,
              fill: "#a6e3a1",
              fontFamily: "'Rock Salt', cursive",
              selectable: true,
              angle: Math.random() * 10 - 5,
            });
            canvas.add(resText);
            canvas.renderAll();
          }
        } catch (e) { console.error(e); }
      }
    });

    // --- AUTO-SOLVE SKETCH (DEBOUNCED) ---
    let solveTimer = null;
    canvas.on("path:created", () => {
      if (solveTimer) clearTimeout(solveTimer);
      // Start a 2.5-second timer. If no more drawing occurs, solve it.
      solveTimer = setTimeout(async () => {
        try {
          await solveSketchMathInternal(`http://localhost:3001/api`);
        } catch (e) {
          console.log("No math detected");
        }
      }, 2500);
    });

    return () => {
      window.removeEventListener("resize", handleResize);
      canvas.dispose();
    };
  }, []);

  // Use a helper function for vision solve
  async function solveSketchMathInternal(apiUrl) {
    const canvas = fabricRef.current;
    if (!canvas) return;

    // Cleanup: only remove placeholders if any exist
    const objects = canvas.getObjects();
    const placeholders = objects.filter(o => o.type === 'i-text' && (o.text === 'Type Here' || !o.text.trim()));
    placeholders.forEach(o => canvas.remove(o));

    // Show status indicator
    const status = new fabric.Text("🧠 AI Solving...", {
      left: canvas.getWidth() / 2, top: 20, fontSize: 16, fill: "#a6e3a1",
      fontFamily: "Outfit", selectable: false, originX: "center",
      backgroundColor: "rgba(0,0,0,0.4)", padding: 8
    });
    canvas.add(status);
    canvas.renderAll();

    // Better resolution for AI 
    const dataURL = canvas.toDataURL({ format: "png", quality: 0.6, multiplier: 1 });

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
        data.answer.forEach((item) => {
          const x = (item.x / 100) * canvas.getWidth();
          const y = (item.y / 100) * canvas.getHeight();
          const marker = new fabric.Text(item.ans.toString(), {
            left: x, top: y, fill: "#a6e3a1", fontSize: 70,
            fontFamily: "'Rock Salt', cursive", angle: item.angle || 0,
            selectable: true, originX: "left", originY: "center",
            shadow: "rgba(0,0,0,0.5) 2px 2px 8px"
          });
          canvas.add(marker);
        });
      } else {
        // Show "No Math" briefly if AI finds nothing
        const noMath = new fabric.Text("❓ No Math Detected (Check =)", {
          left: canvas.getWidth() / 2, top: 20, fontSize: 16, fill: "#f38ba8",
          fontFamily: "Outfit", selectable: false, originX: "center"
        });
        canvas.add(noMath);
        setTimeout(() => canvas.remove(noMath), 3000);
      }
      canvas.renderAll();
    } catch (err) {
      canvas.remove(status);
      console.error("Sketch solver error:", err);
      // Show error toast on canvas
      const errorBanner = new fabric.Text(`❌ Error: Check AI Key`, {
        left: canvas.getWidth() / 2, top: 20, fontSize: 16, fill: "white",
        backgroundColor: "#f38ba8", padding: 10, selectable: false, originX: "center"
      });
      canvas.add(errorBanner);
      setTimeout(() => canvas.remove(errorBanner), 4000);
    }
  }

  // Update canvas state based on tools
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
          if (target) { canvas.remove(target); canvas.renderAll(); }
        });
        break;
      case "text":
        canvas.on("mouse:down", (opt) => {
          const pointer = canvas.getPointer(opt.e);
          const iText = new fabric.IText("Type Here", {
            left: pointer.x, top: pointer.y, fill: brushColor,
            fontSize: brushSize * 8, fontFamily: "'Inter', sans-serif"
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

  // -- SHAPE HANDLERS --
  function handleShapeStart(opt) {
    const canvas = fabricRef.current;
    const pointer = canvas.getPointer(opt.e);
    drawingRef.current = { startX: pointer.x, startY: pointer.y, shape: null };
    const config = { fill: "transparent", stroke: brushColor, strokeWidth: brushSize, selectable: false };
    let shp;
    if (activeTool === "rectangle") shp = new fabric.Rect({ ...config, left: pointer.x, top: pointer.y, width: 0, height: 0 });
    else if (activeTool === "circle") shp = new fabric.Ellipse({ ...config, left: pointer.x, top: pointer.y, rx: 0, ry: 0 });
    else if (activeTool === "arrow") shp = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], { ...config });
    if (shp) { drawingRef.current.shape = shp; canvas.add(shp); }
  }

  function handleShapeMove(opt) {
    if (!drawingRef.current || !drawingRef.current.shape) return;
    const canvas = fabricRef.current;
    const pointer = canvas.getPointer(opt.e);
    const { startX, startY, shape } = drawingRef.current;
    if (activeTool === "rectangle") {
      shape.set({ left: Math.min(startX, pointer.x), top: Math.min(startY, pointer.y), width: Math.abs(pointer.x - startX), height: Math.abs(pointer.y - startY) });
    } else if (activeTool === "circle") {
      shape.set({ left: Math.min(startX, pointer.x), top: Math.min(startY, pointer.y), rx: Math.abs(pointer.x - startX) / 2, ry: Math.abs(pointer.y - startY) / 2 });
    } else if (activeTool === "arrow") {
      shape.set({ x2: pointer.x, y2: pointer.y });
    }
    shape.setCoords(); canvas.renderAll();
  }

  function handleShapeEnd() { drawingRef.current = null; }

  function processPathCleanup(obj) {
    if (!obj || obj.type !== "path") return;
    const canvas = fabricRef.current;
    const b = obj.getBoundingRect();
    if (b.width < 10 && b.height < 10) return;
    let s;
    const st = { left: b.left, top: b.top, fill: "transparent", stroke: "white", strokeWidth: 2, selectable: true };
    if (Math.abs(b.width - b.height) < 20) s = new fabric.Circle({ ...st, radius: Math.max(b.width, b.height) / 2 });
    else if (b.height < 15) s = new fabric.Line([b.left, b.top + b.height / 2, b.left + b.width, b.top + b.height / 2], { ...st });
    else s = new fabric.Rect({ ...st, width: b.width, height: b.height });
    if (s) { canvas.remove(obj); canvas.add(s); canvas.renderAll(); }
  }

  useImperativeHandle(ref, () => ({
    addText(content) {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const text = new fabric.Text(content, {
        left: canvas.getWidth() / 2, top: canvas.getHeight() / 2,
        fill: "#a6e3a1", fontSize: 60, fontFamily: "'Rock Salt', cursive"
      });
      canvas.add(text); canvas.centerObject(text); canvas.renderAll();
    },
    clearCanvas() {
      const canvas = fabricRef.current;
      if (!canvas) return;
      canvas.clear(); canvas.setBackgroundColor("#1e1e2e", () => canvas.renderAll());
    },
    solveSketchMath(apiUrl) { solveSketchMathInternal(apiUrl); },
    cleanDiagram() {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const paths = canvas.getObjects().filter(o => o.type === "path");
      paths.forEach(processPathCleanup);
    }
  }));

  return (
    <div ref={containerRef} className="canvas-container">
      <canvas ref={canvasElRef} id="main-canvas" />
    </div>
  );
});

CanvasBoard.displayName = "CanvasBoard";
export default CanvasBoard;
