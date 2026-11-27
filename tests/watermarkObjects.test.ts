import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString, decodePDFRawStream, type PDFRef } from 'pdf-lib'
import { stripWatermarkObjects } from '../src/core/watermarkObjects'
import { buildPdf, loadSource } from '../src/core/pdf'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array) => new TextDecoder('latin1').decode(b)

async function pageContent(doc: PDFDocument, i: number): Promise<string> {
  const c = doc.getPage(i).node.Contents()
  const streams = c instanceof PDFArray ? c.asArray().map((r) => doc.context.lookup(r)) : [c]
  return streams.map((s) => dec(s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : new Uint8Array())).join('\n')
}

function setContent(doc: PDFDocument, i: number, text: string) {
  doc.getPage(i).node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(enc(text))))
}

/** Page 0: Acrobat-style artifact watermark + a watermark XObject; page 1: clean; page 2: OCG + Watermark annotation. */
async function fixture() {
  const doc = await PDFDocument.create()
  for (let i = 0; i < 3; i++) doc.addPage([612, 792])
  const ctx = doc.context

  // A form XObject marked the way Acrobat marks its watermarks.
  const piece = ctx.obj({ ADBE_CompoundType: { Private: 'Watermark' } })
  const wmForm = ctx.register(ctx.flateStream(enc('BT /F1 60 Tf (CONFIDENTIAL) Tj ET'), { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 100, 100], PieceInfo: piece }))
  const logo = ctx.register(ctx.flateStream(enc('0 0 10 10 re f'), { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 10, 10] }))
  const res0 = ctx.obj({ XObject: { Fm0: wmForm, Logo: logo } })
  doc.getPage(0).node.set(PDFName.of('Resources'), res0)
  setContent(doc, 0, 'BT /F1 12 Tf 72 700 Td (Body) Tj ET\n/Artifact <</Type /Pagination /Subtype /Watermark>> BDC q 0.4 g BT (DRAFT) Tj ET Q EMC\nq /Fm0 Do Q\nq /Logo Do Q')

  setContent(doc, 1, 'BT /F1 12 Tf 72 700 Td (Clean page) Tj ET')

  const ocg = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Watermark') }))
  const other = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Notes') }))
  doc.getPage(2).node.set(PDFName.of('Resources'), ctx.obj({ Properties: { oc1: ocg, oc2: other } }))
  setContent(doc, 2, '/OC /oc1 BDC (WM) Tj EMC /OC /oc2 BDC (Note) Tj EMC (Body) Tj')
  const wmAnnot = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Watermark', Rect: [0, 0, 100, 100] }))
  const link = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10] }))
  doc.getPage(2).node.set(PDFName.of('Annots'), ctx.obj([wmAnnot, link]))
  return new Uint8Array(await doc.save())
}

describe('stripWatermarkObjects', () => {
  it('finds watermark objects without changing anything on a dry run', async () => {
    const bytes = await fixture()
    const r = await stripWatermarkObjects(bytes, { dryRun: true })
    expect(r.pages).toEqual([0, 2])
    expect(r.found).toBe(4) // artifact block, XObject, OCG block, annotation
    expect(r.bytes).toBe(bytes)
  })

  it('removes them and keeps the rest of each page (and clean pages) exactly as they were', async () => {
    const bytes = await fixture()
    const before = await PDFDocument.load(bytes)
    const r = await stripWatermarkObjects(bytes)
    const out = await PDFDocument.load(r.bytes)
    expect(out.getPageCount()).toBe(3)

    const p0 = await pageContent(out, 0)
    expect(p0).toContain('(Body) Tj')
    expect(p0).toContain('/Logo Do')
    expect(p0).not.toContain('DRAFT')
    expect(p0).not.toContain('/Fm0 Do')
    const xo = (out.getPage(0).node.Resources()!.lookup(PDFName.of('XObject')) as PDFDict)
    expect(xo.has(PDFName.of('Fm0'))).toBe(false)
    expect(xo.has(PDFName.of('Logo'))).toBe(true)

    expect(await pageContent(out, 1)).toBe(await pageContent(before, 1))

    const p2 = await pageContent(out, 2)
    expect(p2).not.toContain('(WM)')
    expect(p2).toContain('(Note)')
    expect(p2).toContain('(Body)')
    const annots = out.getPage(2).node.Annots()!.asArray().map((a) => (out.context.lookup(a as PDFRef) as PDFDict).get(PDFName.of('Subtype'))?.toString())
    expect(annots).toEqual(['/Link'])
  })

  it('reports nothing found on a PDF without watermark objects', async () => {
    const doc = await PDFDocument.create()
    doc.addPage().drawText('Hello')
    const bytes = new Uint8Array(await doc.save())
    const r = await stripWatermarkObjects(bytes)
    expect(r.found).toBe(0)
    expect(r.pages).toEqual([])
    expect(r.bytes).toBe(bytes)
  })
})

describe('download after removal', () => {
  it('builds an output whose pages carry no watermark content, resources or annotations, but keep their text', async () => {
    const r = await stripWatermarkObjects(await fixture())
    const src = await loadSource('clean', r.bytes)
    const out = await PDFDocument.load(await buildPdf(src.pages, { clean: r.bytes }, {}))
    expect(out.getPageCount()).toBe(3)
    const all = (await Promise.all([0, 1, 2].map((i) => pageContent(out, i)))).join('\n')
    expect(all).toContain('(Body)')
    expect(all).not.toMatch(/DRAFT|\(WM\)|Fm0/)
    // Nothing tagged as a watermark survives anywhere in the file.
    const raw = dec(await out.save({ useObjectStreams: false }))
    expect(raw).not.toMatch(/\/Watermark/)
  })
})
