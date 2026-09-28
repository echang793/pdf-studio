import { PDFDocument, PDFName, PDFNumber, PDFRawStream, type PDFDict } from 'pdf-lib'

export interface ImageMeta { filter: string | null; colorSpace: string | null; width: number; height: number; length: number }
export interface CompressOptions {
  /** JPEG quality, 0-1. Default 0.7. */
  quality?: number
  /** Downscale so neither side exceeds this many px. Default 1600. */
  maxDim?: number
  /** Skip an image unless the re-encode saves at least this fraction of its bytes. Default 0.05. */
  minSaving?: number
}
export interface CompressResult { bytes: Uint8Array; before: number; after: number; recompressed: number; skipped: number }

/**
 * Re-encodes one image's raw stream bytes, downscaled to at most `maxDim` on its longest side, at
 * the given JPEG quality. Returns null to skip (undecodable, or not worth replacing). This is the
 * only part of compression that needs a real canvas — see render/pdfjs.ts for the browser implementation;
 * tests supply a stub so the rest of this module (PDF structure, decisions, byte accounting) stays
 * unit-tested in plain Node.
 */
export type Reencoder = (bytes: Uint8Array, mime: string, maxDim: number, quality: number) => Promise<{ bytes: Uint8Array; width: number; height: number } | null>

const get = (dict: PDFDict, key: string): string | null => {
  const v = dict.get(PDFName.of(key))
  return v ? v.toString() : null
}

export function readImageMeta(dict: PDFDict, contentLength: number): ImageMeta {
  return {
    filter: get(dict, 'Filter'),
    colorSpace: get(dict, 'ColorSpace'),
    width: Number(get(dict, 'Width')) || 0,
    height: Number(get(dict, 'Height')) || 0,
    length: contentLength,
  }
}

/**
 * v1 only recompresses already-JPEG (`/DCTDecode`) images in a plain RGB or grayscale color space.
 * Everything else (Flate/CCITT-encoded, CMYK, Indexed, ICC-based) is left untouched: those need real
 * decoding this app doesn't do, and a naive canvas round-trip can silently shift their colors.
 */
export function canRecompress(meta: ImageMeta): boolean {
  return meta.filter === '/DCTDecode' && (meta.colorSpace === '/DeviceRGB' || meta.colorSpace === '/DeviceGray')
}

/** Recompress the eligible embedded images in a built PDF. Never makes an image bigger. */
export async function compressImages(bytes: Uint8Array, reencode: Reencoder, opts: CompressOptions = {}): Promise<CompressResult> {
  const quality = opts.quality ?? 0.7
  const maxDim = opts.maxDim ?? 1600
  const minSaving = opts.minSaving ?? 0.05
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  let recompressed = 0
  let skipped = 0
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue
    if (get(obj.dict, 'Subtype') !== '/Image') continue
    const meta = readImageMeta(obj.dict, obj.contents.length)
    if (!canRecompress(meta)) { skipped++; continue }
    const next = await reencode(obj.contents, 'image/jpeg', maxDim, quality)
    if (!next || next.bytes.length > meta.length * (1 - minSaving)) { skipped++; continue }
    // pdf-lib types `contents` readonly, but it's a plain mutable field at runtime — this is how
    // in-place stream replacement works (confirmed against the installed pdf-lib version).
    ;(obj as { contents: Uint8Array }).contents = next.bytes
    obj.dict.set(PDFName.of('Width'), PDFNumber.of(next.width))
    obj.dict.set(PDFName.of('Height'), PDFNumber.of(next.height))
    obj.dict.set(PDFName.of('Length'), PDFNumber.of(next.bytes.length))
    recompressed++
  }
  const out = await doc.save()
  return { bytes: out, before: bytes.length, after: out.length, recompressed, skipped }
}
