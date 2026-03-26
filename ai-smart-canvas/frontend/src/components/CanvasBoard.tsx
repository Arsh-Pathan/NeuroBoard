import React, { useEffect, useRef } from 'react'
import { fabric } from 'fabric'
import { useCanvasStore } from '../state/canvasStore'

export default function CanvasBoard() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fabricRef = useRef<fabric.Canvas | null>(null)
  
  const { activeTool, brushColor, brushSize } = useCanvasStore()

  // Initialize Canvas
  useEffect(() => {
    if (!canvasRef.current) return

    const canvas = new fabric.Canvas(canvasRef.current, {
      width: window.innerWidth,
      height: window.innerHeight,
      isDrawingMode: false,
      backgroundColor: '#f8fafc',
    })
    
    fabricRef.current = canvas

    // Resize handling
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

  // Handle Tool Changes
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return

    canvas.isDrawingMode = activeTool === 'pen'

    if (canvas.isDrawingMode) {
      canvas.freeDrawingBrush = new fabric.PencilBrush(canvas)
      canvas.freeDrawingBrush.color = brushColor
      canvas.freeDrawingBrush.width = brushSize
    }

    // Manage selectability for non-drawing tools
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
    
    // Additional logic for generating shapes when user clicks & drags could be added here
    // e.g., tracking mouse down/move/up for shapes

  }, [activeTool, brushColor, brushSize])

  return (
    <div className="w-full h-full relative cursor-crosshair">
      <canvas ref={canvasRef} />
    </div>
  )
}
