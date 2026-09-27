import { describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import { chunk, zipFiles } from '../src/core/split'

describe('split helpers', () => {
  it('chunks into groups of n, last group shorter', () => {
    expect(chunk([0, 1, 2, 3, 4], 2)).toEqual([[0, 1], [2, 3], [4]])
    expect(chunk([0, 1], 5)).toEqual([[0, 1]])
    expect(() => chunk([0], 0)).toThrow(/at least 1/i)
  })

  it('zips named files', () => {
    const z = zipFiles([{ name: 'a.pdf', bytes: new Uint8Array([1, 2]) }, { name: 'b.pdf', bytes: new Uint8Array([3]) }])
    const files = unzipSync(z)
    expect(Object.keys(files).sort()).toEqual(['a.pdf', 'b.pdf'])
    expect([...files['b.pdf']]).toEqual([3])
  })
})
