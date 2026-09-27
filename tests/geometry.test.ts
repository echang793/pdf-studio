import { describe, expect, it } from 'vitest'
import {
  boxToMargins,
  displaySize,
  fromDisplay,
  fromPt,
  marginsToBox,
  rectFromDisplay,
  rectToDisplay,
  toDisplay,
  toPt,
  type Box,
  type Rotation,
} from '../src/core/geometry'

const media: Box = { x: 0, y: 0, width: 600, height: 800 }
const offsetMedia: Box = { x: 10, y: 20, width: 600, height: 800 }
const ROTS: Rotation[] = [0, 90, 180, 270]

describe('units', () => {
  it('converts pt/in/mm', () => {
    expect(toPt(1, 'in')).toBe(72)
    expect(toPt(25.4, 'mm')).toBeCloseTo(72)
    expect(fromPt(144, 'in')).toBe(2)
    expect(fromPt(72, 'pt')).toBe(72)
  })
})

describe('display mapping', () => {
  it('swaps size for 90/270', () => {
    expect(displaySize(media, 0)).toEqual({ width: 600, height: 800 })
    expect(displaySize(media, 90)).toEqual({ width: 800, height: 600 })
    expect(displaySize(media, 270)).toEqual({ width: 800, height: 600 })
  })

  it('maps unrotated corners like a clockwise page rotation', () => {
    // unrotated top-left (0,800)
    expect(toDisplay(media, 0, { x: 0, y: 800 })).toEqual({ x: 0, y: 0 })
    expect(toDisplay(media, 90, { x: 0, y: 800 })).toEqual({ x: 800, y: 0 })
    expect(toDisplay(media, 180, { x: 0, y: 800 })).toEqual({ x: 600, y: 800 })
    expect(toDisplay(media, 270, { x: 0, y: 800 })).toEqual({ x: 0, y: 600 })
    // unrotated bottom-left (0,0)
    expect(toDisplay(media, 90, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 })
    expect(toDisplay(media, 270, { x: 0, y: 0 })).toEqual({ x: 800, y: 600 })
  })

  it('round-trips points and rects for every rotation, including offset media boxes', () => {
    const r: Box = { x: 50, y: 100, width: 200, height: 300 }
    for (const m of [media, offsetMedia]) {
      for (const rot of ROTS) {
        const p = { x: m.x + 37, y: m.y + 411 }
        const back = fromDisplay(m, rot, toDisplay(m, rot, p))
        expect(back.x).toBeCloseTo(p.x)
        expect(back.y).toBeCloseTo(p.y)
        const rr = { ...r, x: r.x + m.x, y: r.y + m.y }
        const d = rectToDisplay(m, rot, rr)
        const rb = rectFromDisplay(m, rot, d)
        expect(rb.x).toBeCloseTo(rr.x)
        expect(rb.y).toBeCloseTo(rr.y)
        expect(rb.width).toBeCloseTo(rr.width)
        expect(rb.height).toBeCloseTo(rr.height)
      }
    }
  })
})

describe('margins <-> box', () => {
  it('rotation 0: margins map directly', () => {
    const box = marginsToBox(media, 0, { top: 10, right: 20, bottom: 30, left: 40 })
    expect(box).toEqual({ x: 40, y: 30, width: 540, height: 760 })
  })

  it('rotation 90: displayed top margin trims the unrotated left edge', () => {
    const box = marginsToBox(media, 90, { top: 10, right: 0, bottom: 0, left: 0 })
    expect(box).toEqual({ x: 10, y: 0, width: 590, height: 800 })
  })

  it('round-trips for every rotation and offset media', () => {
    const m = { top: 11, right: 22, bottom: 33, left: 44 }
    for (const mb of [media, offsetMedia]) {
      for (const rot of ROTS) {
        const back = boxToMargins(mb, rot, marginsToBox(mb, rot, m))
        expect(back.top).toBeCloseTo(m.top)
        expect(back.right).toBeCloseTo(m.right)
        expect(back.bottom).toBeCloseTo(m.bottom)
        expect(back.left).toBeCloseTo(m.left)
      }
    }
  })

  it('clamps margins so the box stays inside media with a minimum size', () => {
    const box = marginsToBox(media, 0, { top: -5, right: 0, bottom: 0, left: 5000 })
    expect(box.y + box.height).toBe(800)
    expect(box.width).toBeGreaterThanOrEqual(1)
    expect(box.x + box.width).toBeLessThanOrEqual(600)
  })
})
