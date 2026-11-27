import { describe, expect, it } from 'vitest'
import { findRepeatedMark } from '../src/core/findMark'

const W = 120, H = 90
type Px = (x: number, y: number) => [number, number, number] | null
function page(fn: Px): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = fn(x, y) ?? [250, 250, 250]
    const i = (y * W + x) * 4
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255
  }
  return d
}
const stripe = (x: number, y: number) => Math.abs(x - y - 15) < 4
const wm: [number, number, number] = [250, 170, 170]
const header = (_x: number, y: number) => y < 5 // dark header on every page
const text = (k: number) => (x: number, y: number) => y > 10 && y % 9 === k % 3 && x > 5 && x < 115

describe('findRepeatedMark', () => {
  const pages = [0, 1, 2, 3].map((k) => page((x, y) => header(x, y) ? [30, 30, 30] : stripe(x, y) ? wm : text(k)(x, y) ? [20, 20, 20] : null))

  it('marks what repeats identically across pages, and not body text, dark headers or blank page', () => {
    const m = findRepeatedMark(pages, W, H, { grow: 0 })
    let onStripe = 0, stripeTotal = 0
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (header(x, y)) expect(m[i]).toBe(0)
      else if (stripe(x, y)) { stripeTotal++; onStripe += m[i] }
      else expect(m[i]).toBe(0)
    }
    expect(onStripe / stripeTotal).toBeGreaterThan(0.6) // gaps only where text crosses it on some pages
  })
  it('grows the result to close the gaps where text crossed the watermark', () => {
    const m = findRepeatedMark(pages, W, H, { grow: 3 })
    let covered = 0, total = 0
    for (let y = 6; y < H; y++) for (let x = 0; x < W; x++) if (stripe(x, y)) { total++; covered += m[y * W + x] }
    expect(covered).toBe(total)
  })
  it('ignores the anti-aliased edges of text even when the text is the same on every page', () => {
    // Same text on all pages, with a light grey fringe around each dark row (what anti-aliasing produces).
    const same = (x: number, y: number): [number, number, number] | null => {
      if (header(x, y)) return [30, 30, 30]
      if (stripe(x, y)) return wm
      const r = y % 9
      if (y > 10 && x > 5 && x < 115 && r === 4) return [20, 20, 20]
      if (y > 10 && x > 5 && x < 115 && (r === 3 || r === 5)) return [170, 170, 170]
      return null
    }
    const m = findRepeatedMark([page(same), page(same), page(same)], W, H, { grow: 0 })
    for (let y = 11; y < H; y++) for (let x = 6; x < 115; x++) if (!stripe(x, y) && Math.abs(x - y - 15) > 6 && (y % 9 === 3 || y % 9 === 5)) expect(m[y * W + x]).toBe(0)
  })
  it('drops thin repeated grey speckle (small text rendered grey) but keeps a thick grey watermark', () => {
    const g = (x: number, y: number): [number, number, number] | null => {
      if (Math.abs(x - y - 15) < 5) return [200, 200, 200] // thick grey watermark stroke (~9 px)
      if (y > 10 && x % 6 === 0) return [190, 190, 190] // 1 px light-grey columns, same on every page
      return null
    }
    const m = findRepeatedMark([page(g), page(g), page(g)], W, H, { grow: 0 })
    expect(m[40 * W + 55]).toBe(1) // on the stripe
    expect(m[80 * W + 6]).toBe(0) // a speckle column, away from the stripe
  })
  it('on a single page, falls back to coloured pixels', () => {
    const one = page((x, y) => stripe(x, y) ? wm : text(0)(x, y) ? [20, 20, 20] : null)
    const m = findRepeatedMark([one], W, H, { grow: 0 })
    expect(m[(30 * W + 45)]).toBe(1)
    expect(m[(10 * W + 100)]).toBe(0)
  })
  it('returns an empty mask when nothing repeats', () => {
    const a = page((x, y) => (x * y) % 7 === 0 ? [200, 120, 120] : null)
    const b = page((x, y) => (x + y) % 5 === 0 ? [120, 200, 120] : null)
    expect(findRepeatedMark([a, b], W, H, { grow: 0 }).reduce((s, v) => s + v, 0)).toBe(0)
  })
})
