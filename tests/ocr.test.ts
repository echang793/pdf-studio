import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { wordsFromTesseract, type TessBlock } from '../src/core/ocr'
import { buildPdf, loadSource } from '../src/core/pdf'
import type { PageRef } from '../src/core/model'
import { initialState, reducer } from '../src/state/store'

const media = { x: 0, y: 0, width: 200, height: 100 }
const blocks: TessBlock[] = [{
  paragraphs: [{ lines: [{ words: [
    { text: 'Hello', confidence: 92, bbox: { x0: 20, y0: 40, x1: 120, y1: 80 } },
    { text: 'w0rld', confidence: 12, bbox: { x0: 130, y0: 40, x1: 200, y1: 80 } }, // too unsure: dropped
    { text: '  ', confidence: 99, bbox: { x0: 0, y0: 0, x1: 5, y1: 5 } }, // blank: dropped
  ] }] }],
}]

describe('wordsFromTesseract', () => {
  it('turns confident words into boxes in PDF space (image is 400x200 px = 2 px/pt, y flipped)', () => {
    const w = wordsFromTesseract(blocks, 400, 200, media)
    expect(w).toEqual([{ text: 'Hello', x: 10, y: 100 - 40, w: 50, h: 20 }])
  })
})

describe('setOcr / setBases', () => {
  const page = (id: string): PageRef => ({ id, src: 's', srcIndex: 0, rotation: 0, media, crop: media, annots: [] })
  it('stores words on a page, and a new erase (new base) drops them because they no longer match', () => {
    let s = reducer(initialState, { type: 'addPages', pages: [page('p1')] })
    s = reducer(s, { type: 'setBases', items: { p1: 'img' } })
    s = reducer(s, { type: 'setOcr', items: { p1: [{ text: 'Hi', x: 1, y: 2, w: 3, h: 4 }] } })
    expect(s.doc.pages[0].ocr).toHaveLength(1)
    s = reducer(s, { type: 'setBases', items: { p1: 'img2' } })
    expect(s.doc.pages[0].ocr).toBeUndefined()
  })
})

describe('searchable text in the download', () => {
  it('an erased page with OCR words carries invisible text that a PDF reader can extract', async () => {
    const d = await PDFDocument.create()
    d.addPage([200, 100])
    const bytes = new Uint8Array(await d.save())
    const src = await loadSource('s', bytes)
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
    const p: PageRef = { ...src.pages[0], base: { asset: 'img' }, ocr: [{ text: 'Invoice', x: 10, y: 60, w: 60, h: 14 }, { text: 'Total', x: 10, y: 30, w: 40, h: 14 }] }
    const out = await buildPdf([p], { s: bytes }, { img: { mime: 'image/png', bytes: png } })
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const doc = await pdfjs.getDocument({ data: out }).promise
    const tc = await (await doc.getPage(1)).getTextContent()
    const text = tc.items.map((i) => ('str' in i ? i.str : '')).join(' ')
    expect(text).toContain('Invoice')
    expect(text).toContain('Total')
  })
})
