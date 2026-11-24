import { useRef, type ReactNode } from 'react'
import { FILLING } from '../render/fill'
import type { Eraser } from './useEraser'
import { useFitScale } from './useFitScale'

/** The paintable canvas pair, fitted to the available space. */
export function EraserStage({ eraser, footer }: { eraser: Eraser; footer?: ReactNode }) {
  const stage = useRef<HTMLDivElement>(null)
  const { source } = eraser
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
        </div>
      </main>
      <div className="zoom">{footer}</div>
    </div>
  )
}

/** Brush size, fill method and the model-download progress. */
export function EraseSettings({ eraser, maxBrush }: { eraser: Eraser; maxBrush: number }) {
  const { brush, setBrush, mode, setMode, busy, ai, tint, setTint } = eraser
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
