import React, { useEffect, useRef, useCallback } from 'react'
import { fabric } from 'fabric'
import { useCanvasStore } from '../state/canvasStore'
import { aiService, DetectedShape, AIProcessResponse } from '../services/aiService'

export default function CanvasBoard() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fabricRef = useRef<fabric.Canvas | null>(null)

  const {
    activeTool,
    brushColor,
    brushSize,
    isAIProcessing,
    setAIProcessing,
    setAIError,
  } = useCanvasStore()

  // ---------- Initialize Canvas ----------
  useEffect(() => {
    if (!canvasRef.current) return

    const canvas = new fabric.Canvas(canvasRef.current, {
      width: window.innerWidth,
      height: window.innerHeight,
      isDrawingMode: false,
      backgroundColor: '#f8fafc',
    })

    fabricRef.current = canvas

    const handleResize = () => {
      canvas.setWidth(window.innerWidth)
      canvas.setHeight(window.innerHeight)
      canvas.renderAll()
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      canvas.dispose()
      fabricRef.current = null
    }
  }, [])

  // ---------- Snapshot System ----------
  const captureSnapshot = useCallback((): string => {
    const canvas = fabricRef.current
    if (!canvas) return ''

    // High-res base64 PNG of the current viewport
    return canvas.toDataURL({
      format: 'png',
      quality: 1.0,
      multiplier: 2, // 2x resolution for better OCR/shape detection
    })
  }, [])

  // ---------- Loading Overlay ----------
  const showLoadingOverlay = useCallback((): fabric.Group | null => {
    const canvas = fabricRef.current
    if (!canvas) return null

    const cx = canvas.getWidth() / 2
    const cy = canvas.getHeight() / 2

    const bg = new fabric.Rect({
      width: canvas.getWidth(),
      height: canvas.getHeight(),
      fill: 'rgba(248, 250, 252, 0.8)',
      originX: 'center',
      originY: 'center',
    })

    const spinner = new fabric.Circle({
      radius: 24,
      fill: 'transparent',
      stroke: '#6366f1',
      strokeWidth: 4,
      originX: 'center',
      originY: 'center',
      top: -20,
    })

    const label = new fabric.Text('AI is analyzing your canvas...', {
      fontSize: 16,
      fill: '#4f46e5',
      fontFamily: 'system-ui, sans-serif',
      originX: 'center',
      originY: 'center',
      top: 24,
    })

    const overlay = new fabric.Group([bg, spinner, label], {
      left: cx,
      top: cy,
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
      hoverCursor: 'default',
    })

    // Tag it so we can find and remove it later
    ;(overlay as any).__isAIOverlay = true

    canvas.add(overlay)
    canvas.renderAll()

    // Simple pulsing animation
    let growing = true
    const animate = () => {
      if (!(overlay as any).__isAIOverlay) return
      const scale = growing ? 1.05 : 0.95
      overlay.animate('scaleX', scale, {
        duration: 600,
        onChange: canvas.renderAll.bind(canvas),
        onComplete: () => {
          growing = !growing
          if ((overlay as any).__isAIOverlay) animate()
        },
      })
      overlay.animate('scaleY', scale, { duration: 600 })
    }
    animate()

    return overlay
  }, [])

  const removeLoadingOverlay = useCallback(() => {
    const canvas = fabricRef.current
    if (!canvas) return

    const overlays = canvas.getObjects().filter((o: fabric.Object) => (o as any).__isAIOverlay)
    overlays.forEach((o) => canvas.remove(o))
    canvas.renderAll()
  }, [])

  // ---------- Object Replacement: Insert Clean Shapes ----------
  const insertDetectedShapes = useCallback((shapes: DetectedShape[]) => {
    const canvas = fabricRef.current
    if (!canvas) return

    shapes.forEach((shape) => {
      let obj: fabric.Object | null = null

      switch (shape.type) {
        case 'circle': {
          const r = shape.radius || Math.min(shape.width, shape.height) / 2
          obj = new fabric.Circle({
            left: shape.x,
            top: shape.y,
            radius: r,
            fill: 'transparent',
            stroke: '#4f46e5',
            strokeWidth: 2,
            strokeUniform: true,
          })
          break
        }

        case 'rectangle': {
          obj = new fabric.Rect({
            left: shape.x,
            top: shape.y,
            width: shape.width,
            height: shape.height,
            fill: 'transparent',
            stroke: '#4f46e5',
            strokeWidth: 2,
            strokeUniform: true,
            rx: 4,
            ry: 4,
          })
          break
        }

        case 'triangle': {
          obj = new fabric.Triangle({
            left: shape.x,
            top: shape.y,
            width: shape.width,
            height: shape.height,
            fill: 'transparent',
            stroke: '#4f46e5',
            strokeWidth: 2,
            strokeUniform: true,
          })
          break
        }

        case 'diamond': {
          // Diamond as a rotated rectangle
          obj = new fabric.Rect({
            left: shape.x + shape.width / 2,
            top: shape.y,
            width: shape.width * 0.707,
            height: shape.height * 0.707,
            fill: 'transparent',
            stroke: '#4f46e5',
            strokeWidth: 2,
            strokeUniform: true,
            angle: 45,
            originX: 'center',
            originY: 'top',
          })
          break
        }

        case 'arrow': {
          const pts = shape.points
          if (pts && pts.length >= 4) {
            const [x1, y1, x2, y2] = pts
            // Main line
            const line = new fabric.Line([x1, y1, x2, y2], {
              stroke: '#4f46e5',
              strokeWidth: 2,
              selectable: true,
            })
            canvas.add(line)

            // Arrowhead
            const angle = Math.atan2(y2 - y1, x2 - x1)
            const headLen = 14
            const head = new fabric.Triangle({
              left: x2,
              top: y2,
              width: headLen,
              height: headLen,
              fill: '#4f46e5',
              angle: (angle * 180) / Math.PI + 90,
              originX: 'center',
              originY: 'center',
            })
            canvas.add(head)
          }
          return // skip the generic add below
        }

        case 'line': {
          const pts = shape.points
          if (pts && pts.length >= 4) {
            obj = new fabric.Line([pts[0], pts[1], pts[2], pts[3]], {
              stroke: '#4f46e5',
              strokeWidth: 2,
            })
          } else {
            obj = new fabric.Line(
              [shape.x, shape.y, shape.x + shape.width, shape.y + shape.height],
              { stroke: '#4f46e5', strokeWidth: 2 },
            )
          }
          break
        }
      }

      if (obj) {
        ;(obj as any).__isAIGenerated = true
        canvas.add(obj)
      }
    })

    canvas.renderAll()
  }, [])

  // ---------- Object Replacement: Insert Math Result ----------
  const insertMathResult = useCallback(
    (equation: string, solution: string) => {
      const canvas = fabricRef.current
      if (!canvas) return

      const displayText = `${equation}\n= ${solution}`
      const text = new fabric.IText(displayText, {
        left: 100,
        top: 100,
        fontSize: 28,
        fontFamily: 'Georgia, serif',
        fill: '#4f46e5',
        backgroundColor: '#f5f3ff',
        padding: 12,
        lineHeight: 1.4,
      })

      ;(text as any).__isAIGenerated = true
      canvas.add(text)
      canvas.setActiveObject(text)
      canvas.renderAll()
    },
    [],
  )

  // ---------- Remove Freehand Paths (the rough sketches) ----------
  const removeFreehandPaths = useCallback(() => {
    const canvas = fabricRef.current
    if (!canvas) return

    const paths = canvas.getObjects().filter(
      (obj: fabric.Object) => obj.type === 'path' && !(obj as any).__isAIGenerated,
    )
    paths.forEach((p: fabric.Object) => canvas.remove(p))
    canvas.renderAll()
  }, [])

  // ---------- AI Magic Handler ----------
  const handleAIAction = useCallback(async () => {
    const canvas = fabricRef.current
    if (!canvas || isAIProcessing) return

    setAIProcessing(true)
    setAIError(null)

    // 1. Capture high-res snapshot
    const snapshot = captureSnapshot()
    if (!snapshot) {
      setAIProcessing(false)
      setAIError('Failed to capture canvas')
      return
    }

    // 2. Show loading overlay
    showLoadingOverlay()

    try {
      // 3. Send to backend
      const result: AIProcessResponse = await aiService.processCanvas(snapshot)

      // 4. Remove overlay
      removeLoadingOverlay()

      if (result.error) {
        setAIError(result.error)
        setAIProcessing(false)
        return
      }

      const hasShapes = result.shapes.length > 0
      const hasMath = result.math !== null

      if (!hasShapes && !hasMath) {
        setAIError('No shapes or equations detected. Try drawing something first!')
        setAIProcessing(false)
        return
      }

      // 5. Remove original freehand paths
      removeFreehandPaths()

      // 6. Insert clean vectorized shapes
      if (hasShapes) {
        insertDetectedShapes(result.shapes)
      }

      // 7. Insert solved math
      if (hasMath && result.math) {
        insertMathResult(result.math.equation, result.math.solution)
      }
    } catch (err) {
      removeLoadingOverlay()
      console.error('AI Action Failed:', err)
      setAIError('AI processing failed unexpectedly')
    } finally {
      setAIProcessing(false)
    }
  }, [
    isAIProcessing,
    captureSnapshot,
    showLoadingOverlay,
    removeLoadingOverlay,
    removeFreehandPaths,
    insertDetectedShapes,
    insertMathResult,
    setAIProcessing,
    setAIError,
  ])

  // ---------- Handle Tool Changes ----------
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return

    canvas.isDrawingMode = activeTool === 'pen'

    if (canvas.isDrawingMode) {
      canvas.freeDrawingBrush = new fabric.PencilBrush(canvas)
      canvas.freeDrawingBrush.color = brushColor
      canvas.freeDrawingBrush.width = brushSize
    }

    if (activeTool === 'select') {
      canvas.selection = true
      canvas.getObjects().forEach((obj) => {
        obj.selectable = true
        obj.evented = true
      })
    } else {
      canvas.selection = false
      canvas.getObjects().forEach((obj) => {
        obj.selectable = false
        obj.evented = false
      })
    }

    // Trigger AI action on clicking the AI tool
    if (activeTool === 'ai') {
      handleAIAction()
    }
  }, [activeTool, brushColor, brushSize, handleAIAction])

  return (
    <div className="w-full h-full relative cursor-crosshair">
      <canvas ref={canvasRef} />
    </div>
  )
}
