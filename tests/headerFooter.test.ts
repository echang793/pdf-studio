import { describe, expect, it } from 'vitest'
import { formatStamp, headerFooterAnnots, type HeaderFooterSpec } from '../src/core/headerFooter'
import { rectToDisplay } from '../src/core/geometry'
import type { PageRef, TextAnnot } from '../src/core/model'
import { initialState, reducer } from '../src/state/store'

const spec: HeaderFooterSpec = { header: '{file}', headerAlign: 'left', footer: 'Page {page} of {pages}', footerAlign: 'center', font: 'Helvetica', size: 10, color: [0, 0, 0], margin: 24, start: 1 }
const page = (id: string, rotation: 0 | 90 = 0): PageRef => ({ id, src: 's', srcIndex: 0, rotation, media: { x: 0, y: 0, width: 600, height: 800 }, crop: { x: 0, y: 0, width: 600, height: 800 }, annots: [] })

describe('formatStamp', () => {
  it('fills in page, total, date and file name tokens', () => {
    expect(formatStamp('Page {page} of {pages} · {file} · {date}', { page: 3, pages: 9, file: 'report', date: '2026-11-27' })).toBe('Page 3 of 9 · report · 2026-11-27')
  })
})

describe('headerFooterAnnots', () => {
  const ctx = { page: 2, pages: 5, file: 'doc', date: 'd' }
  it('puts the header at the visible top and the footer at the visible bottom, inside the margins, with alignment', () => {
    const [h, f] = headerFooterAnnots(page('a'), spec, ctx)
    expect(h.text).toBe('doc')
    expect(h.align).toBe('left')
    expect(f.text).toBe('Page 2 of 5')
    expect(f.align).toBe('center')
    // PDF y is up: header near the top of the 800pt page, footer near the bottom.
    expect(h.rect.y + h.rect.height).toBeCloseTo(800 - 24, 5)
    expect(f.rect.y).toBeCloseTo(24, 5)
    expect(f.rect.x).toBeCloseTo(24, 5)
    expect(f.rect.width).toBeCloseTo(600 - 48, 5)
  })
  it('follows the page rotation so the footer is at the bottom as the reader sees it', () => {
    const p = page('r', 90)
    const [, f] = headerFooterAnnots(p, spec, ctx)
    expect(f.rotate).toBe(90)
    const d = rectToDisplay(p.media, 90, f.rect) // display space: y grows downward
    const dispH = 600 // a 90° page shows 800 wide x 600 tall
    expect(d.y + d.height).toBeCloseTo(dispH - 24, 5)
  })
  it('skips an empty header or footer', () => {
    expect(headerFooterAnnots(page('a'), { ...spec, header: '  ' }, ctx)).toHaveLength(1)
  })
})

describe('setHeaderFooter action', () => {
  const start = () => reducer(initialState, { type: 'addPages', pages: [page('p1'), page('p2'), page('p3')] })
  const texts = (s: ReturnType<typeof start>, i: number) => s.doc.pages[i].annots.filter((a): a is TextAnnot => a.kind === 'text').map((a) => a.text)

  it('numbers pages by their place in the document (from the start number) on the chosen pages only', () => {
    const s = reducer(start(), { type: 'setHeaderFooter', ids: ['p2', 'p3'], spec: { ...spec, header: '', start: 5 }, file: 'f', date: 'd' })
    expect(texts(s, 0)).toEqual([])
    expect(texts(s, 1)).toEqual(['Page 6 of 7'])
    expect(texts(s, 2)).toEqual(['Page 7 of 7'])
  })
  it('re-applying replaces the previous header/footer but keeps the user’s own text boxes; null removes it', () => {
    let s = start()
    s = reducer(s, { type: 'addAnnot', pageId: 'p1', annot: { id: 'mine', kind: 'text', text: 'note', size: 12, color: [0, 0, 0], font: 'Helvetica', rect: { x: 0, y: 0, width: 10, height: 10 }, rotate: 0 } })
    s = reducer(s, { type: 'setHeaderFooter', ids: ['p1'], spec, file: 'f', date: 'd' })
    s = reducer(s, { type: 'setHeaderFooter', ids: ['p1'], spec: { ...spec, footer: 'v2 {page}' }, file: 'f', date: 'd' })
    expect(texts(s, 0).sort()).toEqual(['f', 'note', 'v2 1'])
    s = reducer(s, { type: 'setHeaderFooter', ids: ['p1'], spec: null, file: 'f', date: 'd' })
    expect(texts(s, 0)).toEqual(['note'])
  })
})

describe('aligned text in the downloaded PDF', () => {
  it('places centred and right-aligned text further right than left-aligned text in the same box', async () => {
    const { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } = await import('pdf-lib')
    const { buildPdf } = await import('../src/core/pdf')
    const base: PageRef = { ...page('x'), src: null }
    const mk = (align: 'left' | 'center' | 'right'): TextAnnot => ({ id: align, kind: 'text', text: 'Hi', size: 10, color: [0, 0, 0], font: 'Helvetica', rect: { x: 100, y: 100, width: 300, height: 12 }, rotate: 0, align })
    const xOf = async (align: 'left' | 'center' | 'right') => {
      const out = await PDFDocument.load(await buildPdf([{ ...base, annots: [mk(align)] }], {}, {}))
      const c = out.getPage(0).node.Contents()
      const streams = c instanceof PDFArray ? c.asArray().map((r) => out.context.lookup(r)) : [c]
      const text = streams.map((s) => new TextDecoder('latin1').decode(s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : new Uint8Array())).join('\n')
      const m = text.match(/1 0 0 1 ([\d.]+) ([\d.]+) Tm/)
      return Number(m![1])
    }
    const l = await xOf('left'), c = await xOf('center'), r = await xOf('right')
    expect(l).toBeCloseTo(100, 1)
    expect(c).toBeGreaterThan(200)
    expect(c).toBeLessThan(250)
    expect(r).toBeGreaterThan(380)
    expect(r).toBeLessThan(400)
  })
})
