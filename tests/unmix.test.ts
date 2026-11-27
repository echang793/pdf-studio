import { describe, expect, it } from 'vitest'
import { estimateTint, removeTint } from '../src/core/unmix'

const W = 200, H = 120
const PAPER = 250, INK = 10
const WM = [230, 40, 40] // watermark colour
const A = 0.4 // watermark opacity

/** A white page with dark text bars, then a soft-edged diagonal red stripe laid over it at 40% opacity. */
function scene(opts: { ink?: boolean; stripe?: boolean } = {}) {
  const { ink = true, stripe = true } = opts
  const clean = new Uint8ClampedArray(W * H * 4)
  const marked = new Uint8ClampedArray(W * H * 4)
  const cover = new Float32Array(W * H)
  const inStripe = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const bar = ink && y % 16 > 5 && y % 16 < 11 && x > 10 && x < 190
      const b = bar ? INK : PAPER
      const d = Math.abs(x - 1.4 * y - 20) // distance from the stripe's centre line
      const c = stripe ? Math.min(1, Math.max(0, (14 - d) / 3)) : 0 // 3 px antialiased edge
      cover[i] = c
      if (c > 0 || d < 20) inStripe[i] = 1
      for (let k = 0; k < 3; k++) {
        clean[i * 4 + k] = b
        marked[i * 4 + k] = (1 - A * c) * b + A * c * WM[k]
      }
      clean[i * 4 + 3] = marked[i * 4 + 3] = 255
    }
  }
  return { clean, marked, cover, inStripe }
}

describe('estimateTint', () => {
  it('finds the paper colour, the watermark colour over paper, and roughly how opaque it is', () => {
    const { marked, inStripe } = scene()
    const e = estimateTint(marked, inStripe, W, H)!
    expect(e).not.toBeNull()
    expect(Math.abs(e.paper[0] - PAPER)).toBeLessThanOrEqual(2)
    const over = WM.map((c) => (1 - A) * PAPER + A * c)
    for (let k = 0; k < 3; k++) expect(Math.abs(e.mark[k] - over[k])).toBeLessThanOrEqual(6)
    expect(e.strength).toBeGreaterThan(0.3)
    expect(e.strength).toBeLessThan(0.5)
  })
  it('returns null when there is no coloured watermark in the marked area', () => {
    const { marked, inStripe } = scene({ stripe: false })
    expect(estimateTint(marked, inStripe, W, H)).toBeNull()
  })
  it('returns null when the mark covers the whole image (no paper to learn from)', () => {
    const { marked } = scene()
    expect(estimateTint(marked, new Uint8Array(W * H).fill(1), W, H)).toBeNull()
  })
})

describe('removeTint', () => {
  it('restores paper AND the text underneath, and leaves everything outside the mask byte-identical', () => {
    const { clean, marked, inStripe } = scene()
    const e = estimateTint(marked, inStripe, W, H)!
    const out = Uint8ClampedArray.from(marked)
    removeTint(out, inStripe, W, H, { ...e, coverage: 'color' })
    let worst = 0
    for (let i = 0; i < W * H; i++) {
      for (let k = 0; k < 3; k++) {
        const err = Math.abs(out[i * 4 + k] - clean[i * 4 + k])
        if (inStripe[i]) worst = Math.max(worst, err)
        else expect(out[i * 4 + k]).toBe(marked[i * 4 + k])
      }
      expect(out[i * 4 + 3]).toBe(255)
    }
    expect(worst).toBeLessThanOrEqual(12) // quantisation + the strength estimate; pre-removal error was ~100
  })
  it('does not touch pixels the watermark never reached, even inside the painted area', () => {
    const { clean, marked, inStripe, cover } = scene()
    const e = estimateTint(marked, inStripe, W, H)!
    const out = Uint8ClampedArray.from(marked)
    removeTint(out, inStripe, W, H, { ...e, coverage: 'color' })
    for (let i = 0; i < W * H; i++) if (cover[i] === 0) for (let k = 0; k < 3; k++) expect(Math.abs(out[i * 4 + k] - clean[i * 4 + k])).toBeLessThanOrEqual(1)
  })
  it('"paint" coverage trusts the painted area fully (works for grey watermarks the colour test cannot see)', () => {
    const { clean, marked, cover } = scene()
    const tight = new Uint8Array(W * H)
    for (let i = 0; i < W * H; i++) tight[i] = cover[i] >= 0.999 ? 1 : 0
    const e = estimateTint(marked, tight.map((_, i) => (cover[i] > 0 ? 1 : 0)) as Uint8Array, W, H)!
    const out = Uint8ClampedArray.from(marked)
    removeTint(out, tight, W, H, { ...e, coverage: 'paint' })
    for (let i = 0; i < W * H; i++) if (tight[i]) for (let k = 0; k < 3; k++) expect(Math.abs(out[i * 4 + k] - clean[i * 4 + k])).toBeLessThanOrEqual(12)
  })
  it('a manual strength overrides the estimate', () => {
    const { marked, inStripe } = scene()
    const e = estimateTint(marked, inStripe, W, H)!
    const a = Uint8ClampedArray.from(marked), b = Uint8ClampedArray.from(marked)
    removeTint(a, inStripe, W, H, { ...e, coverage: 'color' })
    removeTint(b, inStripe, W, H, { ...e, strength: 0.1, coverage: 'color' })
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).not.toBe(0)
  })
})

