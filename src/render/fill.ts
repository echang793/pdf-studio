import { compositePatch, fromLamaOutput, maskBounds, planTiles, planWindow, toLamaInput, type Rect } from '../core/aiInpaint'
import { dilateMask, inpaint } from '../core/inpaint'
import { estimateTint, removeTint } from '../core/unmix'
import { loadLama, type AiProgress } from './lama'

/** What a fill replaced, so it can be put back. */
export interface Patch { x: number; y: number; before: ImageData }
export interface FillResult {
  patch: Patch
  message: string
  failed?: boolean
  /** Nothing was changed (e.g. no watermark colour found); the caller should not record an edit. */
  unchanged?: boolean
}
export type FillMode = 'quick' | 'ai' | 'tint'
/** Settings for the tint remover: `strength` null = work it out from the image. */
export interface TintSettings { strength: number | null; coverage: 'color' | 'paint' }
export const DEFAULT_TINT: TintSettings = { strength: null, coverage: 'color' }

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

/**
 * Undo a translucent watermark instead of painting over it: the marked pixels get their original colour back
 * (text underneath included), and nothing outside the marks, or in them where the watermark isn't, changes.
 */
export function tintFill(ctx: CanvasRenderingContext2D, w: number, h: number, mask: Uint8Array, bounds: Rect, s: TintSettings): FillResult {
  const pad = 28 // a little more than the estimator's look-around ring
  const rx = Math.max(0, bounds.x - pad), ry = Math.max(0, bounds.y - pad)
  const rw = Math.min(w, bounds.x + bounds.w + pad) - rx, rh = Math.min(h, bounds.y + bounds.h + pad) - ry
  const region = ctx.getImageData(rx, ry, rw, rh)
  const before = new ImageData(Uint8ClampedArray.from(region.data), rw, rh)
  const sub = new Uint8Array(rw * rh)
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) sub[y * rw + x] = mask[(y + ry) * w + (x + rx)]
  const found = estimateTint(region.data, sub, rw, rh, s.coverage)
  if (!found) {
    const hint = s.coverage === 'color'
      ? 'Could not find a coloured watermark in the painted area. For a grey one, switch "Find the watermark by" to "My painting" and paint right over it.'
      : 'Could not find the watermark in the painted area. Paint over it, including some page around it.'
    return { patch: { x: rx, y: ry, before }, message: hint, failed: true, unchanged: true }
  }
  const strength = s.strength ?? found.strength
  const changed = removeTint(region.data, sub, rw, rh, { ...found, strength, coverage: s.coverage })
  if (changed === 0) return { patch: { x: rx, y: ry, before }, message: 'Nothing to remove: the painted area has no watermark in it.', failed: true, unchanged: true }
  ctx.putImageData(region, rx, ry)
  return { patch: { x: rx, y: ry, before }, message: `Removed the watermark from ${changed.toLocaleString()} pixels (strength ${Math.round(strength * 100)}%${s.strength == null ? ', auto' : ''})` }
}

/** Progress label for tile-by-tile fills (any other label is a file download). */
export const FILLING = 'fill'
const TILE = 192 // px of marked area filled per model call; the rest of the 512 window is real surroundings for it to copy from
const yieldFrame = () => new Promise<void>((r) => setTimeout(r, 0))

/**
 * LaMa: cut a window around the marks, let the model fill it, blend only the marked area back. A mark bigger than
 * one tile (a watermark spanning a page) is filled tile by tile at native resolution, because squeezing it into one
 * 512 px window is what made big fills blurry. Later tiles see earlier ones as finished background.
 */
export async function aiFill(ctx: CanvasRenderingContext2D, w: number, h: number, mask: Uint8Array, bounds: Rect, onProgress?: AiProgress): Promise<FillResult> {
  const lama = await loadLama(onProgress)
  const tiles = planTiles(mask, w, h, TILE)
  const pad = 4 // feather reach
  const ux = Math.max(0, bounds.x - pad), uy = Math.max(0, bounds.y - pad)
  const uw = Math.min(w, bounds.x + bounds.w + pad) - ux, uh = Math.min(h, bounds.y + bounds.h + pad) - uy
  const before = ctx.getImageData(ux, uy, uw, uh)
  const left = tiles.length > 1 ? Uint8Array.from(mask) : mask // marked pixels not filled yet
  for (let i = 0; i < tiles.length; i++) {
    if (tiles.length > 1) { onProgress?.(FILLING, i, tiles.length); await yieldFrame() }
    const t = tiles[i]
    const win = planWindow(t, w, h)
    const region = ctx.getImageData(win.x, win.y, win.w, win.h)
    const sub = new Uint8Array(win.w * win.h) // everything still marked in the window, so the model never copies a leftover mark
    const own = new Uint8Array(win.w * win.h) // this tile's pixels: the only ones taken from this pass
    for (let y = 0; y < win.h; y++) {
      for (let x = 0; x < win.w; x++) {
        const gx = x + win.x, gy = y + win.y
        sub[y * win.w + x] = left[gy * w + gx]
        if (gx >= t.x && gx < t.x + t.w && gy >= t.y && gy < t.y + t.h) own[y * win.w + x] = left[gy * w + gx]
      }
    }
    const { image, mask: m } = toLamaInput(region.data, sub, win.w, win.h)
    const out = fromLamaOutput(await lama.run(image, m), win.w, win.h)
    const dirty = compositePatch(region.data, out, own, win.w, win.h, 3)
    ctx.putImageData(region, win.x, win.y, dirty.x, dirty.y, dirty.w, dirty.h)
    if (left !== mask) for (let k = 0; k < own.length; k++) if (own[k]) left[(Math.floor(k / win.w) + win.y) * w + (k % win.w) + win.x] = 0
  }
  const soft = Math.max(bounds.w, bounds.h) > 4 * TILE ? ' (very large area; if it looks soft, erase it in pieces)' : ''
  const parts = tiles.length > 1 ? `, ${tiles.length} pieces` : ''
  return { patch: { x: ux, y: uy, before }, message: `AI fill done on ${lama.backend === 'webgpu' ? 'GPU' : 'CPU'}${parts}${soft}` }
}

/** Fill with the chosen method; if AI can't load or run, say so and use the quick fill instead. */
export async function fill(mode: FillMode, ctx: CanvasRenderingContext2D, w: number, h: number, mask: Uint8Array, bounds: Rect, brush: number, onProgress?: AiProgress, tint: TintSettings = DEFAULT_TINT): Promise<FillResult> {
  if (mode === 'quick') return quickFill(ctx, w, h, mask, bounds, brush)
  if (mode === 'tint') return tintFill(ctx, w, h, mask, bounds, tint)
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
