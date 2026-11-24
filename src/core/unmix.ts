/**
 * Remove a translucent coloured watermark by undoing it, instead of painting over it.
 *
 * A flat watermark of colour W and opacity a, covering a fraction c of a pixel, turns what was there (B) into
 *     O = (1 - a*c) * B + a*c * W
 * so B = (O - c*a*W) / (1 - a*c) is recoverable exactly: paper comes back as paper and text under the watermark
 * comes back as text, with nothing invented. Pure typed-array maths (unit-tested in Node).
 *
 * Over a page, a*W only has to be known as (mark - (1-a)*paper), where `mark` is the colour the watermark
 * produces over plain paper, which can be read straight off the image. That leaves one free number, `strength`
 * (a), which only matters where the watermark sits on dark pixels.
 *
 * Coverage c is read from colour: documents are mostly grey, so any chroma beyond the paper's own comes from the
 * watermark. A grey watermark has no chroma to read, so "paint" coverage (trust where you painted, judged by lightness) is offered.
 */
export interface Tint {
  /** Colour of the blank page around the watermark. */
  paper: [number, number, number]
  /** Colour the watermark produces over blank page. */
  mark: [number, number, number]
  /** Watermark opacity 0-1 (matters only over dark pixels). */
  strength: number
}
export interface TintOptions extends Tint { coverage: 'color' | 'paint' }

const RING = 24 // px around the marks sampled to learn what the page looks like
const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b
const DEFAULT_STRENGTH = 0.35

/** Chroma (colour minus its grey) of an RGB triple. */
function chroma(r: number, g: number, b: number): [number, number, number] {
  const m = (r + g + b) / 3
  return [r - m, g - m, b - m]
}

function pct(sorted: ArrayLike<number>, q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))]
}

/** Learn the page colour, the watermark's colour and a strength from the marked area and its surroundings. Null if there is no coloured watermark to learn from. */
export function estimateTint(data: Uint8ClampedArray, mask: Uint8Array, w: number, h: number, coverage: 'color' | 'paint' = 'color'): Tint | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) {
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  if (x1 < 0) return null
  const rx0 = Math.max(0, x0 - RING), ry0 = Math.max(0, y0 - RING), rx1 = Math.min(w - 1, x1 + RING), ry1 = Math.min(h - 1, y1 + RING)

  // Paper = the commonest colour just outside the marks.
  const bins = new Uint32Array(4096), sum = new Float64Array(4096 * 3)
  const ringLuma: number[] = []
  let ringN = 0
  for (let y = ry0; y <= ry1; y++) for (let x = rx0; x <= rx1; x++) {
    const i = y * w + x
    if (mask[i]) continue
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]
    const bin = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    bins[bin]++
    sum[bin * 3] += r; sum[bin * 3 + 1] += g; sum[bin * 3 + 2] += b
    ringN++
    if (ringN % 7 === 0) ringLuma.push(luma(r, g, b))
  }
  if (ringN < 50) return null
  let best = 0
  for (let k = 1; k < 4096; k++) if (bins[k] > bins[best]) best = k
  const paper: [number, number, number] = [sum[best * 3] / bins[best], sum[best * 3 + 1] / bins[best], sum[best * 3 + 2] / bins[best]]
  const pl = luma(...paper)
  const pc = chroma(...paper)

  // Colour the watermark makes over blank page. By colour: the highest-chroma, still-bright pixels in the marks.
  // By paint (grey marks): the commonest bright colour in the painted area that isn't the page itself.
  const bright = (i: number) => luma(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) >= 0.6 * pl
  let mark: [number, number, number]
  if (coverage === 'color') {
    const shift = (r: number, g: number, b: number) => {
      const c = chroma(r, g, b)
      const k = Math.min(1, luma(r, g, b) / pl) // paper's own tint dims with the pixel
      return Math.hypot(c[0] - pc[0] * k, c[1] - pc[1] * k, c[2] - pc[2] * k)
    }
    const cands: number[] = []
    for (let i = 0; i < w * h; i++) if (mask[i] && bright(i)) cands.push(shift(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]))
    if (cands.length < 20) return null
    const top = pct(Float64Array.from(cands).sort(), 0.99)
    if (top < 8) return null // no colour beyond the page's own: nothing coloured to undo
    let n = 0
    const mk = [0, 0, 0]
    for (let i = 0; i < w * h; i++) {
      if (!mask[i] || !bright(i)) continue
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]
      if (shift(r, g, b) >= 0.7 * top) { mk[0] += r; mk[1] += g; mk[2] += b; n++ }
    }
    mark = [mk[0] / n, mk[1] / n, mk[2] / n]
  } else {
    const mb = new Uint32Array(4096), ms = new Float64Array(4096 * 3)
    let n = 0
    for (let i = 0; i < w * h; i++) {
      if (!mask[i] || !bright(i)) continue
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]
      if (Math.max(Math.abs(r - paper[0]), Math.abs(g - paper[1]), Math.abs(b - paper[2])) < 8) continue // that's just page
      const bin = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
      mb[bin]++
      ms[bin * 3] += r; ms[bin * 3 + 1] += g; ms[bin * 3 + 2] += b
      n++
    }
    if (n < 20) return null
    let top = 0
    for (let k = 1; k < 4096; k++) if (mb[k] > mb[top]) top = k
    mark = [ms[top * 3] / mb[top], ms[top * 3 + 1] / mb[top], ms[top * 3 + 2] / mb[top]]
  }
  const ml = luma(...mark)

  // Strength from text under the watermark: how far a full-cover dark pixel sits above the page's own ink level.
  ringLuma.sort((p, q) => p - q)
  const ink = pct(ringLuma, 0.01) < 0.5 * pl ? pct(ringLuma, 0.01) : 0
  const tint0: Tint = { paper, mark, strength: DEFAULT_STRENGTH }
  const full: number[] = []
  const cov = coverageFn(tint0, coverage)
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue
    if (cov(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) > 0.9) full.push(luma(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]))
  }
  let strength = DEFAULT_STRENGTH
  if (full.length >= 20) {
    full.sort((p, q) => p - q)
    const dark = pct(full, 0.05)
    if (dark < ml - 8 && pl - ink > 40) strength = Math.min(0.85, Math.max(0.05, 1 - (ml - dark) / (pl - ink)))
  }
  return { paper, mark, strength }
}

