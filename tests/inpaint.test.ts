import { describe, expect, it } from 'vitest'
import { dilateMask, inpaint } from '../src/core/inpaint'

/** RGBA image where each pixel's color comes from fn(x, y) -> [r,g,b]. */
function image(w: number, h: number, fn: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y)
      const i = (y * w + x) * 4
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255
    }
  }
  return data
}

function rectMask(w: number, h: number, x0: number, y0: number, x1: number, y1: number) {
  const m = new Uint8Array(w * h)
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 1
  return m
}

const px = (d: Uint8ClampedArray, w: number, x: number, y: number) => [d[(y * w + x) * 4], d[(y * w + x) * 4 + 1], d[(y * w + x) * 4 + 2]]

describe('inpaint', () => {
  it('fills a hole in a flat color with that color', () => {
    const w = 40, h = 40
    const data = image(w, h, () => [200, 120, 40])
    const mask = rectMask(w, h, 15, 15, 25, 25)
    for (let y = 15; y < 25; y++) for (let x = 15; x < 25; x++) { const i = (y * w + x) * 4; data[i] = 0; data[i + 1] = 0; data[i + 2] = 0 }
    const { filled } = inpaint(data, mask, w, h)
    expect(filled).toBe(100)
    for (const [x, y] of [[15, 15], [20, 20], [24, 24], [15, 24]]) expect(px(data, w, x, y)).toEqual([200, 120, 40])
  })

  it('continues a smooth gradient through the hole', () => {
    const w = 60, h = 30
    const data = image(w, h, (x) => [x * 4, x * 4, x * 4])
    const mask = rectMask(w, h, 25, 10, 35, 20)
    const truth = px(data, w, 30, 15)[0]
    for (let y = 10; y < 20; y++) for (let x = 25; x < 35; x++) { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 255 }
    inpaint(data, mask, w, h)
    expect(Math.abs(px(data, w, 30, 15)[0] - truth)).toBeLessThan(12)
  })

  it('never touches pixels outside the mask', () => {
    const w = 30, h = 30
    const data = image(w, h, (x, y) => [x * 8, y * 8, (x + y) * 4])
    const before = new Uint8ClampedArray(data)
    const mask = rectMask(w, h, 10, 10, 20, 20)
    inpaint(data, mask, w, h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) continue
      const i = (y * w + x) * 4
      expect([...data.subarray(i, i + 4)]).toEqual([...before.subarray(i, i + 4)])
    }
  })

  it('handles an empty mask, a full mask and a mask touching the edge without throwing', () => {
    const w = 20, h = 20
    const flat = () => image(w, h, () => [10, 20, 30])
    expect(inpaint(flat(), new Uint8Array(w * h), w, h).filled).toBe(0)
    // nothing known anywhere: leave the image alone rather than invent pixels
    const all = flat()
    expect(inpaint(all, new Uint8Array(w * h).fill(1), w, h).filled).toBe(0)
    expect(px(all, w, 5, 5)).toEqual([10, 20, 30])
    // hole in the corner
    const corner = flat()
    expect(inpaint(corner, rectMask(w, h, 0, 0, 6, 6), w, h).filled).toBe(36)
    expect(px(corner, w, 0, 0)).toEqual([10, 20, 30])
  })

  it('rejects a mask of the wrong size', () => {
    expect(() => inpaint(new Uint8ClampedArray(16), new Uint8Array(3), 2, 2)).toThrow(/mask/i)
  })
})

describe('dilateMask', () => {
  it('grows a mask by r pixels on every side and stays inside the image', () => {
    const w = 10, h = 10
    const m = rectMask(w, h, 4, 4, 6, 6)
    const d = dilateMask(m, w, h, 2)
    expect(d[2 * w + 2]).toBe(1)
    expect(d[7 * w + 7]).toBe(1)
    expect(d[1 * w + 1]).toBe(0)
    expect(d.length).toBe(w * h)
    expect(dilateMask(rectMask(w, h, 0, 0, 1, 1), w, h, 3)[3 * w + 3]).toBe(1)
  })

  it('returns an unchanged copy for r = 0', () => {
    const m = rectMask(5, 5, 1, 1, 3, 3)
    expect([...dilateMask(m, 5, 5, 0)]).toEqual([...m])
  })
})
