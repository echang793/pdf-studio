import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FILLING } from '../render/fill'
import type { Eraser } from './useEraser'
import { useFitScale } from './useFitScale'

/** How to show the untouched original for before/after: `key` changes when the original does. */
export interface Original { key: string; get: () => Promise<HTMLCanvasElement> }

/** The paintable canvas pair, fitted to the available space. Hold "Compare" (or the C key) to see the original. */
export function EraserStage({ eraser, footer, original }: { eraser: Eraser; footer?: ReactNode; original?: Original }) {
  const stage = useRef<HTMLDivElement>(null)
  const { source } = eraser
  const [peek, setPeek] = useState(false)
  const [url, setUrl] = useState<{ key: string; url: string } | null>(null)
  const loading = useRef<string | null>(null)
  const want = original?.key ?? null

  const show = async () => {
    if (!original) return
    setPeek(true)
    if (url?.key === original.key || loading.current === original.key) return
    loading.current = original.key
    try {
      const c = await original.get()
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
      if (blob && loading.current === original.key) setUrl((old) => { if (old) URL.revokeObjectURL(old.url); return { key: original.key, url: URL.createObjectURL(blob) } })
    } finally {
      loading.current = null
    }
  }
  const hide = () => setPeek(false)
  const showRef = useRef(show)
  useEffect(() => { showRef.current = show })
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
    const down = (e: KeyboardEvent) => { if ((e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey && !e.repeat && !typing(e.target)) showRef.current() }
    const up = (e: KeyboardEvent) => { if (e.key === 'c' || e.key === 'C') setPeek(false) }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', hide)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', hide) }
  }, [])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url.url) }, [url])
  const showing = peek && url && url.key === want
  const scale = useFitScale(stage, source ? { width: source.w, height: source.h } : { width: 800, height: 600 })
  return (
    <div className="stage-wrap mat">
      <span className="ruler corner" />
      <span className="ruler h" />
      <span className="ruler v" />
      <main className="stage" ref={stage}>
        <div className="page-wrap" style={{ width: (source?.w ?? 0) * scale, height: (source?.h ?? 0) * scale, cursor: 'crosshair' }}>
          <canvas ref={eraser.base} style={{ width: '100%', height: '100%' }} />
          <canvas
            ref={eraser.overlay} aria-label="Paint over the area to erase"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.55, touchAction: 'none' }}
            onPointerDown={eraser.down} onPointerMove={eraser.move} onPointerUp={eraser.up} onPointerCancel={eraser.up}
          />
          {showing && (
            <>
              <img src={url.url} alt="Original, before erasing" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
              <span className="compare-tag">Original</span>
            </>
          )}
        </div>
      </main>
      <div className="zoom">
        {original && (
          <button
            className="compare" title="Hold to see the original (or hold C)" aria-pressed={peek}
            onPointerDown={(e) => { e.preventDefault(); show() }} onPointerUp={hide} onPointerLeave={hide} onPointerCancel={hide}
          >{peek ? (showing ? 'Original' : 'Loading…') : 'Hold to compare'}</button>
        )}
        {footer}
      </div>
    </div>
  )
}

/** Brush size, fill method and the model-download progress. */
export function EraseSettings({ eraser, maxBrush }: { eraser: Eraser; maxBrush: number }) {
  const { brush, setBrush, mode, setMode, busy, ai, tint, setTint, picking, setPicking } = eraser
  return (
    <>
      <label className="field-label">
        Brush size · {brush}px
        <input type="range" min={4} max={maxBrush} value={brush} onChange={(e) => setBrush(Number(e.target.value))} style={{ accentColor: 'var(--accent)' }} />
      </label>
      <div className="group">
        <span className="eyebrow" id="erase-mode">Fill method</span>
        <div className="seg light" role="radiogroup" aria-labelledby="erase-mode">
          <button role="radio" aria-checked={mode === 'tint'} className={mode === 'tint' ? 'on' : ''} onClick={() => setMode('tint')} disabled={busy}>Remove tint</button>
          <button role="radio" aria-checked={mode === 'quick'} className={mode === 'quick' ? 'on' : ''} onClick={() => setMode('quick')} disabled={busy}>Quick fill</button>
          <button role="radio" aria-checked={mode === 'ai'} className={mode === 'ai' ? 'on' : ''} onClick={() => setMode('ai')} disabled={busy}>AI fill</button>
        </div>
        <p className="hint">
          {mode === 'tint'
            ? 'For a see-through watermark laid over the page. It undoes the watermark’s colour instead of painting over it, so the page and any text underneath come back exactly, and nothing outside it changes. Paint over the watermark, loosely is fine.'
            : mode === 'quick'
            ? 'Instant and offline. Best on smooth areas like sky, walls and gradients.'
            : 'Rebuilds texture, so it handles busy backgrounds much better. First use downloads about 50–70 MB once (the model from huggingface.co, the engine from cdn.jsdelivr.net), then it’s cached. Your image never leaves this device.'}
        </p>
        {mode === 'tint' && (
          <>
            <label className="field-label">
              Find the watermark by
              <span className="field">
                <select value={tint.coverage} onChange={(ev) => setTint({ ...tint, coverage: ev.target.value as typeof tint.coverage })} disabled={busy}>
                  <option value="color">Its colour (best for coloured marks)</option>
                  <option value="paint">My painting (for grey marks)</option>
                </select>
              </span>
            </label>
            <label className="field-label">
              Watermark strength · {tint.strength == null ? 'auto' : `${Math.round(tint.strength * 100)}%`}
              <input type="range" min={5} max={85} value={Math.round((tint.strength ?? 0.35) * 100)} disabled={busy}
                onChange={(ev) => setTint({ ...tint, strength: Number(ev.target.value) / 100 })} style={{ accentColor: 'var(--accent)' }} />
            </label>
            <div className="field-label">
              Watermark colour
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span
                  aria-label={tint.mark ? 'Picked colour' : 'Found automatically'}
                  style={{ width: 28, height: 28, borderRadius: 6, flex: 'none', boxShadow: '0 0 0 1px var(--line)', background: tint.mark ? `rgb(${tint.mark.map(Math.round).join(',')})` : 'repeating-linear-gradient(45deg, var(--paper-lo) 0 4px, transparent 4px 8px)' }}
                />
                <button className={`btn ${picking ? 'primary' : ''}`} onClick={() => setPicking(!picking)} disabled={busy}>
                  {picking ? 'Click the watermark…' : tint.mark ? 'Pick again' : 'Pick from page'}
                </button>
                {tint.mark && <button className="btn ghost" onClick={() => setTint({ ...tint, mark: null })} disabled={busy}>Auto</button>}
              </div>
              <span className="hint">{tint.mark ? 'Using the colour you picked.' : 'Found automatically. If it gets it wrong, pick a spot of watermark over blank page.'}</span>
            </div>
            {tint.strength != null && <button className="btn ghost" onClick={() => setTint({ ...tint, strength: null })} disabled={busy}>Back to auto</button>}
          </>
        )}
        {ai && (
          <div className="progress" role="progressbar" aria-label={ai.label === FILLING ? 'Filling' : `Downloading ${ai.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((ai.done / ai.total) * 100)}>
            <div className="progress-bar" style={{ width: `${Math.min(100, (ai.done / ai.total) * 100)}%` }} />
            <span>{ai.label === FILLING ? `Filling piece ${ai.done + 1} of ${ai.total}` : `Downloading ${ai.label} · ${(ai.done / 1e6).toFixed(1)} / ${(ai.total / 1e6).toFixed(1)} MB`}</span>
          </div>
        )}
      </div>
    </>
  )
}
