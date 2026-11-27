import { useEffect, useRef, useState } from 'react'
import { maskBounds, workingScale } from '../core/aiInpaint'
import { dilateMask } from '../core/inpaint'
import { resampleMask } from '../core/maskResample'
import type { Box } from '../core/geometry'
import type { Asset, PageRef } from '../core/model'
import { findRepeatedMark } from '../core/findMark'
import { wordsFromTesseract } from '../core/ocr'
import type { OcrWord } from '../core/model'
import { recognize } from '../render/ocr'
import { diffPatch, patchRectPt } from '../core/patch'
import type { Scope } from '../core/scope'
import { fill, FILLING } from '../render/fill'
import { canvasToPngBytes, rasterizeFull, unrotateCanvas } from '../render/pdfjs'
import { EraserStage, EraseSettings, type Original } from './EraserParts'
import { Icon } from './icons'
import { ScopePicker } from './ScopePicker'
import { useEraser } from './useEraser'

export interface Erased { bytes: Uint8Array; rect?: Box }
type Output = 'patch' | 'page'

/**
 * What to store for a page after erasing on `canvas` (display orientation). 'page': the whole page as a picture.
 * 'patch': only the pixels that differ from a fresh render of the original, as a transparent PNG laid over it.
 * Null when nothing changed.
 */
async function toErased(p: PageRef, canvas: HTMLCanvasElement, out: Output, assets: Record<string, Asset>): Promise<Erased | null> {
  const edited = unrotateCanvas(canvas, p.rotation)
  if (out === 'page') return { bytes: await canvasToPngBytes(edited) }
  const fresh = unrotateCanvas(await rasterizeFull({ ...p, base: undefined }, canvas.width / (p.rotation % 180 ? p.media.height : p.media.width), assets), p.rotation)
  const w = Math.min(fresh.width, edited.width), h = Math.min(fresh.height, edited.height)
  const a = fresh.getContext('2d')!.getImageData(0, 0, w, h).data
  const b = edited.getContext('2d')!.getImageData(0, 0, w, h).data
  const d = diffPatch(a, b, w, h, 2, 4)
  if (!d) return null
  const c = document.createElement('canvas')
  c.width = d.w
  c.height = d.h
  c.getContext('2d')!.putImageData(new ImageData(d.rgba as Uint8ClampedArray<ArrayBuffer>, d.w, d.h), 0, 0)
  return { bytes: await canvasToPngBytes(c), rect: patchRectPt(d, w, h, p.media) }
}

const defaultBrush = (w: number, h: number) => Math.max(8, Math.round(Math.min(w, h) / 40))

interface Props {
  page: PageRef
  pages: PageRef[]
  assets: Record<string, Asset>
  scope: Scope
  onScope: (s: Scope) => void
  scopeIds: string[]
  scopeError?: string
  selectedCount: number
  canUndo: boolean
  onUndo: () => void
  /** Store erased page images (PNG, unrotated MediaBox; with `rect`, a patch over just that area). Returns each page's new asset key. */
  onCommit: (items: Record<string, Erased>) => Record<string, string>
  onNotify: (text: string, error?: boolean) => void
  /** Watermarks stored as their own PDF objects (found by a scan of the open files), or null if none. */
  builtIn: { pages: number } | null
  onRemoveBuiltIn: () => void
  /** Store OCR words for erased (picture) pages. */
  onOcr: (items: Record<string, OcrWord[]>) => void
}

