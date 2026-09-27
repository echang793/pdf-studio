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
})
