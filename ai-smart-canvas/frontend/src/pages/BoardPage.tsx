import React from 'react'
import CanvasBoard from '../components/CanvasBoard'
import Toolbar from '../components/Toolbar'

export default function BoardPage() {
  return (
    <div className="relative w-full h-full bg-slate-50">
      <Toolbar />
      <CanvasBoard />
    </div>
  )
}
