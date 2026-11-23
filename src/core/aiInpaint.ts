/**
 * Pre/post-processing around the LaMa inpainting model, kept pure (typed arrays in, typed arrays out) so
 * it's unit-tested in Node. The model itself runs in render/lama.ts. LaMa takes a fixed 512x512 image
 * (RGB planes, 0-1) and mask (1 = fill), and returns RGB planes in 0-255.
 */
export const LAMA_SIZE = 512
const CONTEXT = 64 // px of surrounding image the model gets to look at beyond the marked area

export interface Rect { x: number; y: number; w: number; h: number }

/** Tight bounds of the set pixels of a mask, or null if it's empty. */
export function maskBounds(mask: Uint8Array, w: number, h: number): Rect | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/**
 * The region of the image to send to the model: at least 512 px so small marks are filled at native
 * resolution, big enough to hold the mark plus context, centred on it, and kept inside the image.
 */
export function planWindow(r: Rect, imgW: number, imgH: number): Rect {
  const side = Math.max(LAMA_SIZE, Math.ceil(Math.max(r.w, r.h) + 2 * CONTEXT))
  const w = Math.min(side, imgW)
  const h = Math.min(side, imgH)
  const x = Math.min(Math.max(0, Math.round(r.x + r.w / 2 - w / 2)), imgW - w)
  const y = Math.min(Math.max(0, Math.round(r.y + r.h / 2 - h / 2)), imgH - h)
  return { x, y, w, h }
}

/** RGBA window + mask window -> LaMa tensors (planar RGB / 255, binary mask), both resampled to 512x512. */
export function toLamaInput(rgba: Uint8ClampedArray, mask: Uint8Array, w: number, h: number): { image: Float32Array; mask: Float32Array } {
  const S = LAMA_SIZE
  const plane = S * S
  const image = new Float32Array(3 * plane)
  const m = new Float32Array(plane)
  for (let ty = 0; ty < S; ty++) {
    // bilinear sample position for the image; footprint range for the mask
    const sy = Math.min(Math.max((ty + 0.5) * (h / S) - 0.5, 0), h - 1)
    const y0 = Math.floor(sy)
    const y1 = Math.min(y0 + 1, h - 1)
    const fy = sy - y0
    const my0 = Math.floor((ty * h) / S)
    const my1 = Math.max(my0 + 1, Math.ceil(((ty + 1) * h) / S))
    for (let tx = 0; tx < S; tx++) {
      const sx = Math.min(Math.max((tx + 0.5) * (w / S) - 0.5, 0), w - 1)
      const x0 = Math.floor(sx)
      const x1 = Math.min(x0 + 1, w - 1)
      const fx = sx - x0
      const o = ty * S + tx
      for (let c = 0; c < 3; c++) {
        const a = rgba[(y0 * w + x0) * 4 + c], b = rgba[(y0 * w + x1) * 4 + c]
        const d = rgba[(y1 * w + x0) * 4 + c], e = rgba[(y1 * w + x1) * 4 + c]
        image[c * plane + o] = ((a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy) / 255
      }
      const mx0 = Math.floor((tx * w) / S)
      const mx1 = Math.max(mx0 + 1, Math.ceil(((tx + 1) * w) / S))
      let hit = 0
      for (let yy = my0; yy < Math.min(my1, h) && !hit; yy++) for (let xx = mx0; xx < Math.min(mx1, w); xx++) if (mask[yy * w + xx]) { hit = 1; break }
      m[o] = hit
    }
  }
  return { image, mask: m }
}

/** LaMa output (planar RGB, 0-255, 512x512) -> opaque RGBA at the window's own size (bilinear). */
export function fromLamaOutput(out: Float32Array, w: number, h: number): Uint8ClampedArray {
  const S = LAMA_SIZE
  const plane = S * S
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(Math.max((y + 0.5) * (S / h) - 0.5, 0), S - 1)
    const y0 = Math.floor(sy)
    const y1 = Math.min(y0 + 1, S - 1)
    const fy = sy - y0
    for (let x = 0; x < w; x++) {
      const sx = Math.min(Math.max((x + 0.5) * (S / w) - 0.5, 0), S - 1)
      const x0 = Math.floor(sx)
      const x1 = Math.min(x0 + 1, S - 1)
      const fx = sx - x0
      const i = (y * w + x) * 4
      for (let c = 0; c < 3; c++) {
        const o = c * plane
        const a = out[o + y0 * S + x0], b = out[o + y0 * S + x1], d = out[o + y1 * S + x0], e = out[o + y1 * S + x1]
        px[i + c] = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy
      }
      px[i + 3] = 255
    }
  }
  return px
}

/**
 * Blends the model's patch into `dst` (RGBA, same size) in place: masked pixels become the patch,
 * and pixels within `feather` px outside the mask blend toward it so there's no hard seam. Everything
 * further away is untouched. Returns the rectangle that may have changed.
 */
export function compositePatch(dst: Uint8ClampedArray, patch: Uint8ClampedArray, mask: Uint8Array, w: number, h: number, feather = 3): Rect {
  const b = maskBounds(mask, w, h)
  if (!b) return { x: 0, y: 0, w: 0, h: 0 }
  const f = Math.max(0, Math.round(feather))
  const x0 = Math.max(0, b.x - f), y0 = Math.max(0, b.y - f)
  const x1 = Math.min(w, b.x + b.w + f), y1 = Math.min(h, b.y + b.h + f)
  const rw = x1 - x0, rh = y1 - y0

  // Soft alpha = box-blurred mask (separable) over just the affected rectangle; masked pixels forced to 1.
  let alpha = new Float32Array(rw * rh)
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) alpha[y * rw + x] = mask[(y + y0) * w + (x + x0)]
  if (f > 0) {
    const tmp = new Float32Array(alpha.length)
    const win = 2 * f + 1
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
      let s = 0
      for (let k = -f; k <= f; k++) { const xx = x + k; if (xx >= 0 && xx < rw) s += alpha[y * rw + xx] }
      tmp[y * rw + x] = s / win
    }
    const out = new Float32Array(alpha.length)
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
      let s = 0
      for (let k = -f; k <= f; k++) { const yy = y + k; if (yy >= 0 && yy < rh) s += tmp[yy * rw + x] }
      out[y * rw + x] = s / win
    }
    alpha = out
  }
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = ((y + y0) * w + (x + x0)) * 4
      const a = mask[(y + y0) * w + (x + x0)] ? 1 : alpha[y * rw + x]
      if (a <= 0) continue
      for (let c = 0; c < 3; c++) dst[i + c] = dst[i + c] * (1 - a) + patch[i + c] * a
      dst[i + 3] = 255
    }
  }
  return { x: x0, y: y0, w: rw, h: rh }
}

/**
 * Pixels per PDF point to rasterize a page at for erasing: up to 300 dpi, but never more than ~3300 px
 * on the long side, so fills stay fast and memory stays sane on big pages.
 */
export function workingScale(media: { width: number; height: number }): number {
  return Math.max(0.5, Math.min(300 / 72, 3300 / Math.max(media.width, media.height)))
}
