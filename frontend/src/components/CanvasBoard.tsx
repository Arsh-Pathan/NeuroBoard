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
    
    // AI Magic Implementation
    const handleAIAction = async () => {
      if (!canvas) return
      
      // Get base64 image of the current viewport
      const dataUrl = canvas.toDataURL({
        format: 'png',
        quality: 0.8
      })

      try {
        const { aiService } = await import('../services/aiService')
        
        // Example: Run math solver by default for AI Magic tool
        const result = await aiService.solveMath(dataUrl)
        
        if (result.solution) {
           // Display result on canvas
           const text = new fabric.IText(`${result.equation} = ${result.solution}`, {
             left: 100,
             top: 100,
             fontSize: 30,
             fill: '#4f46e5',
             backgroundColor: '#f5f3ff',
             padding: 10
           })
           canvas.add(text)
           canvas.setActiveObject(text)
           canvas.renderAll()
        } else if (result.error) {
           console.warn('AI Math Error:', result.error)
        }
      } catch (err) {
        console.error('AI Action Failed:', err)
      }
    }

    const onMouseUp = () => {
      if (activeTool === 'ai') {
        handleAIAction()
      }
    }

    canvas.on('mouse:up', onMouseUp)

    return () => {
      canvas.off('mouse:up', onMouseUp)
    }

  }, [activeTool, brushColor, brushSize])

  return (
    <div className="w-full h-full relative cursor-crosshair">
      <canvas ref={canvasRef} />
    </div>
  )
}
