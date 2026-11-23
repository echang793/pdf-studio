import { useRef, useState, type DragEvent } from 'react'
import { FILLING } from '../render/fill'
import { downloadBytes, isImageFile, readBytes } from './files'
import { EraserStage, EraseSettings } from './EraserParts'
import { Icon } from './icons'
import { useEraser } from './useEraser'

const MAX_DIM = 4096 // larger images are scaled down so fills stay fast and memory stays sane

interface Loaded { name: string; bitmap: ImageBitmap; w: number; h: number; scaledFrom: [number, number] | null }

/** Paint over an unwanted mark on one of your own images and fill it in from its surroundings. */
export function ImageEraser({ onNotify }: { onNotify: (text: string, error?: boolean) => void }) {
  const [img, setImg] = useState<Loaded | null>(null)
  const [format, setFormat] = useState<'png' | 'jpeg'>('png')
  const [over, setOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const e = useEraser({ onNotify })

  const open = async (file: File | undefined) => {
    if (!file) return
    if (!isImageFile(file)) return onNotify('Choose an image file (PNG, JPEG, WebP…)', true)
    try {
      const bitmap = await createImageBitmap(file)
      const k = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height))
      const w = Math.max(1, Math.round(bitmap.width * k))
      const h = Math.max(1, Math.round(bitmap.height * k))
      e.load({ w, h, draw: (ctx) => ctx.drawImage(bitmap, 0, 0, w, h) }, Math.max(8, Math.round(Math.min(w, h) / 40)))
      setImg((prev) => { prev?.bitmap.close(); return { name: file.name.replace(/\.[^.]+$/, ''), bitmap, w, h, scaledFrom: k < 1 ? [bitmap.width, bitmap.height] : null } })
    } catch {
      onNotify('Could not read that image', true)
    }
  }

  const download = () => {
    const c = e.base.current
    if (!c || !img) return
    c.toBlob(async (blob) => {
      if (!blob) return onNotify('Could not encode image', true)
      downloadBytes(await readBytes(blob), `${img.name}-clean.${format === 'png' ? 'png' : 'jpg'}`, blob.type)
      onNotify('Downloaded')
    }, format === 'png' ? 'image/png' : 'image/jpeg', 0.92)
  }

  const onDrop = (ev: DragEvent) => {
    ev.preventDefault()
    ev.stopPropagation()
    setOver(false)
    open([...ev.dataTransfer.files].find(isImageFile))
  }

  const input = <input ref={fileInput} type="file" accept="image/*" hidden onChange={(ev) => { open(ev.target.files?.[0]); ev.target.value = '' }} />

  if (!img) {
    return (
      <main className="empty mat" onDragOver={(ev) => { ev.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
        <div className="hero">
          <h1>Remove watermarks <em>&amp;</em> blemishes.</h1>
          <p>Paint over a watermark, stamp, text or blemish on your image and it fills in from around it.</p>
        </div>
        <button className={`dropzone ${over ? 'over' : ''}`} onClick={() => fileInput.current?.click()}>
          <span className="corner c-nw" /><span className="corner c-ne" /><span className="corner c-sw" /><span className="corner c-se" />
          <Icon name="image" size={44} stroke={1.6} />
          <strong>Drop an image here</strong>
          <span className="btn primary big">Choose image</span>
        </button>
        <p className="hint" style={{ color: 'var(--mat-text)', maxWidth: 520, textAlign: 'center' }}>
          Got a PDF? Open it on the PDF tab and use its Erase mode to clean pages directly.
          Runs entirely in your browser. Use it on images you own or have permission to edit — it isn’t for stripping
          other people’s copyright marks.
        </p>
        {input}
      </main>
    )
  }

  const { dirty, edits, busy, ai, mode } = e
  return (
    <div className="workspace eraser" onDragOver={(ev) => { ev.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      <EraserStage eraser={e} footer={<span className="pageno">{img.w} × {img.h} px</span>} />
      <aside className="side">
        <div className="panel">
          <div className="panel-head">
            <h2>Erase</h2>
            <p className="hint">Paint over the mark, then press Erase. Small passes on one spot at a time look best.</p>
          </div>
          <EraseSettings eraser={e} maxBrush={Math.max(60, Math.round(Math.max(img.w, img.h) / 8))} />
          <div className="group">
            <button className="btn primary big" disabled={!dirty || busy} onClick={e.erase}>
              <Icon name="check" stroke={2.2} />{busy ? (ai && ai.label !== FILLING ? 'Downloading…' : mode === 'ai' ? 'Filling with AI…' : 'Filling…') : 'Erase marked area'}
            </button>
            <div className="grid2">
              <button className="btn" disabled={!dirty || busy} onClick={e.clearMarks}><Icon name="close" size={16} />Clear marks</button>
              <button className="btn" disabled={!edits || busy} onClick={e.undo}><Icon name="undo" size={16} />Undo fill</button>
            </div>
            <button className="btn ghost" disabled={(!edits && !dirty) || busy} onClick={e.reset}>Reset to original</button>
          </div>

          <div className="group divided">
            <span className="eyebrow">Save</span>
            <label className="field-label">
              Format
              <span className="field">
                <select value={format} onChange={(ev) => setFormat(ev.target.value as typeof format)}>
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
            <p>Quick fill is a plain fill: great on skies, walls and gradients, soft on busy textures; AI fill handles those better. Use it on images you own or may edit.</p>
          </div>
        </div>
      </aside>
      {input}
    </div>
  )
}
