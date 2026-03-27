import React from 'react'
import {
  MousePointer2,
  PenTool,
  Square,
  Circle,
  MoveUpRight,
  Type,
  Eraser,
  Sparkles
} from 'lucide-react'
import { useCanvasStore, Tool } from '../state/canvasStore'

const tools = [
  { id: 'select', icon: MousePointer2, label: 'Select' },
  { id: 'pen', icon: PenTool, label: 'Draw' },
  { id: 'rectangle', icon: Square, label: 'Rectangle' },
  { id: 'circle', icon: Circle, label: 'Circle' },
  { id: 'arrow', icon: MoveUpRight, label: 'Arrow' },
  { id: 'text', icon: Type, label: 'Text' },
  { id: 'eraser', icon: Eraser, label: 'Eraser' },
  { id: 'ai', icon: Sparkles, icon_color: 'text-purple-600', label: 'AI Magic' },
]

export default function Toolbar() {
  const { activeTool, setActiveTool } = useCanvasStore()

  return (
    <div className="absolute left-4 top-1/2 -translate-y-1/2 bg-white rounded-xl shadow-lg border border-slate-200 p-2 flex flex-col gap-2 z-10 w-14">
      {tools.map((t) => {
        const Icon = t.icon
        const isActive = activeTool === t.id
        return (
          <button
            key={t.id}
            onClick={() => setActiveTool(t.id as Tool)}
            title={t.label}
            className={`p-2 rounded-lg transition-colors flex justify-center items-center ${
              isActive
                ? 'bg-blue-100 text-blue-600'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
          </button>
        )
      })}
    </div>
  )
}
