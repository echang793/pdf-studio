import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from 'pdf-lib'

/** The document info fields a person usually means by "title/author". Empty string = leave out. */
export interface DocMeta { title: string; author: string; subject: string; keywords: string }
export interface MetaRead extends DocMeta { creator: string; producer: string; created: string; modified: string }

export interface OutputOptions {
  /** Title/author/subject/keywords to write; unset = none. */
  meta?: DocMeta
  /** Leave out hidden data: producer/creator/dates, per-page XMP and app data, comment authors and dates. */
  strip?: boolean
}

/** What a PDF says about itself (for showing before download). Missing fields are ''. */
export async function readMetadata(bytes: Uint8Array): Promise<MetaRead> {
  const d = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  const date = (x: Date | undefined) => (x ? x.toISOString().slice(0, 10) : '')
  return {
    title: d.getTitle() ?? '', author: d.getAuthor() ?? '', subject: d.getSubject() ?? '', keywords: d.getKeywords() ?? '',
    creator: d.getCreator() ?? '', producer: d.getProducer() ?? '', created: date(d.getCreationDate()), modified: date(d.getModificationDate()),
  }
}

const INFO_KEYS = { title: 'Title', author: 'Author', subject: 'Subject', keywords: 'Keywords' } as const

/** Write the chosen info fields, and with `strip` remove hidden data from every page of the finished document. */
export function applyOutputOptions(out: PDFDocument, o: OutputOptions) {
  // getInfoDict is private in pdf-lib's typings but stable; it creates the dict when missing.
  const info = (out as unknown as { getInfoDict(): PDFDict }).getInfoDict()
  if (o.meta) {
    for (const [k, key] of Object.entries(INFO_KEYS) as [keyof DocMeta, string][]) {
      const v = o.meta[k].trim()
      if (!v) info.delete(PDFName.of(key))
      else if (k === 'title') out.setTitle(v)
      else if (k === 'author') out.setAuthor(v)
      else if (k === 'subject') out.setSubject(v)
      else out.setKeywords(v.split(/\s+/))
    }
  }
  if (!o.strip) return
  for (const k of ['Producer', 'Creator', 'CreationDate', 'ModDate']) info.delete(PDFName.of(k))
  for (const page of out.getPages()) {
    for (const k of ['Metadata', 'PieceInfo', 'LastModified']) {
      // Drop the object too (not just the reference), or it would still be written into the file.
      const v = page.node.get(PDFName.of(k))
      if (v instanceof PDFRef) out.context.delete(v)
      page.node.delete(PDFName.of(k))
    }
    const annots = page.node.lookup(PDFName.of('Annots'))
    if (!(annots instanceof PDFArray)) continue
    for (const a of annots.asArray()) {
      const d = a instanceof PDFRef ? out.context.lookup(a) : a
      if (d instanceof PDFDict) for (const k of ['T', 'M', 'CreationDate', 'NM']) d.delete(PDFName.of(k))
    }
  }
}
