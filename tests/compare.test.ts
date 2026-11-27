import { describe, expect, it } from 'vitest'
import { diffBoxes, diffWords } from '../src/core/compare'

describe('diffWords', () => {
  const words = (s: string) => s.split(' ')
  it('keeps common words and marks insertions and deletions', () => {
    const ops = diffWords(words('the quick brown fox jumps'), words('the slow brown fox leaps high'))
    expect(ops).toEqual([
      { op: 'same', text: 'the' },
      { op: 'del', text: 'quick' },
      { op: 'add', text: 'slow' },
      { op: 'same', text: 'brown fox' },
      { op: 'del', text: 'jumps' },
      { op: 'add', text: 'leaps high' },
    ])
  })
  it('handles empty sides', () => {
    expect(diffWords([], words('a b'))).toEqual([{ op: 'add', text: 'a b' }])
    expect(diffWords(words('a b'), [])).toEqual([{ op: 'del', text: 'a b' }])
    expect(diffWords([], [])).toEqual([])
  })
  it('copes with long pages without blowing up (falls back to a coarse diff past the size limit)', () => {
    const a = Array.from({ length: 6000 }, (_, i) => `w${i}`)
    const b = [...a.slice(0, 3000), 'NEW', ...a.slice(3000)]
    const ops = diffWords(a, b)
    expect(ops.filter((o) => o.op === 'add').map((o) => o.text).join(' ')).toContain('NEW')
    expect(ops.filter((o) => o.op === 'del')).toEqual([])
  })
})

describe('diffBoxes', () => {
  const img = (w: number, h: number) => { const d = new Uint8ClampedArray(w * h * 4).fill(255); return d }
  it('boxes separate changed areas and ignores tiny noise', () => {
    const w = 200, h = 100
    const a = img(w, h), b = img(w, h)
    const paint = (x0: number, y0: number, x1: number, y1: number) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) b[(y * w + x) * 4] = 0 }
    paint(10, 10, 30, 20) // area 1
    paint(150, 70, 170, 90) // area 2
    b[(50 * w + 100) * 4] = 250 // within tolerance: not a change
    const boxes = diffBoxes(a, b, w, h, { cell: 8 })
    expect(boxes).toHaveLength(2)
    const [p, q] = boxes.sort((m, n) => m.x - n.x)
    expect(p.x).toBeLessThanOrEqual(10); expect(p.x + p.w).toBeGreaterThanOrEqual(30)
    expect(q.y).toBeLessThanOrEqual(70); expect(q.y + q.h).toBeGreaterThanOrEqual(90)
  })
  it('returns no boxes for identical images', () => {
    expect(diffBoxes(img(50, 50), img(50, 50), 50, 50)).toEqual([])
  })
})
