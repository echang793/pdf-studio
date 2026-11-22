import { useCallback, useEffect, useRef, useState, type DragEvent, type PointerEvent } from 'react'
import { dilateMask, inpaint } from '../core/inpaint'
import { downloadBytes, isImageFile, readBytes } from './files'
import { Icon } from './icons'
import { useFitScale } from './useFitScale'

const MAX_DIM = 4096 // larger images are scaled down so fills stay fast and memory stays sane
const MARK = 'rgb(229, 72, 77)'

interface Patch { x: number; y: number; before: ImageData }
interface Loaded { name: string; bitmap: ImageBitmap; w: number; h: number; scaledFrom: [number, number] | null }

/** Paint over an unwanted mark on one of your own images and fill it in from its surroundings. */
export function ImageEraser({ onNotify }: { onNotify: (text: string, error?: boolean) => void }) {
  const [img, setImg] = useState<Loaded | null>(null)
  const [brush, setBrush] = useState(24)
  const [format, setFormat] = useState<'png' | 'jpeg'>('png')
  const [dirty, setDirty] = useState(false) // something painted but not erased yet
  const [edits, setEdits] = useState(0)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const base = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const history = useRef<Patch[]>([])
  const last = useRef<{ x: number; y: number } | null>(null)

  const scale = useFitScale(stage, img ? { width: img.w, height: img.h } : { width: 800, height: 600 })

  const draw = useCallback((l: Loaded) => {
    const c = base.current, o = overlay.current
    if (!c || !o) return
    c.width = o.width = l.w
    c.height = o.height = l.h
    c.getContext('2d')!.drawImage(l.bitmap, 0, 0, l.w, l.h)
    o.getContext('2d')!.clearRect(0, 0, l.w, l.h)
  }, [])

  useEffect(() => { if (img) draw(img) }, [img, draw])

  const open = async (file: File | undefined) => {
    if (!file) return
    if (!isImageFile(file)) return onNotify('Choose an image file (PNG, JPEG, WebP…)', true)
    try {
      const bitmap = await createImageBitmap(file)
      const k = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height))
      const w = Math.max(1, Math.round(bitmap.width * k))
      const h = Math.max(1, Math.round(bitmap.height * k))
      history.current = []
      setEdits(0)
      setDirty(false)
      setBrush(Math.max(8, Math.round(Math.min(w, h) / 40)))
      setImg((prev) => { prev?.bitmap.close(); return { name: file.name.replace(/\.[^.]+$/, ''), bitmap, w, h, scaledFrom: k < 1 ? [bitmap.width, bitmap.height] : null } })
    } catch {
      onNotify('Could not read that image', true)
    }
  }

  const pos = (e: PointerEvent) => {
    const r = overlay.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * img!.w, y: ((e.clientY - r.top) / r.height) * img!.h }
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
    if (!img) return
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

  const erase = () => {
    if (!img || !base.current || !overlay.current) return
    setBusy(true)
    // Let the "Filling…" state paint before the synchronous fill blocks the thread.
    setTimeout(() => {
      try {
        const { w, h } = img
        const marks = overlay.current!.getContext('2d')!.getImageData(0, 0, w, h).data
        const raw = new Uint8Array(w * h)
        for (let i = 0; i < raw.length; i++) if (marks[i * 4 + 3] > 0) raw[i] = 1
        const mask = dilateMask(raw, w, h, 2) // swallow the anti-aliased brush edge
        let x0 = w, y0 = h, x1 = -1, y1 = -1
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
        if (x1 < 0) { onNotify('Paint over the mark first', true); return }
        const pad = 10 // context around the marks, for the fill to sample from
        const rx = Math.max(0, x0 - pad), ry = Math.max(0, y0 - pad)
        const rw = Math.min(w, x1 + 1 + pad) - rx, rh = Math.min(h, y1 + 1 + pad) - ry
        const ctx = base.current!.getContext('2d')!
        const region = ctx.getImageData(rx, ry, rw, rh)
        const sub = new Uint8Array(rw * rh)
        for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) sub[y * rw + x] = mask[(y + ry) * w + (x + rx)]
        const before = ctx.getImageData(rx, ry, rw, rh)
        const { filled } = inpaint(region.data, sub, rw, rh, { radius: Math.min(24, Math.max(6, Math.round(brush / 2))) })
        if (filled === 0) { onNotify('Nothing to fill — the marked area covers the whole image', true); return }
        ctx.putImageData(region, rx, ry)
        history.current = [...history.current, { x: rx, y: ry, before }].slice(-20)
        setEdits(history.current.length)
        clearMarks()
        onNotify(`Filled ${filled.toLocaleString()} pixels`)
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
    if (!img) return
    history.current = []
    setEdits(0)
    draw(img)
    setDirty(false)
  }

  const download = () => {
    const c = base.current
    if (!c || !img) return
    c.toBlob(async (blob) => {
      if (!blob) return onNotify('Could not encode image', true)
      downloadBytes(await readBytes(blob), `${img.name}-clean.${format === 'png' ? 'png' : 'jpg'}`, blob.type)
      onNotify('Downloaded')
    }, format === 'png' ? 'image/png' : 'image/jpeg', 0.92)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.matches('input, textarea, select')
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo() }
      else if (e.key === 'Escape') clearMarks()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, clearMarks])

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setOver(false)
    open([...e.dataTransfer.files].find(isImageFile))
  }

  const input = <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => { open(e.target.files?.[0]); e.target.value = '' }} />

  if (!img) {
    return (
      <main className="empty mat" onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
        <div className="hero">
          <h1>Erase marks <em>&amp;</em> blemishes.</h1>
          <p>Paint over something unwanted in a photo and it fills in from around it.</p>
        </div>
        <button className={`dropzone ${over ? 'over' : ''}`} onClick={() => fileInput.current?.click()}>
          <span className="corner c-nw" /><span className="corner c-ne" /><span className="corner c-sw" /><span className="corner c-se" />
          <Icon name="image" size={44} stroke={1.6} />
          <strong>Drop an image here</strong>
          <span className="btn primary big">Choose image</span>
        </button>
        <p className="hint" style={{ color: 'var(--mat-text)', maxWidth: 520, textAlign: 'center' }}>
          Runs entirely in your browser. Use it on images you own or have permission to edit — it isn’t for stripping
          other people’s copyright marks.
        </p>
        {input}
      </main>
    )
  }

  return (
    <div className="workspace eraser" onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      <div className="stage-wrap mat">
        <span className="ruler corner" />
        <span className="ruler h" />
        <span className="ruler v" />
        <main className="stage" ref={stage}>
          <div className="page-wrap" style={{ width: img.w * scale, height: img.h * scale, cursor: 'crosshair' }}>
            <canvas ref={base} style={{ width: '100%', height: '100%' }} />
            <canvas
              ref={overlay} aria-label="Paint over the area to erase"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.55, touchAction: 'none' }}
              onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
            />
          </div>
        </main>
        <div className="zoom"><span className="pageno">{img.w} × {img.h} px</span></div>
      </div>
      <aside className="side">
        <div className="panel">
          <div className="panel-head">
            <h2>Erase</h2>
            <p className="hint">Paint over the mark, then press Erase. Small passes on one spot at a time look best.</p>
          </div>
          <label className="field-label">
            Brush size · {brush}px
            <input type="range" min={4} max={Math.max(60, Math.round(Math.max(img.w, img.h) / 8))} value={brush} onChange={(e) => setBrush(Number(e.target.value))} style={{ accentColor: 'var(--accent)' }} />
          </label>
          <div className="group">
            <button className="btn primary big" disabled={!dirty || busy} onClick={erase}>
              <Icon name="check" stroke={2.2} />{busy ? 'Filling…' : 'Erase marked area'}
            </button>
            <div className="grid2">
              <button className="btn" disabled={!dirty || busy} onClick={clearMarks}><Icon name="close" size={16} />Clear marks</button>
              <button className="btn" disabled={!edits || busy} onClick={undo}><Icon name="undo" size={16} />Undo fill</button>
            </div>
            <button className="btn ghost" disabled={(!edits && !dirty) || busy} onClick={reset}>Reset to original</button>
          </div>

          <div className="group divided">
            <span className="eyebrow">Save</span>
            <label className="field-label">
              Format
              <span className="field">
                <select value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
                  <option value="png">PNG · lossless</option>
                  <option value="jpeg">JPEG · smaller</option>
                </select>
              </span>
            </label>
            <button className="btn" onClick={download}><Icon name="download" size={16} />Download image</button>
            <button className="btn ghost" onClick={() => fileInput.current?.click()}>Open a different image</button>
          </div>

          {img.scaledFrom && (
            <div className="note"><Icon name="info" size={20} /><p>Scaled down from {img.scaledFrom[0]} × {img.scaledFrom[1]} px so the fill stays fast.</p></div>
          )}
          <div className="note">
            <Icon name="info" size={20} />
            <p>This is a plain fill: great on skies, walls and gradients, soft on busy textures. Use it on images you own or may edit.</p>
          </div>
        </div>
      </aside>
      {input}
    </div>
  )
}
