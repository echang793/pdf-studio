import { useRef, type PointerEvent } from 'react'
import type { Box, Margins, Size } from '../core/geometry'
import { BoxEditor } from './BoxEditor'

interface Props {
  size: Size // display size in pt
  scale: number
  margins: Margins
  onChange: (m: Margins) => void
}

const toRect = (s: Size, m: Margins, k: number): Box => ({
  x: m.left * k,
  y: m.top * k,
  width: (s.width - m.left - m.right) * k,
  height: (s.height - m.top - m.bottom) * k,
})
const toMargins = (s: Size, r: Box, k: number): Margins => ({
  left: r.x / k,
  top: r.y / k,
  right: s.width - (r.x + r.width) / k,
  bottom: s.height - (r.y + r.height) / k,
})

/** Dimmed crop frame over the page. Drag the frame/handles, or drag on the dimmed area to draw a new one. */
export function CropOverlay({ size, scale, margins, onChange }: Props) {
  const bounds = { width: size.width * scale, height: size.height * scale }
  const rect = toRect(size, margins, scale)
  const draw = useRef<{ x: number; y: number } | null>(null)
  const layer = useRef<HTMLDivElement>(null)

  const local = (e: PointerEvent) => {
    const r = layer.current!.getBoundingClientRect()
    return { x: Math.min(Math.max(0, e.clientX - r.left), bounds.width), y: Math.min(Math.max(0, e.clientY - r.top), bounds.height) }
  }
  const down = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    draw.current = local(e)
  }
  const move = (e: PointerEvent) => {
    const s = draw.current
    if (!s) return
    const p = local(e)
    const r = { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), width: Math.abs(p.x - s.x), height: Math.abs(p.y - s.y) }
    if (r.width > 4 && r.height > 4) onChange(toMargins(size, r, scale))
  }
  const up = () => { draw.current = null }

  return (
    <div ref={layer} className="crop-layer" style={bounds} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div className="crop-clip"><div className="crop-hole" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} /></div>
      <BoxEditor rect={rect} bounds={bounds} onChange={(r) => onChange(toMargins(size, r, scale))} className="crop-box">
        <span className="crop-dims">
          {Math.round(rect.width / scale)} × {Math.round(rect.height / scale)} pt
        </span>
      </BoxEditor>
    </div>
  )
}
