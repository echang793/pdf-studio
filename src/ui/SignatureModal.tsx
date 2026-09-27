import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { Asset } from '../core/model'
import { bytesToDataUrl, dataUrlToBytes, imageToAsset, trimmedCanvasAsset } from './files'
import { Icon } from './icons'

type Result = { asset: Asset; width: number; height: number }
interface Props { onDone: (r: Result) => void; onClose: () => void }

const KEY = 'pdfstudio.signatures'
const INKS: [string, string][] = [['Navy', '#1d2b6b'], ['Black', '#1e1d1a'], ['Blue', '#1f5fbf']]
const SCRIPT_FONTS = ['"Snell Roundhand", "Segoe Script", cursive', '"Brush Script MT", "Lucida Handwriting", cursive', '"Bradley Hand", "Comic Sans MS", cursive']

function loadSaved(): string[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[] } catch { return [] }
}
function save(list: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 6))) } catch { /* storage unavailable: not fatal */ }
}

export function SignatureModal({ onDone, onClose }: Props) {
  const [tab, setTab] = useState<'draw' | 'type' | 'upload'>('draw')
  const [saved, setSaved] = useState(loadSaved)
  const [typed, setTyped] = useState('')
  const [fontIdx, setFontIdx] = useState(0)
  const [color, setColor] = useState(INKS[0][1])
  const [error, setError] = useState<string | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const last = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const pos = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * e.currentTarget.width, y: ((e.clientY - r.top) / r.height) * e.currentTarget.height }
  }
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    last.current = pos(e)
  }
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!last.current) return
    const ctx = e.currentTarget.getContext('2d')!
    const p = pos(e)
    ctx.strokeStyle = color
    ctx.lineWidth = 5
    ctx.lineCap = ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
  }
  const clear = () => {
    const c = canvas.current
    c?.getContext('2d')!.clearRect(0, 0, c.width, c.height)
  }

  const finish = (r: Result | null) => {
    if (!r) return setError('Nothing to use yet — draw or type a signature first.')
    const url = bytesToDataUrl(r.asset.bytes, r.asset.mime)
    const next = [url, ...saved.filter((s) => s !== url)]
    setSaved(next)
    save(next)
    onDone(r)
  }

  const pickDrawn = async () => canvas.current && finish(await trimmedCanvasAsset(canvas.current))
  const pickTyped = async () => {
    if (!typed.trim()) return finish(null)
    const c = document.createElement('canvas')
    c.width = 1400
    c.height = 300
    const ctx = c.getContext('2d')!
    ctx.fillStyle = color
    ctx.font = `140px ${SCRIPT_FONTS[fontIdx]}`
    ctx.textBaseline = 'middle'
    ctx.fillText(typed, 30, 150, 1340)
    finish(await trimmedCanvasAsset(c))
  }
  const pickUpload = async (f: File | undefined) => {
    if (!f) return
    try { finish(await imageToAsset(f)) } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  const pickSaved = async (url: string) => {
    const bytes = dataUrlToBytes(url)
    const r = await imageToAsset(new Blob([bytes as BlobPart], { type: 'image/png' }))
    onDone(r)
  }
  const forget = (url: string) => {
    const next = saved.filter((s) => s !== url)
    setSaved(next)
    save(next)
  }

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Signature">
        <header>
          <h2>Signature</h2>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </header>
        <div className="row">
          <div className="seg light" role="tablist" aria-label="Signature method" style={{ flex: 1 }}>
            {(['draw', 'type', 'upload'] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => { setTab(t); setError(null) }}>{t[0].toUpperCase() + t.slice(1)}</button>
            ))}
          </div>
          <div className="swatches" role="radiogroup" aria-label="Ink color">
            {INKS.map(([name, hex]) => (
              <button key={hex} role="radio" aria-checked={color === hex} aria-label={name} className={`swatch ${color === hex ? 'on' : ''}`} style={{ background: hex }} onClick={() => setColor(hex)} />
            ))}
          </div>
        </div>

        {tab === 'draw' && (
          <>
            <canvas ref={canvas} width={900} height={300} className="sig-pad" aria-label="Signature pad" onPointerDown={down} onPointerMove={move} onPointerUp={() => (last.current = null)} onPointerCancel={() => (last.current = null)} />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={clear}>Clear</button>
              <button className="btn primary" onClick={pickDrawn}><Icon name="check" />Use signature</button>
            </div>
          </>
        )}
        {tab === 'type' && (
          <>
            <input className="sig-typed" aria-label="Your name" placeholder="Your name" value={typed} onChange={(e) => setTyped(e.target.value)} style={{ fontFamily: SCRIPT_FONTS[fontIdx], color }} />
            <div className="font-choices" role="radiogroup" aria-label="Signature style">
              {SCRIPT_FONTS.map((f, i) => (
                <button key={f} role="radio" aria-checked={fontIdx === i} className={fontIdx === i ? 'on' : ''} style={{ fontFamily: f }} onClick={() => setFontIdx(i)}>{typed || 'Signature'}</button>
              ))}
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn primary" onClick={pickTyped}><Icon name="check" />Use signature</button>
            </div>
          </>
        )}
        {tab === 'upload' && (
          <label className="upload-zone">
            <Icon name="upload" size={32} stroke={1.6} />
            Choose an image of your signature — a transparent PNG works best.
            <input type="file" accept="image/*" onChange={(e) => pickUpload(e.target.files?.[0])} />
          </label>
        )}
        {error && <p className="err">{error}</p>}

        {saved.length > 0 && (
          <div className="group divided">
            <span className="eyebrow">Saved on this device</span>
            <div className="saved-sigs">
              {saved.map((url) => (
                <div key={url} className="saved-sig">
                  <button onClick={() => pickSaved(url)} title="Use this signature"><img src={url} alt="Saved signature" /></button>
                  <button className="remove" onClick={() => forget(url)} aria-label="Forget signature"><Icon name="close" size={12} stroke={2.4} /></button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
