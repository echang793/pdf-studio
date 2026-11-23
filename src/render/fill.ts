import { compositePatch, fromLamaOutput, maskBounds, planWindow, toLamaInput, type Rect } from '../core/aiInpaint'
import { dilateMask, inpaint } from '../core/inpaint'
import { loadLama, type AiProgress } from './lama'

/** What a fill replaced, so it can be put back. */
export interface Patch { x: number; y: number; before: ImageData }
export interface FillResult { patch: Patch; message: string; failed?: boolean }
export type FillMode = 'quick' | 'ai'

/** Mask from the painted marks (alpha > 0), dilated a little to swallow the brush's soft edge. Null if nothing is painted. */
export function readMask(marks: ImageData): { mask: Uint8Array; bounds: Rect } | null {
  const { width: w, height: h, data } = marks
  const raw = new Uint8Array(w * h)
  for (let i = 0; i < raw.length; i++) if (data[i * 4 + 3] > 0) raw[i] = 1
  const mask = dilateMask(raw, w, h, 2)
  const bounds = maskBounds(mask, w, h)
  return bounds ? { mask, bounds } : null
}

/** Plain edge-inward fill (no download, works anywhere). Edits `ctx`'s canvas in place. */
export function quickFill(ctx: CanvasRenderingContext2D, w: number, h: number, mask: Uint8Array, bounds: Rect, brush: number): FillResult {
  const pad = 10 // context around the marks, for the fill to sample from
  const rx = Math.max(0, bounds.x - pad), ry = Math.max(0, bounds.y - pad)
  const rw = Math.min(w, bounds.x + bounds.w + pad) - rx, rh = Math.min(h, bounds.y + bounds.h + pad) - ry
  const region = ctx.getImageData(rx, ry, rw, rh)
  const sub = new Uint8Array(rw * rh)
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) sub[y * rw + x] = mask[(y + ry) * w + (x + rx)]
  const before = ctx.getImageData(rx, ry, rw, rh)
  const { filled } = inpaint(region.data, sub, rw, rh, { radius: Math.min(24, Math.max(6, Math.round(brush / 2))) })
  if (filled === 0) throw new Error('The marked area covers the whole image, so there is nothing to copy from')
  ctx.putImageData(region, rx, ry)
  return { patch: { x: rx, y: ry, before }, message: `Filled ${filled.toLocaleString()} pixels` }
}

/** LaMa: cut a window around the marks, let the model fill it, blend only the marked area back. */
export async function aiFill(ctx: CanvasRenderingContext2D, w: number, h: number, mask: Uint8Array, bounds: Rect, onProgress?: AiProgress): Promise<FillResult> {
  const lama = await loadLama(onProgress)
  const win = planWindow(bounds, w, h)
  const region = ctx.getImageData(win.x, win.y, win.w, win.h)
  const sub = new Uint8Array(win.w * win.h)
  for (let y = 0; y < win.h; y++) for (let x = 0; x < win.w; x++) sub[y * win.w + x] = mask[(y + win.y) * w + (x + win.x)]
  const { image, mask: m } = toLamaInput(region.data, sub, win.w, win.h)
  const out = fromLamaOutput(await lama.run(image, m), win.w, win.h)
  const dirty = compositePatch(region.data, out, sub, win.w, win.h, 3)
  const before = ctx.getImageData(win.x + dirty.x, win.y + dirty.y, dirty.w, dirty.h)
  ctx.putImageData(region, win.x, win.y, dirty.x, dirty.y, dirty.w, dirty.h)
  const soft = Math.max(win.w, win.h) > 768 ? ' (large area, so the result is softer)' : ''
  return { patch: { x: win.x + dirty.x, y: win.y + dirty.y, before }, message: `AI fill done on ${lama.backend === 'webgpu' ? 'GPU' : 'CPU'}${soft}` }
}

/** Fill with the chosen method; if AI can't load or run, say so and use the quick fill instead. */
export async function fill(mode: FillMode, ctx: CanvasRenderingContext2D, w: number, h: number, mask: Uint8Array, bounds: Rect, brush: number, onProgress?: AiProgress): Promise<FillResult> {
  if (mode === 'quick') return quickFill(ctx, w, h, mask, bounds, brush)
  try {
    return await aiFill(ctx, w, h, mask, bounds, onProgress)
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    // A tab opened before a new deploy asks for files whose hashed names no longer exist.
    const why = /dynamically imported module|Importing a module script failed/i.test(raw) ? 'this page is out of date, reload it' : raw
    const q = quickFill(ctx, w, h, mask, bounds, brush)
    return { ...q, message: `AI unavailable (${why}) — used quick fill instead. ${q.message}`, failed: true }
  }
}
