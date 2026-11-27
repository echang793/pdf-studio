import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { DEFAULT_TINT, fill, readMask, type FillMode, type Patch, type TintSettings } from '../render/fill'

const MARK = 'rgb(229, 72, 77)'

/** Pixels to paint on, drawn into the base canvas whenever a new source is loaded. */
export interface EraserSource { w: number; h: number; draw: (ctx: CanvasRenderingContext2D) => void }

interface Options {
  onNotify: (text: string, error?: boolean) => void
  /** Handle ⌘Z / Esc here (the image tool). The PDF tool leaves ⌘Z to the document's own undo. */
  keys?: boolean
  /** Called after each fill with the edited canvas; the fill stays "busy" until it resolves. */
  onFilled?: (canvas: HTMLCanvasElement) => Promise<void>
}

/** Painting + filling on a canvas pair, shared by the Image tab and the PDF page eraser. */
export function useEraser({ onNotify, keys = true, onFilled }: Options) {
  const [source, setSource] = useState<EraserSource | null>(null)
  const [brush, setBrush] = useState(24)
  const [dirty, setDirty] = useState(false) // something painted but not erased yet
  const [edits, setEdits] = useState(0)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<FillMode>('tint')
  const [tint, setTint] = useState<TintSettings>(DEFAULT_TINT)
  const [picking, setPicking] = useState(false) // next click samples the watermark colour instead of painting
  const [ai, setAi] = useState<{ label: string; done: number; total: number } | null>(null)
  const base = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  const history = useRef<Patch[]>([])
  const last = useRef<{ x: number; y: number } | null>(null)
  const filledCb = useRef(onFilled)
  useEffect(() => { filledCb.current = onFilled })

  const draw = useCallback((s: EraserSource) => {
    const c = base.current, o = overlay.current
    if (!c || !o) return
    c.width = o.width = s.w
    c.height = o.height = s.h
    s.draw(c.getContext('2d')!)
    o.getContext('2d')!.clearRect(0, 0, s.w, s.h)
  }, [])
  useEffect(() => { if (source) draw(source) }, [source, draw])

  const load = useCallback((s: EraserSource, brushSize?: number) => {
    history.current = []
    setEdits(0)
    setDirty(false)
    if (brushSize) setBrush(brushSize)
    setSource(s)
  }, [])

  const pos = (e: PointerEvent) => {
    const r = overlay.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * source!.w, y: ((e.clientY - r.top) / r.height) * source!.h }
  }
  const stroke = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const ctx = overlay.current!.getContext('2d')!
    ctx.strokeStyle = ctx.fillStyle = MARK
    ctx.lineCap = ctx.lineJoin = 'round'
    ctx.lineWidth = brush
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(to.x, to.y, brush / 2, 0, Math.PI * 2)
    ctx.fill()
  }
  const down = (e: PointerEvent) => {
    if (!source || busy) return
    if (picking) {
      // Average a small square so a single anti-aliased pixel can't skew the pick.
      const p = pos(e)
      const r = Math.max(1, Math.round(source.w / 600))
      const x = Math.max(0, Math.round(p.x) - r), y = Math.max(0, Math.round(p.y) - r)
      const d = base.current!.getContext('2d')!.getImageData(x, y, 2 * r + 1, 2 * r + 1).data
      const sum = [0, 0, 0]
      for (let i = 0; i < d.length; i += 4) { sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2] }
      const n = d.length / 4
      setTint((t) => ({ ...t, mark: [sum[0] / n, sum[1] / n, sum[2] / n] }))
      setPicking(false)
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = pos(e)
    last.current = p
    stroke(p, p)
    setDirty(true)
  }
  const move = (e: PointerEvent) => {
    if (!last.current) return
    const p = pos(e)
    stroke(last.current, p)
    last.current = p
  }
  const up = () => { last.current = null }

  const clearMarks = useCallback(() => {
    const o = overlay.current
    o?.getContext('2d')!.clearRect(0, 0, o.width, o.height)
    setDirty(false)
  }, [])

  /** Replace the painted marks with a 0/1 mask (any size; stretched to the canvas), e.g. from automatic detection. */
  const setMarks = useCallback((mask: Uint8Array, mw: number, mh: number) => {
    const o = overlay.current
    if (!o || !o.width) return
    const tmp = document.createElement('canvas')
    tmp.width = mw
    tmp.height = mh
    const img = tmp.getContext('2d')!.createImageData(mw, mh)
    for (let i = 0; i < mask.length; i++) if (mask[i]) { img.data[i * 4] = 229; img.data[i * 4 + 1] = 72; img.data[i * 4 + 2] = 77; img.data[i * 4 + 3] = 255 }
    tmp.getContext('2d')!.putImageData(img, 0, 0)
    const ctx = o.getContext('2d')!
    ctx.clearRect(0, 0, o.width, o.height)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(tmp, 0, 0, o.width, o.height)
    setDirty(mask.some((v) => v === 1))
  }, [])

  /** The painted marks as a 0/1 mask at the canvas's own size (undilated), for applying to other pages. */
  const marksMask = useCallback((): { mask: Uint8Array; w: number; h: number } | null => {
    const o = overlay.current
    if (!o || !o.width) return null
    const data = o.getContext('2d')!.getImageData(0, 0, o.width, o.height).data
    const mask = new Uint8Array(o.width * o.height)
    let any = false
    for (let i = 0; i < mask.length; i++) if (data[i * 4 + 3] > 0) { mask[i] = 1; any = true }
    return any ? { mask, w: o.width, h: o.height } : null
  }, [])

  const erase = () => {
    if (!source || !base.current || !overlay.current) return
    const found = readMask(overlay.current.getContext('2d')!.getImageData(0, 0, source.w, source.h))
    if (!found) return onNotify('Paint over the mark first', true)
    setBusy(true)
    // Let the busy state paint before heavy work blocks the thread.
    setTimeout(async () => {
      try {
        const ctx = base.current!.getContext('2d')!
        const r = await fill(mode, ctx, source.w, source.h, found.mask, found.bounds, brush, (label, done, total) => setAi({ label, done, total }), tint)
        setAi(null)
        if (r.unchanged) return onNotify(r.message, true) // nothing changed: keep the marks so they can be adjusted
        history.current = [...history.current, r.patch].slice(-20)
        setEdits(history.current.length)
        clearMarks()
        await filledCb.current?.(base.current!)
        onNotify(r.message, r.failed)
      } catch (e) {
        setAi(null)
        onNotify(e instanceof Error ? e.message : String(e), true)
      } finally {
        setBusy(false)
      }
    }, 20)
  }

  const undo = useCallback(() => {
    const p = history.current.at(-1)
    if (!p || !base.current) return
    base.current.getContext('2d')!.putImageData(p.before, p.x, p.y)
    history.current = history.current.slice(0, -1)
    setEdits(history.current.length)
  }, [])

  const reset = () => {
    if (!source) return
    history.current = []
    setEdits(0)
    draw(source)
    setDirty(false)
  }

  useEffect(() => {
    if (!keys) return
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.matches('input, textarea, select')
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo() }
      else if (e.key === 'Escape') clearMarks()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keys, undo, clearMarks])

  return { source, base, overlay, brush, setBrush, dirty, edits, busy, setBusy, mode, setMode, tint, setTint, picking, setPicking, ai, setAi, load, down, move, up, clearMarks, setMarks, marksMask, erase, undo, reset }
}
export type Eraser = ReturnType<typeof useEraser>
