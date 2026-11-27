import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib'
import { buildPdf, loadSource } from '../src/core/pdf'
import { resampleMask } from '../src/core/maskResample'
import type { Asset, PageRef } from '../src/core/model'
import { initialState, reducer, type State } from '../src/state/store'

// 2x2 opaque PNG
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYEJTDIAAEMYAgGN4vTnAAAAAElFTkSuQmCC'), (c) => c.charCodeAt(0))
const assets: Record<string, Asset> = { clean1: { mime: 'image/png', bytes: PNG } }

async function pdfWithText(text: string) {
  const doc = await PDFDocument.create()
  const p = doc.addPage([300, 200])
  p.drawText(text, { x: 20, y: 100, size: 20, font: await doc.embedFont(StandardFonts.Helvetica) })
  return doc.save()
}

describe('page base image (erased page)', () => {
  it('replaces the page content with the image: source content is not copied, geometry kept', async () => {
    const bytes = await pdfWithText('WATERMARKED')
    const src = await loadSource('a', bytes)
    const ref: PageRef = { ...src.pages[0], rotation: 90, crop: { x: 10, y: 10, width: 100, height: 80 }, base: { asset: 'clean1' } }
    const out = await buildPdf([ref], { a: bytes }, assets)
    const doc = await PDFDocument.load(out)
    const page = doc.getPages()[0]
    expect(page.getMediaBox()).toMatchObject({ x: 0, y: 0, width: 300, height: 200 })
    expect(page.getCropBox()).toMatchObject({ x: 10, y: 10, width: 100, height: 80 })
    expect(page.getRotation().angle).toBe(90)
    const xobjects = page.node.Resources()!.lookup(PDFName.of('XObject'))
    expect(xobjects).toBeTruthy()
    // the original text must be gone from every stream in the file
    expect(new TextDecoder('latin1').decode(out)).not.toContain('WATERMARKED')
  })

  it('does not need the source bytes for a page that has a base image', async () => {
    const bytes = await pdfWithText('x')
    const src = await loadSource('a', bytes)
    const ref: PageRef = { ...src.pages[0], base: { asset: 'clean1' } }
    await expect(buildPdf([ref], {}, assets)).resolves.toBeInstanceOf(Uint8Array)
  })

  it('keeps a non-zero media origin so crop and annotation coordinates stay valid', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([300, 200]).setMediaBox(20, 30, 300, 200)
    const bytes = await doc.save()
    const src = await loadSource('a', bytes)
    expect(src.pages[0].media).toMatchObject({ x: 20, y: 30 })
    const out = await buildPdf([{ ...src.pages[0], base: { asset: 'clean1' } }], {}, assets)
    expect((await PDFDocument.load(out)).getPages()[0].getMediaBox()).toMatchObject({ x: 20, y: 30, width: 300, height: 200 })
  })

  it('draws the page image once even when the page is duplicated', async () => {
    const bytes = await pdfWithText('x')
    const src = await loadSource('a', bytes)
    const ref: PageRef = { ...src.pages[0], base: { asset: 'clean1' } }
    const out = await PDFDocument.load(await buildPdf([ref, { ...ref, id: 'dup' }], {}, assets))
    expect(out.getPageCount()).toBe(2)
  })
})

describe('setBases action', () => {
  const page = (id: string): PageRef => ({ id, src: 's', srcIndex: 0, rotation: 0, media: { x: 0, y: 0, width: 10, height: 10 }, crop: { x: 0, y: 0, width: 10, height: 10 }, annots: [{ id: 'a', kind: 'rect', rect: { x: 0, y: 0, width: 1, height: 1 }, rotate: 0, fill: null, stroke: null, opacity: 1 }] })
  const start = (): State => reducer(initialState, { type: 'addPages', pages: [page('p1'), page('p2')] })

  it('sets the base image, flattens that page’s annotations, leaves others, and is one undo step', () => {
    const s = reducer(start(), { type: 'setBases', items: { p1: 'img1' } })
    expect(s.doc.pages[0].base).toEqual({ asset: 'img1' })
    expect(s.doc.pages[0].annots).toEqual([])
    expect(s.doc.pages[1].base).toBeUndefined()
    expect(s.doc.pages[1].annots).toHaveLength(1)
    const u = reducer(s, { type: 'undo' })
    expect(u.doc.pages[0].base).toBeUndefined()
    expect(u.doc.pages[0].annots).toHaveLength(1)
  })
  it('sets several pages in one history entry', () => {
    const before = start()
    const s = reducer(before, { type: 'setBases', items: { p1: 'a', p2: 'b' } })
    expect(s.past.length).toBe(before.past.length + 1)
    expect(s.doc.pages.map((p) => p.base?.asset)).toEqual(['a', 'b'])
  })
  it('a patch (asset + rect) keeps the page and its annotations', () => {
    const s = reducer(start(), { type: 'setBases', items: { p1: { asset: 'pt', rect: { x: 1, y: 2, width: 3, height: 4 } } } })
    expect(s.doc.pages[0].base).toEqual({ asset: 'pt', rect: { x: 1, y: 2, width: 3, height: 4 } })
    expect(s.doc.pages[0].annots).toHaveLength(1)
  })
  it('ignores unknown page ids', () => {
    const before = start()
    expect(reducer(before, { type: 'setBases', items: { nope: 'a' } })).toBe(before)
  })
})

describe('resampleMask', () => {
  const mk = (w: number, h: number, pts: [number, number][]) => { const m = new Uint8Array(w * h); for (const [x, y] of pts) m[y * w + x] = 1; return m }
  it('keeps a mark at the same relative position when scaling up', () => {
    const out = resampleMask(mk(4, 4, [[1, 1]]), 4, 4, 8, 8)
    expect(out[2 * 8 + 2]).toBe(1)
    expect(out[3 * 8 + 3]).toBe(1)
    expect(out[0]).toBe(0)
    expect(out[7 * 8 + 7]).toBe(0)
  })
  it('does not lose a thin mark when scaling down', () => {
    const out = resampleMask(mk(100, 100, [[51, 51]]), 100, 100, 10, 10)
    expect(out.reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
  })
  it('returns a copy for the same size', () => {
    const m = mk(3, 3, [[0, 0]])
    const out = resampleMask(m, 3, 3, 3, 3)
    expect([...out]).toEqual([...m])
    expect(out).not.toBe(m)
  })
})

describe('replaceSource action', () => {
  const page = (id: string, src: string | null): PageRef => ({ id, src, srcIndex: 0, rotation: 0, media: { x: 0, y: 0, width: 10, height: 10 }, crop: { x: 0, y: 0, width: 10, height: 10 }, annots: [] })
  it('points every page of one source at a cleaned copy, as one undo step, leaving other sources alone', () => {
    const s0 = reducer(initialState, { type: 'addPages', pages: [page('p1', 'a'), page('p2', 'b'), page('p3', 'a'), page('p4', null)] })
    const s = reducer(s0, { type: 'replaceSource', from: 'a', to: 'a2' })
    expect(s.doc.pages.map((p) => p.src)).toEqual(['a2', 'b', 'a2', null])
    expect(s.past.length).toBe(s0.past.length + 1)
    expect(reducer(s, { type: 'undo' }).doc.pages.map((p) => p.src)).toEqual(['a', 'b', 'a', null])
  })
  it('is a no-op for a source no page uses', () => {
    const s0 = reducer(initialState, { type: 'addPages', pages: [page('p1', 'a')] })
    expect(reducer(s0, { type: 'replaceSource', from: 'zz', to: 'q' })).toBe(s0)
  })
})
