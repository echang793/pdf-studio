import { describe, expect, it } from 'vitest'
import { compositePatch, fromLamaOutput, maskBounds, planWindow, toLamaInput, workingScale, LAMA_SIZE } from '../src/core/aiInpaint'

function rgba(w: number, h: number, fn: (x: number, y: number) => [number, number, number]) {
  const d = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = fn(x, y)
    const i = (y * w + x) * 4
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255
  }
  return d
}
const rect = (w: number, h: number, x0: number, y0: number, x1: number, y1: number) => {
  const m = new Uint8Array(w * h)
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 1
  return m
}

describe('maskBounds', () => {
  it('finds the tight box of set pixels, or null for an empty mask', () => {
    expect(maskBounds(rect(20, 10, 3, 2, 8, 6), 20, 10)).toEqual({ x: 3, y: 2, w: 5, h: 4 })
    expect(maskBounds(new Uint8Array(200), 20, 10)).toBeNull()
  })
})

describe('planWindow', () => {
  const inside = (win: { x: number; y: number; w: number; h: number }, r: { x: number; y: number; w: number; h: number }) =>
    win.x <= r.x && win.y <= r.y && win.x + win.w >= r.x + r.w && win.y + win.h >= r.y + r.h
  const within = (win: { x: number; y: number; w: number; h: number }, W: number, H: number) =>
    win.x >= 0 && win.y >= 0 && win.x + win.w <= W && win.y + win.h <= H

  it('uses a 512 px window at native resolution for a small mark, centred and inside the image', () => {
    const r = { x: 1000, y: 700, w: 80, h: 40 }
    const win = planWindow(r, 3000, 2000)
    expect(win.w).toBe(LAMA_SIZE)
    expect(win.h).toBe(LAMA_SIZE)
    expect(inside(win, r)).toBe(true)
    expect(within(win, 3000, 2000)).toBe(true)
  })
  it('slides back inside the image when the mark is near an edge', () => {
    const r = { x: 2, y: 2, w: 30, h: 30 }
    const win = planWindow(r, 3000, 2000)
    expect(win.x).toBe(0)
    expect(win.y).toBe(0)
    expect(inside(win, r)).toBe(true)
  })
  it('grows the window (and later downsamples) for a large mark', () => {
    const r = { x: 200, y: 200, w: 900, h: 400 }
    const win = planWindow(r, 3000, 2000)
    expect(win.w).toBeGreaterThan(LAMA_SIZE)
    expect(inside(win, r)).toBe(true)
    expect(within(win, 3000, 2000)).toBe(true)
  })
  it('clamps to a small image, still containing the mark', () => {
    const r = { x: 10, y: 10, w: 20, h: 20 }
    const win = planWindow(r, 300, 200)
    expect(win).toEqual({ x: 0, y: 0, w: 300, h: 200 })
  })
})

describe('toLamaInput', () => {
  it('packs RGB as separate planes scaled to 0-1, and the mask as 0/1', () => {
    const w = 4, h = 4
    const d = rgba(w, h, () => [255, 51, 0])
    const m = rect(w, h, 0, 0, 1, 1)
    const { image, mask } = toLamaInput(d, m, w, h)
    const plane = LAMA_SIZE * LAMA_SIZE
    expect(image).toHaveLength(3 * plane)
    expect(mask).toHaveLength(plane)
    expect(image[0]).toBeCloseTo(1, 5) // R plane
    expect(image[plane]).toBeCloseTo(0.2, 5) // G plane
    expect(image[2 * plane]).toBeCloseTo(0, 5) // B plane
    expect(mask[0]).toBe(1)
    expect(mask[plane - 1]).toBe(0)
  })
  it('keeps a thin mask when shrinking (any covered source pixel marks the target pixel)', () => {
    const w = 2048, h = 2048
    const d = rgba(w, h, () => [10, 10, 10])
    const m = rect(w, h, 1000, 1000, 1001, 1001) // a single pixel
    const { mask } = toLamaInput(d, m, w, h)
    expect(mask.reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
  })
})

describe('fromLamaOutput', () => {
  it('resizes a constant 0-255 output back to the window as opaque RGBA', () => {
    const plane = LAMA_SIZE * LAMA_SIZE
    const out = new Float32Array(3 * plane)
    out.fill(128, 0, plane)
    out.fill(64, plane, 2 * plane)
    out.fill(300, 2 * plane) // out of range clamps to 255
    const px = fromLamaOutput(out, 6, 3)
    expect(px).toHaveLength(6 * 3 * 4)
    expect([...px.subarray(0, 4)]).toEqual([128, 64, 255, 255])
    expect([...px.subarray(px.length - 4)]).toEqual([128, 64, 255, 255])
  })
})

describe('compositePatch', () => {
  it('replaces masked pixels fully, leaves far pixels untouched, and blends a soft edge between', () => {
    const w = 30, h = 30
    const dst = rgba(w, h, () => [0, 0, 0])
    const patch = rgba(w, h, () => [200, 200, 200])
    const mask = rect(w, h, 10, 10, 20, 20)
    const dirty = compositePatch(dst, patch, mask, w, h, 3)
    expect(dst[(15 * w + 15) * 4]).toBe(200) // inside: fully the patch
    expect(dst[0]).toBe(0) // far outside: untouched
    const edge = dst[(15 * w + 8) * 4] // 2 px outside the hole
    expect(edge).toBeGreaterThan(0)
    expect(edge).toBeLessThan(200)
    expect(dst[(15 * w + 15) * 4 + 3]).toBe(255)
    expect(dirty.x).toBeLessThanOrEqual(10)
    expect(dirty.x + dirty.w).toBeGreaterThanOrEqual(20)
  })
  it('with feather 0 touches exactly the mask', () => {
    const w = 12, h = 12
    const dst = rgba(w, h, () => [5, 5, 5])
    const mask = rect(w, h, 4, 4, 8, 8)
    compositePatch(dst, rgba(w, h, () => [250, 250, 250]), mask, w, h, 0)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) expect(dst[(y * w + x) * 4]).toBe(mask[y * w + x] ? 250 : 5)
  })
})

describe('workingScale', () => {
  it('uses 300 dpi for a letter page and caps the long side near 3300 px on big pages', () => {
    expect(workingScale({ width: 612, height: 792 })).toBeCloseTo(300 / 72, 5)
    const big = workingScale({ width: 2592, height: 3456 })
    expect(3456 * big).toBeLessThanOrEqual(3301)
    expect(big).toBeLessThan(300 / 72)
  })
  it('never goes below half a pixel per point', () => {
    expect(workingScale({ width: 100000, height: 100000 })).toBe(0.5)
  })
})
