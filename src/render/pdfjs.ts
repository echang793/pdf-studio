import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentLoadingTask, PDFPageProxy } from 'pdfjs-dist'
import type { PageViewport } from 'pdfjs-dist/types/src/display/page_viewport'
import { contentBounds } from '../core/autotrim'
import { displaySize, rectToDisplay, type Box, type Margins } from '../core/geometry'
import type { Annot, Asset, FontName, PageRef, RGB } from '../core/model'

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

/** Render a page's *cropped* area (what Download would show) to an encoded image, at `scale` px/pt. */
export async function renderPageToImage(ref: PageRef, scale: number, mime: 'image/png' | 'image/jpeg', quality?: number): Promise<Uint8Array> {
  const size = displaySize(ref.media, ref.rotation)
  const full = document.createElement('canvas')
  await renderPage(ref, full, scale).promise
  const dpr = full.width / size.width
  const crop = rectToDisplay(ref.media, ref.rotation, ref.crop)
  const sx = crop.x * dpr, sy = crop.y * dpr, sw = crop.width * dpr, sh = crop.height * dpr
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(sw))
  out.height = Math.max(1, Math.round(sh))
  out.getContext('2d')!.drawImage(full, sx, sy, sw, sh, 0, 0, out.width, out.height)
  return new Promise((resolve, reject) => {
    out.toBlob((blob) => {
      if (!blob) return reject(new Error('Could not encode image'))
      blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject)
    }, mime, quality)
  })
}

/** Browser-side Reencoder for core/compress.ts: decode, downscale to `maxDim`, re-encode as JPEG. */
export async function reencodeJpeg(bytes: Uint8Array, mime: string, maxDim: number, quality: number): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }))
  } catch {
    return null // undecodable (unsupported JPEG variant, corrupt stream, etc.) — caller skips it
  }
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) return null
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height }
}

const rgbCss = (c: RGB) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`
const CANVAS_FONT: Record<FontName, string> = { Helvetica: 'Helvetica, Arial, sans-serif', Times: '"Times New Roman", Times, serif', Courier: '"Courier New", Courier, monospace' }

/**
 * Paints one annotation onto a display-space canvas the same way AnnotLayer draws it on screen —
 * used to "flatten" a page for redaction, since a rasterized page carries no separate PDF annotations
 * of its own. `redact` always paints fully opaque solid white, ignoring whatever is in its own
 * fill/stroke/opacity fields, so the safety guarantee holds even if those are ever something else.
 */
function paintAnnot(ctx: CanvasRenderingContext2D, ref: PageRef, a: Annot, dpr: number, images: Map<string, ImageBitmap>) {
  const box = rectToDisplay(ref.media, ref.rotation, a.rect)
  const bx = box.x * dpr, by = box.y * dpr, bw = box.width * dpr, bh = box.height * dpr
  const diff = (((ref.rotation - a.rotate) % 360) + 360) % 360
  const odd = diff === 90 || diff === 270
  const w = odd ? bh : bw
  const h = odd ? bw : bh
  ctx.save()
  ctx.translate(bx + bw / 2, by + bh / 2)
  ctx.rotate((diff * Math.PI) / 180)
  ctx.globalAlpha = 1
  if (a.kind === 'redact') {
    ctx.fillStyle = '#fff'
    ctx.fillRect(-w / 2, -h / 2, w, h)
  } else if (a.kind === 'rect') {
    if (a.fill) { ctx.globalAlpha = a.opacity; ctx.fillStyle = rgbCss(a.fill); ctx.fillRect(-w / 2, -h / 2, w, h) }
    if (a.stroke) { ctx.globalAlpha = a.opacity; ctx.strokeStyle = rgbCss(a.stroke); ctx.lineWidth = 1.5 * dpr; ctx.strokeRect(-w / 2 + 0.75 * dpr, -h / 2 + 0.75 * dpr, w - 1.5 * dpr, h - 1.5 * dpr) }
  } else if (a.kind === 'image') {
    const img = images.get(a.asset)
    if (img) ctx.drawImage(img, -w / 2, -h / 2, w, h)
  } else if (a.kind === 'text') {
    ctx.fillStyle = rgbCss(a.color)
    ctx.font = `${a.size * dpr}px ${CANVAS_FONT[a.font]}`
    ctx.textBaseline = 'top'
    const lineH = a.size * 1.2 * dpr
    a.text.split('\n').forEach((line, i) => ctx.fillText(line, -w / 2, -h / 2 + i * lineH))
  } else {
    ctx.globalAlpha = a.opacity
    ctx.fillStyle = rgbCss(a.color)
    ctx.font = `${a.size * dpr}px ${CANVAS_FONT[a.font]}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.rotate((a.angle * Math.PI) / 180)
    ctx.fillText(a.text, 0, 0)
  }
  ctx.restore()
}

/**
 * Flattens a page to a single image: base content plus every one of its annotations baked in, with
 * any `redact` boxes painted solid white on top of everything (not just what was under them when
 * drawn — z-order among annotations is preserved by drawing in the same order they're stored, same
 * as the live editor, and a redact box only reliably hides what's *behind* it in that order).
 * Used only for "download redacted copy" — the live document and a normal Download never rasterize.
 */
export async function rasterizePage(ref: PageRef, dpi: number, assets: Record<string, Asset>): Promise<{ png: Uint8Array; box: Box }> {
  const scale = dpi / 72
  const size = displaySize(ref.media, ref.rotation)
  const full = document.createElement('canvas')
  await renderPage(ref, full, scale).promise
  const dpr = full.width / size.width
  const ctx = full.getContext('2d')!
  const images = new Map<string, ImageBitmap>()
  for (const a of ref.annots) {
    if (a.kind === 'image' && !images.has(a.asset)) {
      const asset = assets[a.asset]
      if (asset) images.set(a.asset, await createImageBitmap(new Blob([asset.bytes as BlobPart], { type: asset.mime })))
    }
  }
  for (const a of ref.annots) paintAnnot(ctx, ref, a, dpr, images)
  for (const bmp of images.values()) bmp.close()
  const crop = rectToDisplay(ref.media, ref.rotation, ref.crop)
  const sx = crop.x * dpr, sy = crop.y * dpr, sw = crop.width * dpr, sh = crop.height * dpr
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(sw))
  out.height = Math.max(1, Math.round(sh))
  out.getContext('2d')!.drawImage(full, sx, sy, sw, sh, 0, 0, out.width, out.height)
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not rasterize page')
  return { png: new Uint8Array(await blob.arrayBuffer()), box: { x: 0, y: 0, width: crop.width, height: crop.height } }
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
