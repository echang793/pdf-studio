import { describe, expect, it } from 'vitest'
import { resolveScope } from '../src/core/scope'

const pages = ['a', 'b', 'c', 'd'].map((id) => ({ id }))

describe('resolveScope', () => {
  it('resolves each mode to page ids', () => {
    expect(resolveScope({ mode: 'current', range: '' }, pages, 'c')).toEqual({ ids: ['c'] })
    expect(resolveScope({ mode: 'all', range: '' }, pages, 'c')).toEqual({ ids: ['a', 'b', 'c', 'd'] })
    expect(resolveScope({ mode: 'odd', range: '' }, pages, 'c')).toEqual({ ids: ['a', 'c'] })
    expect(resolveScope({ mode: 'even', range: '' }, pages, 'c')).toEqual({ ids: ['b', 'd'] })
    expect(resolveScope({ mode: 'custom', range: '2-3' }, pages, 'a')).toEqual({ ids: ['b', 'c'] })
  })
  it('returns an error instead of throwing', () => {
    expect(resolveScope({ mode: 'custom', range: '9' }, pages, 'a').error).toMatch(/out of range/i)
    expect(resolveScope({ mode: 'current', range: '' }, pages, null).error).toMatch(/no page/i)
  })

  it('resolves a multi-selection in document order, ignoring stray ids', () => {
    const picked = new Set(['d', 'a', 'z'])
    expect(resolveScope({ mode: 'selected', range: '' }, pages, 'a', picked)).toEqual({ ids: ['a', 'd'] })
  })
  it('errors on an empty or missing selection', () => {
    expect(resolveScope({ mode: 'selected', range: '' }, pages, 'a').error).toMatch(/no pages selected/i)
    expect(resolveScope({ mode: 'selected', range: '' }, pages, 'a', new Set()).error).toMatch(/no pages selected/i)
  })
})
