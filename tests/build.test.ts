import { describe, expect, it } from 'vitest'
import { PDFDocument, degrees } from 'pdf-lib'
import { buildPdf, loadSource, SourceError } from '../src/core/pdf'
import type { PageRef } from '../src/core/model'

async function makePdf(sizes: [number, number][], opts: { rotate?: number; crop?: boolean } = {}) {
  const doc = await PDFDocument.create()
  for (const [w, h] of sizes) {
    const p = doc.addPage([w, h])
    if (opts.rotate) p.setRotation(degrees(opts.rotate))
    if (opts.crop) p.setCropBox(10, 10, w - 20, h - 20)
  }
  return doc.save()
}

async function info(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes)
  return doc.getPages().map((p) => ({
    size: [p.getMediaBox().width, p.getMediaBox().height],
    crop: p.getCropBox(),
    rotation: p.getRotation().angle,
  }))
}

describe('loadSource', () => {
  it('reads media, crop and rotation per page', async () => {
    const bytes = await makePdf([[600, 800], [300, 400]], { rotate: -90, crop: true })
    const src = await loadSource('a', bytes)
    expect(src.pages).toHaveLength(2)
    expect(src.pages[0].media).toEqual({ x: 0, y: 0, width: 600, height: 800 })
    expect(src.pages[0].crop).toEqual({ x: 10, y: 10, width: 580, height: 780 })
    expect(src.pages[0].rotation).toBe(270) // normalised from -90
    expect(src.pages[1].src).toBe('a')
    expect(src.pages[1].srcIndex).toBe(1)
  })

  it('rejects non-PDF bytes', async () => {
    await expect(loadSource('x', new TextEncoder().encode('hello world'))).rejects.toThrow(SourceError)
    await expect(loadSource('x', new TextEncoder().encode('hello world'))).rejects.toThrow(/not a pdf/i)
  })
})

describe('buildPdf', () => {
  it('applies crop box without touching media box, and reset restores', async () => {
    const bytes = await makePdf([[600, 800]])
    const src = await loadSource('a', bytes)
    const cropped: PageRef = { ...src.pages[0], crop: { x: 50, y: 60, width: 200, height: 300 } }
    const out = await info(await buildPdf([cropped], { a: bytes }, {}))
    expect(out[0].size).toEqual([600, 800])
    expect(out[0].crop).toEqual({ x: 50, y: 60, width: 200, height: 300 })

    const reset: PageRef = { ...cropped, crop: cropped.media }
    const out2 = await info(await buildPdf([reset], { a: bytes }, {}))
    expect(out2[0].crop).toEqual({ x: 0, y: 0, width: 600, height: 800 })
  })

  it('reorders, rotates, duplicates and merges across sources, plus blank pages', async () => {
    const a = await makePdf([[100, 100], [200, 200]])
    const b = await makePdf([[300, 300]])
    const sa = await loadSource('a', a)
    const sb = await loadSource('b', b)
    const pages: PageRef[] = [
      { ...sb.pages[0], id: 'b0' },
      { ...sa.pages[1], rotation: 90 },
      { ...sa.pages[0] },
      { ...sa.pages[0], id: 'dup' },
      { id: 'blank', src: null, srcIndex: 0, rotation: 0, media: { x: 0, y: 0, width: 612, height: 792 }, crop: { x: 0, y: 0, width: 612, height: 792 }, annots: [] },
    ]
    const out = await info(await buildPdf(pages, { a, b }, {}))
    expect(out.map((p) => p.size)).toEqual([[300, 300], [200, 200], [100, 100], [100, 100], [612, 792]])
    expect(out[1].rotation).toBe(90)
  })

  it('stamps text, rect and image annotations (content streams grow)', async () => {
    const bytes = await makePdf([[600, 800]])
    const src = await loadSource('a', bytes)
    // 1x1 red PNG
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
    for (const rotate of [0, 90, 180, 270] as const) {
      const page: PageRef = {
        ...src.pages[0],
        rotation: rotate,
        annots: [
          { id: 't', kind: 'text', rect: { x: 10, y: 10, width: 200, height: 40 }, rotate, text: 'Hello\nWorld', size: 12, color: [0, 0, 0], font: 'Helvetica' },
          { id: 'r', kind: 'rect', rect: { x: 10, y: 100, width: 50, height: 20 }, rotate, fill: [1, 1, 1], stroke: null, opacity: 1 },
          { id: 'i', kind: 'image', rect: { x: 100, y: 100, width: 50, height: 50 }, rotate, asset: 'png1' },
        ],
      }
      const out = await buildPdf([page], { a: bytes }, { png1: { mime: 'image/png', bytes: png } })
      const doc = await PDFDocument.load(out)
      expect(doc.getPageCount()).toBe(1)
      expect(out.byteLength).toBeGreaterThan(bytes.byteLength + 200)
    }
  })

  it('fails loudly when an annotation references a missing asset', async () => {
    const bytes = await makePdf([[100, 100]])
    const src = await loadSource('a', bytes)
    const page: PageRef = { ...src.pages[0], annots: [{ id: 'i', kind: 'image', rect: { x: 0, y: 0, width: 1, height: 1 }, rotate: 0, asset: 'nope' }] }
    await expect(buildPdf([page], { a: bytes }, {})).rejects.toThrow(/missing image/i)
  })
})
