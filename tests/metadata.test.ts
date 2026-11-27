import { describe, expect, it } from 'vitest'
import { PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { readMetadata } from '../src/core/metadata'
import { buildPdf, loadSource } from '../src/core/pdf'

async function source() {
  const d = await PDFDocument.create()
  d.setTitle('Quarterly report')
  d.setAuthor('Jane Q')
  d.setSubject('Numbers')
  d.setKeywords(['q3', 'sales'])
  d.setCreator('Word')
  d.setProducer('SecretPDF 9.1')
  const p = d.addPage([200, 200])
  const ctx = d.context
  p.node.set(PDFName.of('PieceInfo'), ctx.obj({ App: { Private: PDFString.of('internal-id-123') } }))
  p.node.set(PDFName.of('Metadata'), ctx.register(ctx.stream('<x:xmpmeta>author: Jane Q</x:xmpmeta>', { Type: 'Metadata', Subtype: 'XML' })))
  p.node.set(PDFName.of('LastModified'), PDFString.of('D:20240101000000Z'))
  const note = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [0, 0, 10, 10], T: PDFString.of('Jane Q'), Contents: PDFString.of('keep me'), M: PDFString.of('D:20240101') }))
  p.node.set(PDFName.of('Annots'), ctx.obj([note]))
  return new Uint8Array(await d.save())
}

// Re-save without object streams (so text is greppable) and without pdf-lib adding its own producer/dates.
const raw = async (b: Uint8Array) => new TextDecoder('latin1').decode(await (await PDFDocument.load(b, { updateMetadata: false })).save({ useObjectStreams: false }))

describe('readMetadata', () => {
  it('reads the document info fields', async () => {
    const m = await readMetadata(await source())
    expect(m).toMatchObject({ title: 'Quarterly report', author: 'Jane Q', subject: 'Numbers', keywords: 'q3 sales', creator: 'Word', producer: 'SecretPDF 9.1' })
  })
})

describe('buildPdf metadata options', () => {
  it('writes the chosen title/author/subject/keywords', async () => {
    const bytes = await source()
    const src = await loadSource('s', bytes)
    const out = await PDFDocument.load(await buildPdf(src.pages, { s: bytes }, {}, undefined, { meta: { title: 'Clean', author: '', subject: 'S', keywords: 'a b' }, strip: false }))
    expect(out.getTitle()).toBe('Clean')
    expect(out.getAuthor()).toBeUndefined()
    expect(out.getSubject()).toBe('S')
    expect(out.getKeywords()).toBe('a b')
  })
  it('strip removes hidden data: producer/creator/dates, page XMP + PieceInfo + LastModified, comment authors and dates', async () => {
    const bytes = await source()
    const src = await loadSource('s', bytes)
    const built = await buildPdf(src.pages, { s: bytes }, {}, undefined, { meta: { title: '', author: '', subject: '', keywords: '' }, strip: true })
    const out = await PDFDocument.load(built, { updateMetadata: false })
    expect(out.getProducer()).toBeUndefined()
    expect(out.getCreator()).toBeUndefined()
    expect(out.getCreationDate()).toBeUndefined()
    expect(out.getModificationDate()).toBeUndefined()
    const text = await raw(built)
    expect(text).not.toMatch(/Jane Q|internal-id-123|xmpmeta|LastModified|SecretPDF|pdf-lib/)
    // The comment itself survives; only who/when is dropped.
    const annot = out.context.lookup(out.getPage(0).node.Annots()!.get(0)) as PDFDict
    expect((annot.get(PDFName.of('Contents')) as PDFString).decodeText()).toBe('keep me')
  })
  it('without strip, page-level hidden data is carried over as before', async () => {
    const bytes = await source()
    const src = await loadSource('s', bytes)
    const built = await buildPdf(src.pages, { s: bytes }, {}, undefined, { strip: false })
    expect(await raw(built)).toMatch(/internal-id-123/)
  })
})
