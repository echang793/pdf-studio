import { describe, expect, it } from 'vitest'
import { contentBounds } from '../src/core/autotrim'

function canvas(w: number, h: number) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255)
  const ink = (x: number, y: number, v = 0) => {
    const i = (y * w + x) * 4
    data[i] = data[i + 1] = data[i + 2] = v
  }
  return { data, ink }
}

describe('contentBounds', () => {
  it('returns null for a blank page', () => {
    const { data } = canvas(20, 10)
    expect(contentBounds(data, 20, 10)).toBeNull()
  })

  it('finds tight bounds of ink', () => {
    const { data, ink } = canvas(20, 10)
    ink(3, 2)
    ink(15, 7)
    expect(contentBounds(data, 20, 10)).toEqual({ x0: 3, y0: 2, x1: 16, y1: 8 })
  })

  it('ignores near-white noise under the threshold and pads within the canvas', () => {
    const { data, ink } = canvas(20, 10)
    ink(1, 1, 250) // near-white speck
    ink(5, 5)
    expect(contentBounds(data, 20, 10, { threshold: 240, pad: 2 })).toEqual({ x0: 3, y0: 3, x1: 8, y1: 8 })
    expect(contentBounds(data, 20, 10, { pad: 50 })).toEqual({ x0: 0, y0: 0, x1: 20, y1: 10 })
  })

  it('treats transparent pixels as background', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4) // all zeros = transparent black
    expect(contentBounds(data, 4, 4)).toBeNull()
  })
})