/** Erase marks on PDF pages: the page becomes a picture with the marked area filled in. */
export function PageEraser({ page, pages, assets, scope, onScope, scopeIds, scopeError, selectedCount, canUndo, onUndo, onCommit, onNotify, builtIn, onRemoveBuiltIn, onOcr }: Props) {
  const [ready, setReady] = useState<string | null>(null) // page key the canvas currently shows
  const [batch, setBatch] = useState<string | null>(null)
  const [output, setOutput] = useState<Output>('patch')
  const outputRef = useRef(output)
  outputRef.current = output
  const assetsRef = useRef(assets)
  assetsRef.current = assets
  const committed = useRef<string | null>(null) // asset key of our own latest commit (no reload needed for it)
  const pageRef = useRef(page)
  pageRef.current = page

  const e = useEraser({
    onNotify,
    keys: false, // ⌘Z is the document's undo here
    onFilled: async (canvas) => {
      const p = pageRef.current
      const item = await toErased(p, canvas, outputRef.current, assetsRef.current)
      if (!item) return
      const keys = onCommit({ [p.id]: item })
      committed.current = keys[p.id]
    },
  })
  const { load } = e

  const key = `${page.id}|${page.src}|${page.base?.asset ?? ''}|${page.rotation}|${page.media.width}x${page.media.height}`
  useEffect(() => {
    if (page.base && page.base.asset === committed.current) { setReady(key); return }
    let stale = false
    ;(async () => {
      try {
        const canvas = await rasterizeFull(page, workingScale(page.media), assets)
        if (stale) return
        load({ w: canvas.width, h: canvas.height, draw: (ctx) => ctx.drawImage(canvas, 0, 0) }, defaultBrush(canvas.width, canvas.height))
        setReady(key)
      } catch (err) {
        if (!stale) onNotify(`Could not prepare the page: ${err instanceof Error ? err.message : err}`, true)
      }
    })()
    return () => { stale = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures the page inputs; assets only matter for annotation images
  }, [key, load])

  const many = scopeIds.length > 1 || (scopeIds.length === 1 && scopeIds[0] !== page.id)

  /** Mark the watermark automatically: what repeats across (up to 8 of) the pages, or coloured pixels on a one-page file. */
  const autoFind = () => {
    if (!e.source) return
    e.setBusy(true)
    setTimeout(async () => {
      try {
        const sample = pages.length <= 8 ? pages : Array.from({ length: 8 }, (_, k) => pages[Math.round((k * (pages.length - 1)) / 7)])
        const dw = e.source!.w, dh = e.source!.h
        const k = Math.min(1, 900 / Math.max(dw, dh)) // work at <= 900 px: plenty for finding, fast to compare
        const w = Math.max(1, Math.round(dw * k)), h = Math.max(1, Math.round(dh * k))
        const images: Uint8ClampedArray[] = []
        for (const [i, p] of sample.entries()) {
          setBatch(`Looking at page ${i + 1} of ${sample.length}…`)
          const c = await rasterizeFull({ ...p, base: undefined }, 900 / Math.max(p.media.width, p.media.height), assets)
          const fit = document.createElement('canvas')
          fit.width = w
          fit.height = h
          const ctx = fit.getContext('2d')!
          ctx.drawImage(c, 0, 0, w, h)
          images.push(ctx.getImageData(0, 0, w, h).data)
        }
        const mask = findRepeatedMark(images, w, h, { grow: 4 })
        const hits = mask.reduce((s, v) => s + v, 0)
        if (hits === 0) return onNotify(sample.length > 1 ? 'Didn’t find anything that repeats across the pages. Paint over the watermark instead.' : 'Didn’t find a coloured watermark. Paint over it instead.', true)
        e.setMarks(mask, w, h)
        onNotify(`Marked what ${sample.length > 1 ? `repeats across ${sample.length} pages` : 'looks like a coloured watermark'}. Check the red area, adjust it with the brush or Clear marks, then press ${e.mode === 'tint' ? 'Remove watermark' : 'Erase'}.`)
      } catch (err) {
        onNotify(err instanceof Error ? err.message : String(err), true)
      } finally {
        setBatch(null)
        e.setBusy(false)
      }
    }, 20)
  }

  // Whole-page pictures (erased with "The whole page as a picture") have no text left until OCR puts it back.
  const needOcr = pages.filter((p) => p.base && !p.base.rect && !p.ocr)

  const runOcr = () => {
    e.setBusy(true)
    setTimeout(async () => {
      try {
        const items: Record<string, OcrWord[]> = {}
        let words = 0
        for (const [i, p] of needOcr.entries()) {
          const asset = assets[p.base!.asset]
          if (!asset) continue
          const bmp = await createImageBitmap(new Blob([asset.bytes as BlobPart], { type: asset.mime }))
          const c = document.createElement('canvas')
          c.width = bmp.width
          c.height = bmp.height
          c.getContext('2d')!.drawImage(bmp, 0, 0)
          bmp.close()
          const blocks = await recognize(c, (label, f) => setBatch(`${label}${f > 0 && f < 1 ? ` ${Math.round(f * 100)}%` : ''} · page ${i + 1} of ${needOcr.length}`))
          items[p.id] = wordsFromTesseract(blocks, c.width, c.height, p.media)
          words += items[p.id].length
        }
        onOcr(items)
        onNotify(`Made ${Object.keys(items).length} page${Object.keys(items).length === 1 ? '' : 's'} searchable (${words.toLocaleString()} words found)`)
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err)
        onNotify(/dynamically imported module|Importing a module script failed/i.test(raw) ? 'OCR couldn’t load: this page is out of date, reload it' : `OCR failed: ${raw}`, true)
      } finally {
        setBatch(null)
        e.setBusy(false)
      }
    }, 20)
  }

  /** The same marks on several pages: each is rendered, filled and stored; one undo step in total. */
  const eraseMany = () => {
    const marks = e.marksMask()
    if (!marks) return onNotify('Paint over the mark first', true)
    e.setBusy(true)
    setTimeout(async () => {
      try {
        const out: Record<string, Erased> = {}
        let fellBack: string | null = null
        let skipped = 0
        let why: string | null = null
        for (const [i, id] of scopeIds.entries()) {
          setBatch(`Page ${i + 1} of ${scopeIds.length}…`)
          const p = pages.find((x) => x.id === id)!
          const canvas = await rasterizeFull(p, workingScale(p.media), assets)
          const mask = dilateMask(resampleMask(marks.mask, marks.w, marks.h, canvas.width, canvas.height), canvas.width, canvas.height, 2)
          const bounds = maskBounds(mask, canvas.width, canvas.height)
          if (!bounds) continue
          const ctx = canvas.getContext('2d')!
          const r = await fill(e.mode, ctx, canvas.width, canvas.height, mask, bounds, Math.round(e.brush * (canvas.width / marks.w)), (label, done, total) => e.setAi({ label, done, total }), e.tint)
          e.setAi(null)
          if (r.unchanged) { skipped++; if (!why) why = r.message; continue }
          if (r.failed && !fellBack) fellBack = r.message
          const item = await toErased(p, canvas, output, assets)
          if (item) out[id] = item
        }
        const n = Object.keys(out).length
        if (n === 0) return onNotify(why ?? 'Nothing to erase on those pages', true)
        onCommit(out)
        e.clearMarks()
        onNotify(fellBack ?? `${e.mode === 'tint' ? 'Removed the watermark on' : 'Erased the marks on'} ${n} page${n === 1 ? '' : 's'}${skipped ? `; ${skipped} page${skipped === 1 ? ' had' : 's had'} no watermark to remove` : ''}`, !!fellBack)
      } catch (err) {
        e.setAi(null)
        onNotify(err instanceof Error ? err.message : String(err), true)
      } finally {
        setBatch(null)
        e.setBusy(false)
      }
    }, 20)
  }

  const { dirty, busy, ai, mode } = e
  const loading = ready !== key
  const label = busy
    ? (batch ?? (ai && ai.label !== FILLING ? 'Downloading…' : mode === 'ai' ? 'Filling with AI…' : mode === 'tint' ? 'Removing…' : 'Filling…'))
    : many ? `${mode === 'tint' ? 'Remove watermark' : 'Erase marked area'} on ${scopeIds.length} pages` : mode === 'tint' ? 'Remove watermark' : 'Erase marked area'

  const original: Original = {
    key: `${page.id}|${page.src}|${page.rotation}`,
    get: () => rasterizeFull({ ...page, base: undefined }, workingScale(page.media), assets),
  }

  return (
    <>
      <EraserStage eraser={e} original={original} footer={<span className="pageno">{loading ? 'Preparing page…' : `${e.source?.w ?? 0} × ${e.source?.h ?? 0} px`}</span>} />
      <aside className="side">
        <div className="panel">
          <div className="panel-head">
            <h2>Erase on page</h2>
            <p className="hint">Paint over the watermark or mark, then press Erase. Use ⌘Z to step back.</p>
          </div>
          {builtIn && (
            <div className="group">
              <span className="eyebrow">Built-in watermark found</span>
              <p className="hint">
                {builtIn.pages} page{builtIn.pages === 1 ? ' has' : 's have'} a watermark stored as its own object. Removing it takes out just
                that object: the pages stay exactly as they are otherwise, with sharp, selectable text. No painting needed.
              </p>
              <button className="btn primary" disabled={e.busy} onClick={onRemoveBuiltIn}><Icon name="check" stroke={2.2} />Remove built-in watermark</button>
            </div>
          )}
          <EraseSettings eraser={e} maxBrush={Math.max(60, Math.round(Math.max(e.source?.w ?? 0, e.source?.h ?? 0) / 8))} />
          <button className="btn" disabled={busy || loading} onClick={autoFind}>
            <Icon name="image" size={16} />Find the watermark for me
          </button>
          <label className="field-label">
            Save erased pages as
            <span className="field">
              <select value={output} onChange={(ev) => setOutput(ev.target.value as Output)} disabled={busy}>
                <option value="patch">A patch over the original (keeps text selectable)</option>
                <option value="page">The whole page as a picture</option>
              </select>
            </span>
          </label>
          <ScopePicker scope={scope} onChange={onScope} error={scopeError} selectedCount={selectedCount} label="Erase the same marks on" />
          <div className="group">
            <button className="btn primary big" disabled={!dirty || busy || loading || !!scopeError} onClick={many ? eraseMany : e.erase}>
              <Icon name="check" stroke={2.2} />{label}
            </button>
            <div className="grid2">
              <button className="btn" disabled={!dirty || busy} onClick={e.clearMarks}><Icon name="close" size={16} />Clear marks</button>
              <button className="btn" disabled={!canUndo || busy} onClick={onUndo}><Icon name="undo" size={16} />Undo</button>
            </div>
          </div>
          <div className="note">
            <Icon name="info" size={20} />
            <p>
              {output === 'patch'
                ? 'Only the pixels you changed are saved, as a patch laid over the original page. Everything else stays exactly as it was: sharp, with selectable text. What the patch covers is hidden, not deleted: it can still be found by copying text or in other PDF tools. For a watermark that must be gone from the file, use “The whole page as a picture”, or Remove built-in watermark when it’s offered.'
                : 'The page becomes a picture of itself with the marked area filled in, and what was under the marks is gone from the downloaded PDF. Text on that page can no longer be selected, and its text boxes and stamps are flattened in.'}
              {' '}Pages you don’t erase stay untouched. Use it on files you own or may edit.
            </p>
          </div>
          {needOcr.length > 0 && (
            <div className="group divided">
              <span className="eyebrow">Searchable text</span>
              <p className="hint">
                {needOcr.length} erased page{needOcr.length === 1 ? ' is a picture' : 's are pictures'} now, so {needOcr.length === 1 ? 'its' : 'their'} text can’t be searched or copied.
                OCR reads the words back and adds them as invisible text. First use downloads about 5 MB (from cdn.jsdelivr.net), then it’s cached; your pages stay on this device.
              </p>
              <button className="btn" disabled={busy} onClick={runOcr}><Icon name="check" size={16} />Make {needOcr.length === 1 ? 'it' : 'them'} searchable (OCR)</button>
            </div>
          )}
          {page.base && !page.base.rect && (
            <div className="note"><Icon name="info" size={20} /><p>This page has been erased before, so it’s already a picture.</p></div>
          )}
        </div>
      </aside>
    </>
  )
}
