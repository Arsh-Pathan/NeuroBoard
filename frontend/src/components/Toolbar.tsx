import React, { useEffect } from 'react'
import {
  MousePointer2,
  PenTool,
  Square,
  Circle,
  MoveUpRight,
  Type,
  Eraser,
  Sparkles,
  Loader2,
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
] as const

export default function Toolbar() {
  const { activeTool, setActiveTool, isAIProcessing, aiError, setAIError } = useCanvasStore()

  // Auto-dismiss error toast after 4 seconds
  useEffect(() => {
    if (!aiError) return
    const timer = setTimeout(() => setAIError(null), 4000)
    return () => clearTimeout(timer)
  }, [aiError, setAIError])

  return (
    <>
      {/* Tool Palette */}
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

        {/* AI Magic Button — special styling */}
        <div className="border-t border-slate-200 pt-2 mt-1">
          <button
            onClick={() => setActiveTool('ai')}
            disabled={isAIProcessing}
            title={isAIProcessing ? 'Processing...' : 'AI Magic'}
            className={`p-2 rounded-lg transition-all flex justify-center items-center w-full ${
              isAIProcessing
                ? 'bg-purple-100 text-purple-400 cursor-wait'
                : activeTool === 'ai'
                  ? 'bg-purple-100 text-purple-600 ring-2 ring-purple-300'
                  : 'text-purple-600 hover:bg-purple-50 hover:text-purple-700'
            }`}
          >
            {isAIProcessing ? (
              <Loader2 size={20} strokeWidth={2.5} className="animate-spin" />
            ) : (
              <Sparkles size={20} strokeWidth={activeTool === 'ai' ? 2.5 : 2} />
            )}
          </button>
        </div>
      </div>

      {/* Error Toast */}
      {aiError && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg shadow-lg text-sm flex items-center gap-2 max-w-md">
            <span className="shrink-0">!</span>
            <span>{aiError}</span>
            <button
              onClick={() => setAIError(null)}
              className="ml-2 text-red-400 hover:text-red-600 shrink-0"
            >
              x
            </button>
          </div>
        </div>
      )}

      {/* Processing Banner */}
      {isAIProcessing && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50">
          <div className="bg-purple-50 border border-purple-200 text-purple-700 px-4 py-2 rounded-lg shadow-lg text-sm flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            <span>AI is analyzing your canvas...</span>
          </div>
        </div>
      )}
    </>
  )
}
