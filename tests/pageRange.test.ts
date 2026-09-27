import { describe, expect, it } from 'vitest'
import { parsePageRange } from '../src/core/pageRange'

describe('parsePageRange', () => {
  it('parses keywords', () => {
    expect(parsePageRange('all', 4)).toEqual([0, 1, 2, 3])
    expect(parsePageRange('odd', 5)).toEqual([0, 2, 4])
    expect(parsePageRange('even', 5)).toEqual([1, 3])
    expect(parsePageRange(' ALL ', 2)).toEqual([0, 1])
  })

  it('parses singles, ranges, open ranges; dedupes and sorts', () => {
    expect(parsePageRange('1-3,7,10-', 12)).toEqual([0, 1, 2, 6, 9, 10, 11])
    expect(parsePageRange('-2', 5)).toEqual([0, 1])
    expect(parsePageRange('3, 1, 3,2-3', 5)).toEqual([0, 1, 2])
  })

  it('rejects bad input with a readable error', () => {
    expect(() => parsePageRange('', 3)).toThrow(/empty/i)
    expect(() => parsePageRange('0', 3)).toThrow(/out of range/i)
    expect(() => parsePageRange('4', 3)).toThrow(/out of range/i)
    expect(() => parsePageRange('5-2', 9)).toThrow(/backwards/i)
    expect(() => parsePageRange('1-x', 3)).toThrow(/invalid/i)
    expect(() => parsePageRange('1..3', 3)).toThrow(/invalid/i)
  })
})
