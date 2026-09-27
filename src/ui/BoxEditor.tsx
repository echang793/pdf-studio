import { useRef, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { dragRect, type Handle } from '../core/drag'
import type { Box, Size } from '../core/geometry'

const HANDLES: Exclude<Handle, 'move'>[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

interface Props {
  /** Rect in pixels relative to the page area. */
  rect: Box
  bounds: Size
  onChange: (r: Box) => void
  onCommit?: (r: Box) => void
  onSelect?: () => void
  selected?: boolean
  minSize?: number
  /** Keep the aspect ratio while resizing from corners (images, signatures). */
  lockAspect?: boolean
  className?: string
  style?: CSSProperties
  children?: ReactNode
  /** Label shown on the selected item (CSS reads it). */
  'data-kind'?: string
}

/** A draggable, resizable rectangle with 8 handles. Works with mouse, pen and touch. */
export function BoxEditor({ rect, bounds, onChange, onCommit, onSelect, selected = true, minSize = 8, lockAspect = false, className = '', style, children, 'data-kind': kind }: Props) {
  const drag = useRef<{ h: Handle; px: number; py: number; start: Box; last: Box } | null>(null)

  const down = (h: Handle) => (e: PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    onSelect?.()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { h, px: e.clientX, py: e.clientY, start: rect, last: rect }
  }
  const move = (e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    d.last = dragRect(d.start, d.h, e.clientX - d.px, e.clientY - d.py, bounds, minSize, lockAspect)
    onChange(d.last)
  }
  const up = () => {
    const d = drag.current
    drag.current = null
    if (d && (d.last !== d.start)) onCommit?.(d.last)
  }

  return (
    <div
      className={`box-editor ${selected ? 'selected' : ''} ${className}`}
      data-kind={kind}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, ...style }}
      onPointerDown={down('move')}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      {children}
      {selected && HANDLES.map((h) => (
        <span key={h} className={`handle h-${h}`} onPointerDown={down(h)} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      ))}
    </div>
  )
}
