import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { diffPatch, patchRectPt } from '../src/core/patch'
import { buildPdf, loadSource } from '../src/core/pdf'

const img = (w: number, h: number, v = 200) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255 } return d }

describe('diffPatch', () => {
  it('returns the tight box of changed pixels, opaque where changed and transparent elsewhere', () => {
    const a = img(10, 8), b = img(10, 8)
    for (const [x, y] of [[2, 3], [6, 5]]) b[(y * 10 + x) * 4] = 0
    const p = diffPatch(a, b, 10, 8)!
    expect({ x: p.x, y: p.y, w: p.w, h: p.h }).toEqual({ x: 2, y: 3, w: 5, h: 3 })
    expect(p.rgba[3]).toBe(255) // (2,3) changed
    expect(p.rgba[0]).toBe(0)
    expect(p.rgba[(1 * 5 + 1) * 4 + 3]).toBe(0) // (3,4) unchanged -> transparent
    expect(p.changed).toBe(2)
  })
  it('can grow past the changed pixels so a viewer at another zoom sees no fringe of what is underneath', () => {
    const a = img(20, 20), b = img(20, 20)
    b[(10 * 20 + 10) * 4] = 0
    const p = diffPatch(a, b, 20, 20, 2, 3)!
    expect({ x: p.x, y: p.y, w: p.w, h: p.h }).toEqual({ x: 7, y: 7, w: 7, h: 7 })
    expect(p.rgba[3]).toBe(255) // grown pixel is opaque...
    expect(p.rgba[0]).toBe(200) // ...and carries the edited image's own colour
    expect(p.changed).toBe(1)
  })
  it('ignores differences within the tolerance and returns null when nothing changed', () => {
    const a = img(4, 4), b = img(4, 4)
    b[0] = 201
    expect(diffPatch(a, b, 4, 4)).toBeNull()
  })
})

describe('patchRectPt', () => {
  it('maps a top-left pixel box on the unrotated page image to PDF user space (y up, media origin honoured)', () => {
    const media = { x: 10, y: 20, width: 100, height: 200 }
    // image is 200x400 px (2 px/pt); box at x 20..60, y 40..140 from the top
    expect(patchRectPt({ x: 20, y: 40, w: 40, h: 100 }, 200, 400, media)).toEqual({ x: 20, y: 20 + 200 - 70, width: 20, height: 50 })
  })
})

describe('buildPdf with an overlay patch', () => {
  it('keeps the original page (text and all) and draws the patch image on top at its rectangle', async () => {
    const d = await PDFDocument.create()
    const f = await d.embedFont(StandardFonts.Helvetica)
    d.addPage([200, 200]).drawText('KEEPME', { x: 20, y: 100, font: f, size: 12 })
    const bytes = new Uint8Array(await d.save())
    const src = await loadSource('s', bytes)
    // 1x1 transparent PNG
    const tiny = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
    const page = { ...src.pages[0], base: { asset: 'p', rect: { x: 50, y: 60, width: 30, height: 40 } } }
    const out = await PDFDocument.load(await buildPdf([page], { s: bytes }, { p: { mime: 'image/png', bytes: tiny } }))
    const raw = new TextDecoder('latin1').decode(await out.save({ useObjectStreams: false, objectsPerTick: Infinity }))
    expect(raw).toMatch(/\/Subtype \/Image/)
    expect(raw).toMatch(/\/Font/) // the original page's font came along, so its text did too
    expect(out.getPage(0).getSize()).toEqual({ width: 200, height: 200 })
  })
})
