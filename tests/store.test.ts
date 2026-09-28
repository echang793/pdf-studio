import { describe, expect, it } from 'vitest'
import { initialState, reducer, type State } from '../src/state/store'
import type { PageRef } from '../src/core/model'

const media = { x: 0, y: 0, width: 600, height: 800 }
const page = (id: string, extra: Partial<PageRef> = {}): PageRef => ({
  id, src: 's', srcIndex: 0, rotation: 0, media, crop: media, annots: [], ...extra,
})

function withPages(n: number): State {
  return reducer(initialState, { type: 'addPages', pages: Array.from({ length: n }, (_, i) => page(`p${i}`)) })
}

const ids = (s: State) => s.doc.pages.map((p) => p.id)

describe('store reducer', () => {
  it('adds pages and selects the first', () => {
    const s = withPages(3)
    expect(ids(s)).toEqual(['p0', 'p1', 'p2'])
    expect(s.current).toBe('p0')
  })

  it('crops by display margins on chosen pages only', () => {
    let s = withPages(3)
    s = reducer(s, { type: 'crop', ids: ['p0', 'p2'], margins: { top: 10, right: 20, bottom: 30, left: 40 } })
    expect(s.doc.pages[0].crop).toEqual({ x: 40, y: 30, width: 540, height: 760 })
    expect(s.doc.pages[1].crop).toEqual(media)
    s = reducer(s, { type: 'resetCrop', ids: ['p0'] })
    expect(s.doc.pages[0].crop).toEqual(media)
    expect(s.doc.pages[2].crop).not.toEqual(media)
  })

  it('rotates with wraparound', () => {
    let s = withPages(1)
    s = reducer(s, { type: 'rotate', ids: ['p0'], delta: -90 })
    expect(s.doc.pages[0].rotation).toBe(270)
    s = reducer(s, { type: 'rotate', ids: ['p0'], delta: 180 })
    expect(s.doc.pages[0].rotation).toBe(90)
  })

  it('moves, deletes, duplicates and inserts blanks', () => {
    let s = withPages(3)
    s = reducer(s, { type: 'move', from: 0, to: 2 })
    expect(ids(s)).toEqual(['p1', 'p2', 'p0'])
    s = reducer(s, { type: 'duplicate', ids: ['p1'] })
    expect(s.doc.pages).toHaveLength(4)
    expect(s.doc.pages[1].src).toBe('s')
    expect(s.doc.pages[1].id).not.toBe('p1')
    s = reducer(s, { type: 'insertBlank', index: 0, size: { width: 612, height: 792 } })
    expect(s.doc.pages[0].src).toBeNull()
    s = reducer(s, { type: 'delete', ids: ['p2', 'p0'] })
    expect(s.doc.pages).toHaveLength(3)
    expect(s.current && ids(s).includes(s.current)).toBe(true)
  })

  it('never deletes the last page', () => {
    let s = withPages(1)
    s = reducer(s, { type: 'delete', ids: ['p0'] })
    expect(ids(s)).toEqual(['p0'])
  })

  it('adds, updates and removes annotations', () => {
    let s = withPages(1)
    s = reducer(s, { type: 'addAnnot', pageId: 'p0', annot: { id: 'a', kind: 'rect', rect: { x: 0, y: 0, width: 1, height: 1 }, rotate: 0, fill: [1, 1, 1], stroke: null, opacity: 1 } })
    s = reducer(s, { type: 'updateAnnot', pageId: 'p0', id: 'a', patch: { rect: { x: 5, y: 5, width: 2, height: 2 } } })
    expect(s.doc.pages[0].annots[0].rect.x).toBe(5)
    s = reducer(s, { type: 'removeAnnot', pageId: 'p0', id: 'a' })
    expect(s.doc.pages[0].annots).toHaveLength(0)
  })

  it('undoes and redoes document changes but not selection changes', () => {
    let s = withPages(2)
    s = reducer(s, { type: 'rotate', ids: ['p0'], delta: 90 })
    s = reducer(s, { type: 'select', id: 'p1' })
    s = reducer(s, { type: 'undo' })
    expect(s.doc.pages[0].rotation).toBe(0)
    s = reducer(s, { type: 'redo' })
    expect(s.doc.pages[0].rotation).toBe(90)
    s = reducer(s, { type: 'undo' })
    s = reducer(s, { type: 'rotate', ids: ['p1'], delta: 90 })
    expect(s.future).toHaveLength(0)
  })

  it('applies, replaces and removes a watermark without disturbing other annots', () => {
    let s = withPages(2)
    s = reducer(s, { type: 'addAnnot', pageId: 'p0', annot: { id: 'r', kind: 'rect', rect: { x: 0, y: 0, width: 1, height: 1 }, rotate: 0, fill: null, stroke: null, opacity: 1 } })
    const spec = { kind: 'watermark', text: 'DRAFT', size: 60, color: [0.5, 0.5, 0.5] as const, opacity: 0.3, angle: 45, font: 'Helvetica' } as const
    s = reducer(s, { type: 'setWatermark', ids: ['p0', 'p1'], spec })
    for (const p of s.doc.pages) {
      const wm = p.annots.filter((a) => a.kind === 'watermark')
      expect(wm).toHaveLength(1)
      expect(wm[0]).toMatchObject({ text: 'DRAFT', rect: p.crop, rotate: p.rotation })
    }
    expect(s.doc.pages[0].annots.some((a) => a.id === 'r')).toBe(true)

    s = reducer(s, { type: 'setWatermark', ids: ['p0'], spec: { ...spec, text: 'CONFIDENTIAL' } })
    const wm0 = s.doc.pages[0].annots.filter((a) => a.kind === 'watermark')
    expect(wm0).toHaveLength(1)
    expect(wm0[0]).toMatchObject({ text: 'CONFIDENTIAL' })
    expect(s.doc.pages[1].annots.filter((a) => a.kind === 'watermark')[0]).toMatchObject({ text: 'DRAFT' })

    s = reducer(s, { type: 'setWatermark', ids: ['p0', 'p1'], spec: null })
    expect(s.doc.pages[0].annots.some((a) => a.kind === 'watermark')).toBe(false)
    expect(s.doc.pages[1].annots.some((a) => a.kind === 'watermark')).toBe(false)
    expect(s.doc.pages[0].annots.some((a) => a.id === 'r')).toBe(true)
  })

  it('adds an image as a full-bleed page in one history step', () => {
    let s = withPages(1)
    const pastBefore = s.past.length
    s = reducer(s, {
      type: 'addImagePage',
      index: 1,
      size: { width: 300, height: 400 },
      annot: { kind: 'image', asset: 'img1' },
    })
    expect(s.doc.pages).toHaveLength(2)
    const added = s.doc.pages[1]
    expect(added.src).toBeNull()
    expect(added.media).toEqual({ x: 0, y: 0, width: 300, height: 400 })
    expect(added.crop).toEqual(added.media)
    expect(added.annots).toHaveLength(1)
    expect(added.annots[0]).toMatchObject({ kind: 'image', asset: 'img1', rect: added.media })
    expect(s.past).toHaveLength(pastBefore + 1) // one undo step, not two
  })

  it('reset clears everything', () => {
    let s = withPages(2)
    s = reducer(s, { type: 'reset' })
    expect(s.doc.pages).toHaveLength(0)
    expect(s.past).toHaveLength(0)
  })
})