describe('grey watermark with painted coverage', () => {
  const GREY = 128
  function greyScene() {
    const clean = new Uint8ClampedArray(W * H * 4), marked = new Uint8ClampedArray(W * H * 4), painted = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x
      const bar = y % 16 > 5 && y % 16 < 11 && x > 10 && x < 190
      const b = bar ? INK : PAPER
      const on = Math.abs(x - 1.4 * y - 20) < 12 ? 1 : 0
      painted[i] = Math.abs(x - 1.4 * y - 20) < 14 ? 1 : 0 // painted a touch wider than the mark
      for (let k = 0; k < 3; k++) { clean[i * 4 + k] = b; marked[i * 4 + k] = (1 - A * on) * b + A * on * GREY }
      clean[i * 4 + 3] = marked[i * 4 + 3] = 255
    }
    return { clean, marked, painted }
  }
  it('cannot be found by colour, but is found and removed when the painted area is trusted', () => {
    const { clean, marked, painted } = greyScene()
    expect(estimateTint(marked, painted, W, H, 'color')).toBeNull()
    const e = estimateTint(marked, painted, W, H, 'paint')!
    expect(e).not.toBeNull()
    expect(Math.abs(e.mark[0] - ((1 - A) * PAPER + A * GREY))).toBeLessThanOrEqual(3)
    const out = Uint8ClampedArray.from(marked)
    removeTint(out, painted, W, H, { ...e, coverage: 'paint' })
    // Only the 2 px fringe that was painted but never watermarked is wrongly changed; the watermarked part is restored.
    let worstInside = 0
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (Math.abs(x - 1.4 * y - 20) < 12) for (let k = 0; k < 3; k++) worstInside = Math.max(worstInside, Math.abs(out[(y * W + x) * 4 + k] - clean[(y * W + x) * 4 + k]))
    }
    expect(worstInside).toBeLessThanOrEqual(12)
    // Page inside the painted fringe (never watermarked) must not get a bright halo.
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = Math.abs(x - 1.4 * y - 20)
      const bar = y % 16 > 5 && y % 16 < 11 && x > 10 && x < 190
      if (d >= 12.5 && d < 14 && !bar) expect(out[(y * W + x) * 4]).toBe(marked[(y * W + x) * 4])
    }
  })
})

describe('picked watermark colour', () => {
  it('uses a colour picked by hand instead of guessing it, and still restores the page', () => {
    const { clean, marked, inStripe } = scene()
    const over: [number, number, number] = [(1 - A) * PAPER + A * WM[0], (1 - A) * PAPER + A * WM[1], (1 - A) * PAPER + A * WM[2]]
    const e = estimateTint(marked, inStripe, W, H, 'color', over)!
    expect(e.mark).toEqual(over)
    const out = Uint8ClampedArray.from(marked)
    removeTint(out, inStripe, W, H, { ...e, coverage: 'color' })
    let worst = 0
    for (let i = 0; i < W * H; i++) if (inStripe[i]) for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(out[i * 4 + k] - clean[i * 4 + k]))
    expect(worst).toBeLessThanOrEqual(12)
  })
  it('rejects a picked colour that is just the page', () => {
    const { marked, inStripe } = scene()
    expect(estimateTint(marked, inStripe, W, H, 'color', [PAPER, PAPER, PAPER])).toBeNull()
  })
})
