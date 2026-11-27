import type { Box } from './geometry'
import { dilateMask } from './inpaint'

export interface PixelPatch { x: number; y: number; w: number; h: number; rgba: Uint8ClampedArray; changed: number }

/**
 * Compare an edited page image with a fresh render of the original: the tight box of changed pixels, as RGBA that
 * is opaque where something changed and fully transparent elsewhere. Laid over the original vector page, it
 * changes exactly those pixels and nothing else. Null when nothing changed beyond `tol` (render noise).
 */
export function diffPatch(orig: Uint8ClampedArray, edited: Uint8ClampedArray, w: number, h: number, tol = 2, grow = 0): PixelPatch | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  let hit: Uint8Array = new Uint8Array(w * h)
  let changed = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (Math.abs(orig[i] - edited[i]) > tol || Math.abs(orig[i + 1] - edited[i + 1]) > tol || Math.abs(orig[i + 2] - edited[i + 2]) > tol) {
        hit[y * w + x] = 1
        changed++
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  if (grow > 0) {
    // Also cover a few neighbours (with the edited image's own pixels, which match the original there), so a viewer
    // rendering the vector page underneath at another zoom can't show a fringe of what the patch hides.
    hit = dilateMask(hit, w, h, grow)
    x0 = Math.max(0, x0 - grow); y0 = Math.max(0, y0 - grow); x1 = Math.min(w - 1, x1 + grow); y1 = Math.min(h - 1, y1 + grow)
  }
  const pw = x1 - x0 + 1, ph = y1 - y0 + 1
  const rgba = new Uint8ClampedArray(pw * ph * 4)
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      if (!hit[(y + y0) * w + x + x0]) continue
      const s = ((y + y0) * w + x + x0) * 4, d = (y * pw + x) * 4
      rgba[d] = edited[s]; rgba[d + 1] = edited[s + 1]; rgba[d + 2] = edited[s + 2]; rgba[d + 3] = 255
    }
  }
  return { x: x0, y: y0, w: pw, h: ph, rgba, changed }
}

/** A pixel box (top-left origin) on an image of the whole unrotated MediaBox -> the same area in PDF user space. */
export function patchRectPt(p: { x: number; y: number; w: number; h: number }, imgW: number, imgH: number, media: Box): Box {
  const sx = media.width / imgW, sy = media.height / imgH
  return { x: media.x + p.x * sx, y: media.y + media.height - (p.y + p.h) * sy, width: p.w * sx, height: p.h * sy }
}
