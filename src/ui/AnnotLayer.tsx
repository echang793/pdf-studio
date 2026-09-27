import { useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { displaySize, rectFromDisplay, rectToDisplay, type Box } from '../core/geometry'
import type { Annot, PageRef, RGB } from '../core/model'
import { BoxEditor } from './BoxEditor'
import { DRAW_TOOLS, type Tool } from './tools'


interface Props {
  page: PageRef
  scale: number
  tool: Tool
  selected: string | null
  assetUrls: Record<string, string>
  onSelect: (id: string | null) => void
  /** New annotation area in display points. */
  onCreate: (tool: Tool, displayRect: Box) => void
  onMove: (id: string, rect: Box) => void
  onEditText: (id: string) => void
}

const css = (c: RGB) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`
const FAMILY = { Helvetica: 'Helvetica, Arial, sans-serif', Times: '"Times New Roman", Times, serif', Courier: '"Courier New", Courier, monospace' }

function Content({ a, page, scale, box, url }: { a: Annot; page: PageRef; scale: number; box: Box; url?: string }) {
  // Content is upright for the rotation it was placed at; counter-rotate if the page was rotated since.
  const diff = (((page.rotation - a.rotate) % 360) + 360) % 360
  const odd = diff === 90 || diff === 270
  const inner: CSSProperties = {
    position: 'absolute', left: '50%', top: '50%',
    width: odd ? box.height : box.width, height: odd ? box.width : box.height,
    transform: `translate(-50%, -50%) rotate(${diff}deg)`,
  }
  if (a.kind === 'rect') {
    return <div style={{ ...inner, background: a.fill ? css(a.fill) : 'transparent', border: a.stroke ? `${1.5 * scale}px solid ${css(a.stroke)}` : 'none', opacity: a.opacity, boxSizing: 'border-box' }} />
  }
  if (a.kind === 'image') return <img alt="" draggable={false} src={url} style={{ ...inner, objectFit: 'fill' }} />
  return (
    <div className="annot-copy" style={{ ...inner, fontSize: a.size * scale, lineHeight: 1.2, color: css(a.color), fontFamily: FAMILY[a.font] }}>
      {a.text || <span className="placeholder">Double-click to type</span>}
    </div>
  )
}

export function AnnotLayer({ page, scale, tool, selected, assetUrls, onSelect, onCreate, onMove, onEditText }: Props) {
  const size = displaySize(page.media, page.rotation)
  const bounds = { width: size.width * scale, height: size.height * scale }
  const [draft, setDraft] = useState<{ id: string; rect: Box } | null>(null)
  const [drawing, setDrawing] = useState<Box | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const layer = useRef<HTMLDivElement>(null)

  const local = (e: PointerEvent) => {
    const r = layer.current!.getBoundingClientRect()
    return { x: Math.min(Math.max(0, e.clientX - r.left), bounds.width), y: Math.min(Math.max(0, e.clientY - r.top), bounds.height) }
  }
  const down = (e: PointerEvent) => {
    onSelect(null)
    if (!DRAW_TOOLS.includes(tool)) return
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = local(e)
    setDrawing({ ...start.current, width: 0, height: 0 })
  }
  const move = (e: PointerEvent) => {
    const s = start.current
    if (!s) return
    const p = local(e)
    setDrawing({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), width: Math.abs(p.x - s.x), height: Math.abs(p.y - s.y) })
  }
  const up = () => {
    const r = drawing
    start.current = null
    setDrawing(null)
    if (!r) return
    // A click (no drag) creates a default-size box at that point.
    const def = tool === 'text' ? { w: 220, h: 36 } : { w: 140, h: 24 }
    const pt = r.width < 6 || r.height < 6
      ? { x: r.x / scale, y: r.y / scale, width: def.w, height: def.h }
      : { x: r.x / scale, y: r.y / scale, width: r.width / scale, height: r.height / scale }
    pt.width = Math.min(pt.width, size.width - pt.x)
    pt.height = Math.min(pt.height, size.height - pt.y)
    onCreate(tool, pt)
  }

  const toPx = (a: Annot): Box => {
    const d = rectToDisplay(page.media, page.rotation, a.rect)
    return { x: d.x * scale, y: d.y * scale, width: d.width * scale, height: d.height * scale }
  }
  const toUnrotated = (px: Box): Box =>
    rectFromDisplay(page.media, page.rotation, { x: px.x / scale, y: px.y / scale, width: px.width / scale, height: px.height / scale })

  return (
    <div
      ref={layer}
      className={`annot-layer tool-${tool}`}
      style={bounds}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      {page.annots.map((a) => {
        const box = draft?.id === a.id ? draft.rect : toPx(a)
        return (
          <BoxEditor
            key={a.id}
            rect={box}
            bounds={bounds}
            minSize={6}
            selected={selected === a.id}
            lockAspect={a.kind === 'image'}
            className={`annot annot-${a.kind}`}
            data-kind={a.kind === 'rect' ? 'shape' : a.kind}
            onSelect={() => onSelect(a.id)}
            onChange={(r) => setDraft({ id: a.id, rect: r })}
            onCommit={(r) => { setDraft(null); onMove(a.id, toUnrotated(r)) }}
          >
            <div className="annot-hit" onDoubleClick={() => a.kind === 'text' && onEditText(a.id)}>
              <Content a={a} page={page} scale={scale} box={box} url={a.kind === 'image' ? assetUrls[a.asset] : undefined} />
            </div>
          </BoxEditor>
        )
      })}
      {drawing && <div className="drawing" style={{ left: drawing.x, top: drawing.y, width: drawing.width, height: drawing.height }} />}
    </div>
  )
}
