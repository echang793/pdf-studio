import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentLoadingTask, PDFPageProxy } from 'pdfjs-dist'
import type { PageViewport } from 'pdfjs-dist/types/src/display/page_viewport'
import { contentBounds } from '../core/autotrim'
import { displaySize, type Margins } from '../core/geometry'
import type { PageRef } from '../core/model'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const docs = new Map<string, PDFDocumentLoadingTask>()

/** Register source bytes with pdf.js. pdf.js takes ownership of the buffer, so it gets a copy. */
export function openForRender(id: string, bytes: Uint8Array) {
  if (!docs.has(id)) docs.set(id, pdfjs.getDocument({ data: bytes.slice() }))
}

export function closeAll() {
  for (const task of docs.values()) task.destroy().catch(() => {})
  docs.clear()
}

async function getPage(ref: PageRef): Promise<PDFPageProxy | null> {
  if (!ref.src) return null
  const task = docs.get(ref.src)
  if (!task) throw new Error(`Source "${ref.src}" not open`)
  return (await task.promise).getPage(ref.srcIndex + 1)
}

/**
 * Viewport over the full MediaBox (not the CropBox pdf.js uses by default) so cropped-away content
 * stays visible while editing. PageViewport isn't exported, so reuse the constructor of a real one.
 */
function mediaViewport(page: PDFPageProxy, ref: PageRef, scale: number): PageViewport {
  const base = page.getViewport({ scale: 1 })
  const Ctor = base.constructor as new (p: object) => PageViewport
  const m = ref.media
  return new Ctor({ viewBox: [m.x, m.y, m.x + m.width, m.y + m.height], userUnit: page.userUnit ?? 1, scale, rotation: ref.rotation })
}

export interface RenderJob { promise: Promise<void>; cancel: () => void }

/** Render the whole media box of a page (at its display rotation) into a canvas. */
export function renderPage(ref: PageRef, canvas: HTMLCanvasElement, scale: number): RenderJob {
  let cancelled = false
  let task: { cancel: () => void } | null = null
  const promise = (async () => {
    const size = displaySize(ref.media, ref.rotation)
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.max(1, Math.floor(size.width * scale * dpr))
    const h = Math.max(1, Math.floor(size.height * scale * dpr))
    const page = await getPage(ref)
    if (cancelled) return
    // Render to an offscreen canvas first so a cancelled render never blanks the visible one.
    const off = document.createElement('canvas')
    off.width = w
    off.height = h
    const ctx = off.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    if (page) {
      const t = page.render({ canvas: off, canvasContext: ctx, viewport: mediaViewport(page, ref, scale * dpr) })
      task = t
      try {
        await t.promise
      } catch (e) {
        if (e instanceof pdfjs.RenderingCancelledException) return
        throw e
      }
    }
    if (cancelled) return
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(off, 0, 0)
  })()
  return { promise, cancel: () => { cancelled = true; task?.cancel() } }
}

/** Detect content bounds and return display margins (pt) that trim surrounding whitespace, or null if blank. */
export async function autoTrimMargins(ref: PageRef, padPt = 6): Promise<Margins | null> {
  // ~1.5 px/pt after DPR is plenty to find edges and keeps batch trims fast.
  const scale = 0.75
  const size = displaySize(ref.media, ref.rotation)
  const canvas = document.createElement('canvas')
  const job = renderPage(ref, canvas, scale)
  await job.promise
  const dpr = canvas.width / size.width
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const b = contentBounds(img.data, canvas.width, canvas.height, { pad: Math.round(padPt * dpr) })
  if (!b) return null
  const px = (v: number) => v / dpr
  return {
    left: px(b.x0),
    top: px(b.y0),
    right: Math.max(0, size.width - px(b.x1)),
    bottom: Math.max(0, size.height - px(b.y1)),
  }
}
