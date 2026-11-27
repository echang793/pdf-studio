import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFRef, PDFStream, PDFString, decodePDFRawStream, type PDFObject } from 'pdf-lib'
import { findWatermarkRanges, parseContent, removeRanges } from './contentStream'

/**
 * Remove watermarks that a PDF stores as their own objects — the kind Acrobat, Word and most PDF tools add —
 * instead of erasing pixels. The page stays vector (text selectable, nothing rasterized or guessed) and only the
 * watermark's own bytes are cut out. Recognised:
 *  - marked content `/Artifact <</Subtype /Watermark ...>> BDC ... EMC`
 *  - optional-content blocks (`/OC /name BDC ... EMC`) whose layer is named like "Watermark"
 *  - form XObjects tagged as watermarks (Acrobat's `/PieceInfo /ADBE_CompoundType /Private /Watermark`), or in such a layer
 *  - annotations of subtype /Watermark
 * Watermarks merely drawn as ordinary text or paths carry no such marker; those need the pixel Erase instead.
 */
export interface StripResult {
  /** The cleaned PDF (the input itself on a dry run, or when nothing was found). */
  bytes: Uint8Array
  /** 0-based indices of pages that had watermark objects. */
  pages: number[]
  /** How many watermark objects were found (blocks, XObject uses, annotations). */
  found: number
}

const N = (s: string) => PDFName.of(s)
const text = (o: PDFObject | undefined) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : o instanceof PDFName ? o.decodeText() : '')
const WATERMARK = /water\s*mark/i

function isWatermarkLayer(doc: PDFDocument, o: PDFObject | undefined): boolean {
  const d = o instanceof PDFRef ? doc.context.lookup(o) : o
  if (!(d instanceof PDFDict)) return false
  const type = text(d.get(N('Type')))
  if (type === 'OCG') return WATERMARK.test(text(d.lookup(N('Name'))))
  if (type === 'OCMD') { // membership dict: a watermark if all its groups are
    const g = d.lookup(N('OCGs'))
    const groups = g instanceof PDFArray ? g.asArray() : g ? [g] : []
    return groups.length > 0 && groups.every((x) => isWatermarkLayer(doc, x))
  }
  return WATERMARK.test(text(d.get(N('Subtype'))))
}

function isWatermarkXObject(doc: PDFDocument, o: PDFObject | undefined): boolean {
  const s = o instanceof PDFRef ? doc.context.lookup(o) : o
  if (!(s instanceof PDFStream)) return false
  const piece = s.dict.lookup(N('PieceInfo'))
  if (piece instanceof PDFDict) {
    const ct = piece.lookup(N('ADBE_CompoundType'))
    if (ct instanceof PDFDict && WATERMARK.test(text(ct.lookup(N('Private'))))) return true
  }
  return isWatermarkLayer(doc, s.dict.get(N('OC')))
}

function readContent(doc: PDFDocument, contents: PDFObject | undefined): Uint8Array | null {
  const list = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : []
  const parts: Uint8Array[] = []
  for (const item of list) {
    const s = item instanceof PDFRef ? doc.context.lookup(item) : item
    if (s instanceof PDFRawStream) parts.push(decodePDFRawStream(s).decode())
    else if (s instanceof PDFStream) parts.push(s.getContents())
    else return null
  }
  const total = parts.reduce((a, p) => a + p.length + 1, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length; out[at++] = 10 } // streams join as if separated by whitespace
  return out
}

export async function stripWatermarkObjects(bytes: Uint8Array, opts: { dryRun?: boolean } = {}): Promise<StripResult> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const pages: number[] = []
  let found = 0
  doc.getPages().forEach((page, i) => {
    const node = page.node
    const res = node.Resources()
    const props = res?.lookup(N('Properties'))
    const xobj = res?.lookup(N('XObject'))
    let hits = 0

    let content: Uint8Array | null = null
    try { content = readContent(doc, node.Contents()) } catch { content = null } // unsupported filter: leave the page alone
    let cut: ReturnType<typeof findWatermarkRanges> | null = null
    if (content) {
      cut = findWatermarkRanges(parseContent(content), {
        props: (name) => props instanceof PDFDict && isWatermarkLayer(doc, props.get(N(name))),
        xobject: (name) => xobj instanceof PDFDict && isWatermarkXObject(doc, xobj.get(N(name))),
      })
      hits += cut.ranges.length
    }

    const annots = node.Annots()
    const keep: PDFObject[] = []
    let annotHits = 0
    for (const a of annots?.asArray() ?? []) {
      const d = a instanceof PDFRef ? doc.context.lookup(a) : a
      if (d instanceof PDFDict && text(d.get(N('Subtype'))) === 'Watermark') annotHits++
      else keep.push(a)
    }
    hits += annotHits
    if (!hits) return
    pages.push(i)
    found += hits
    if (opts.dryRun) return

    if (content && cut && cut.ranges.length) {
      const cleaned = removeRanges(content, cut.ranges)
      node.set(N('Contents'), doc.context.register(doc.context.flateStream(cleaned)))
      // Drop the now-unused resource entries so the watermark isn't carried into the output either.
      if (xobj instanceof PDFDict) for (const k of cut.xobjects) xobj.delete(N(k))
      if (props instanceof PDFDict) for (const k of cut.props) props.delete(N(k))
    }
    if (annotHits) node.set(N('Annots'), doc.context.obj(keep))
  })
  if (opts.dryRun || found === 0) return { bytes, pages, found }
  return { bytes: new Uint8Array(await doc.save({ useObjectStreams: false })), pages, found }
}
