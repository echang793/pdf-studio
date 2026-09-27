import { describe, expect, it } from 'vitest'
import { dragRect } from '../src/core/drag'

const b = { width: 100, height: 100 }
const r = { x: 10, y: 10, width: 20, height: 10 }

describe('dragRect', () => {
  it('moves within bounds', () => {
    expect(dragRect(r, 'move', 5, 5, b, 4, false)).toEqual({ x: 15, y: 15, width: 20, height: 10 })
    expect(dragRect(r, 'move', 500, -500, b, 4, false)).toEqual({ x: 80, y: 0, width: 20, height: 10 })
  })
  it('resizes edges with min size and bounds', () => {
    expect(dragRect(r, 'e', 10, 0, b, 4, false)).toEqual({ x: 10, y: 10, width: 30, height: 10 })
    expect(dragRect(r, 'w', 100, 0, b, 4, false)).toEqual({ x: 26, y: 10, width: 4, height: 10 })
    expect(dragRect(r, 'n', 0, -50, b, 4, false)).toEqual({ x: 10, y: 0, width: 20, height: 20 })
  })
  it('keeps aspect on corner drags when locked', () => {
    const out = dragRect(r, 'se', 20, 0, b, 4, true)
    expect(out.width / out.height).toBeCloseTo(2)
  })
})
