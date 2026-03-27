import { create } from 'zustand'

export type Tool = 'select' | 'pen' | 'rectangle' | 'circle' | 'arrow' | 'text' | 'eraser' | 'ai'

interface CanvasState {
  activeTool: Tool
  setActiveTool: (tool: Tool) => void
  brushColor: string
  setBrushColor: (color: string) => void
  brushSize: number
  setBrushSize: (size: number) => void
}

export const useCanvasStore = create<CanvasState>((set) => ({
  activeTool: 'select',
  setActiveTool: (tool) => set({ activeTool: tool }),
  brushColor: '#000000',
  setBrushColor: (color) => set({ brushColor: color }),
  brushSize: 3,
  setBrushSize: (size) => set({ brushSize: size }),
}))