/**
 * How much of the watermark a pixel carries, 0-1. "color": how far its chroma has moved toward the watermark's.
 * "paint": the painted area is trusted, except that pixels still as light as the page carry none and pixels lighter than
 * the watermark-over-page colour carry a proportional share (so paper inside a loose stroke is left alone).
 */
function coverageFn(t: Tint, coverage: 'color' | 'paint'): (r: number, g: number, b: number) => number {
  const pl = luma(...t.paper)
  if (coverage === 'paint') {
    const ml = luma(...t.mark)
    const span = Math.max(1, pl - ml)
    return (r, g, b) => Math.min(1, Math.max(0, (pl - luma(r, g, b)) / span))
  }
  const pc = chroma(...t.paper)
  const mc = chroma(...t.mark)
  const u: [number, number, number] = [mc[0] - pc[0], mc[1] - pc[1], mc[2] - pc[2]]
  const uu = u[0] * u[0] + u[1] * u[1] + u[2] * u[2] || 1
  return (r, g, b) => {
    const c = chroma(r, g, b)
    const k = Math.min(1, luma(r, g, b) / pl)
    const d0 = c[0] - pc[0] * k, d1 = c[1] - pc[1] * k, d2 = c[2] - pc[2] * k
    const raw = (d0 * u[0] + d1 * u[1] + d2 * u[2]) / uu
    // A small dead zone keeps image noise from being "corrected"; the top is snapped so full cover is exact.
    return Math.min(1, Math.max(0, (raw - 0.04) / 0.9))
  }
}

/** Undo the watermark in place, only on masked pixels it actually reaches. Returns how many pixels changed. */
export function removeTint(data: Uint8ClampedArray, mask: Uint8Array, w: number, h: number, o: TintOptions): number {
  const a = Math.min(0.95, Math.max(0, o.strength))
  const t = [0, 1, 2].map((k) => o.mark[k] - (1 - a) * o.paper[k]) // a * W
  const cov = coverageFn(o, o.coverage)
  let changed = 0
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue
    const p = i * 4
    const c = cov(data[p], data[p + 1], data[p + 2])
    if (c <= 0) continue
    const d = 1 - c * a
    let moved = false
    for (let k = 0; k < 3; k++) {
      const v = Math.round((data[p + k] - c * t[k]) / d)
      const nv = v < 0 ? 0 : v > 255 ? 255 : v
      if (nv !== data[p + k]) { data[p + k] = nv; moved = true }
    }
    if (moved) changed++
  }
  return changed
}
