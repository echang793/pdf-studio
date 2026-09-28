import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import { normRotation, type Box, type Point } from './geometry'
import { uid, type Annot, type Asset, type FontName, type PageRef } from './model'

export class SourceError extends Error {}

export interface Source { id: string; pages: PageRef[] }

function looksLikePdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024))
  return head.includes('%PDF-')
}

const toBox = (b: { x: number; y: number; width: number; height: number }): Box => ({ x: b.x, y: b.y, width: b.width, height: b.height })

/** Validate bytes and read per-page geometry. Throws SourceError with a user-facing message. */
export async function loadSource(id: string, bytes: Uint8Array): Promise<Source> {
  if (!looksLikePdf(bytes)) throw new SourceError('Not a PDF file')
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/encrypt/i.test(msg)) throw new SourceError('This PDF is password-protected or encrypted; unlock it first')
    throw new SourceError(`Could not read PDF: ${msg}`)
  }
  const pages = doc.getPages().map((p, i): PageRef => ({
    id: uid('pg'),
    src: id,
    srcIndex: i,
    rotation: normRotation(p.getRotation().angle),
    media: toBox(p.getMediaBox()),
    crop: toBox(p.getCropBox()),
    annots: [],
  }))
  if (pages.length === 0) throw new SourceError('PDF has no pages')
  return { id, pages }
}

const FONT: Record<FontName, StandardFonts> = {
  Helvetica: StandardFonts.Helvetica,
  Times: StandardFonts.TimesRoman,
  Courier: StandardFonts.Courier,
}

/**
 * Map a point in an annotation's local upright frame (origin bottom-left of the content as the viewer
 * sees it, y up) to unrotated page space. Returns the frame size too.
 */
export function annotFrame(a: Annot): { w: number; h: number; map: (lx: number, ly: number) => Point } {
  const { x, y, width, height } = a.rect
  switch (a.rotate) {
    case 0: return { w: width, h: height, map: (lx, ly) => ({ x: x + lx, y: y + ly }) }
    case 90: return { w: height, h: width, map: (lx, ly) => ({ x: x + width - ly, y: y + lx }) }
    case 180: return { w: width, h: height, map: (lx, ly) => ({ x: x + width - lx, y: y + height - ly }) }
    case 270: return { w: height, h: width, map: (lx, ly) => ({ x: x + ly, y: y + height - lx }) }
  }
}

interface Ctx {
  fonts: Map<FontName, PDFFont>
  images: Map<string, PDFImage>
  out: PDFDocument
  assets: Record<string, Asset>
}

async function font(ctx: Ctx, name: FontName) {
  let f = ctx.fonts.get(name)
  if (!f) ctx.fonts.set(name, (f = await ctx.out.embedFont(FONT[name])))
  return f
}

async function image(ctx: Ctx, key: string) {
  let img = ctx.images.get(key)
  if (img) return img
  const asset = ctx.assets[key]
  if (!asset) throw new Error(`Missing image asset "${key}"`)
  img = asset.mime === 'image/png' ? await ctx.out.embedPng(asset.bytes) : await ctx.out.embedJpg(asset.bytes)
  ctx.images.set(key, img)
  return img
}

async function drawAnnot(ctx: Ctx, page: PDFPage, a: Annot) {
  const f = annotFrame(a)
  const rotate = degrees(a.rotate)
  if (a.kind === 'rect' || a.kind === 'redact') {
    const o = f.map(0, 0)
    page.drawRectangle({
      x: o.x, y: o.y, width: f.w, height: f.h, rotate,
      color: a.fill ? rgb(...a.fill) : undefined,
      borderColor: a.stroke ? rgb(...a.stroke) : undefined,
      borderWidth: a.stroke ? 1.5 : 0,
      opacity: a.opacity, borderOpacity: a.opacity,
    })
  } else if (a.kind === 'image') {
    const o = f.map(0, 0)
    page.drawImage(await image(ctx, a.asset), { x: o.x, y: o.y, width: f.w, height: f.h, rotate })
  } else if (a.kind === 'text') {
    const fnt = await font(ctx, a.font)
    const lineH = a.size * 1.2
    a.text.split('\n').forEach((line, i) => {
      const o = f.map(0, f.h - a.size - i * lineH)
      // WinAnsi fonts can't encode everything; replace unsupported chars instead of throwing.
      const safe = [...line].map((ch) => { try { fnt.encodeText(ch); return ch } catch { return '?' } }).join('')
      page.drawText(safe, { x: o.x, y: o.y, size: a.size, font: fnt, color: rgb(...a.color), rotate })
    })
  } else {
    // Watermark: centered on the annotation's rect, tilted by `angle` on top of the page's own
    // rotation. pdf-lib rotates drawText around its (x, y) anchor, so the anchor is offset from the
    // rect's center by the (rotated) half-width/half-height of the text, not placed at the center itself.
    const fnt = await font(ctx, a.font)
    const safe = [...a.text].map((ch) => { try { fnt.encodeText(ch); return ch } catch { return '?' } }).join('')
    const center = f.map(f.w / 2, f.h / 2)
    const total = (a.rotate + a.angle) * (Math.PI / 180)
    const w = fnt.widthOfTextAtSize(safe, a.size)
    const dx = -w / 2
    const dy = -a.size * 0.35 // rough visual-center-to-baseline offset
    const x = center.x + dx * Math.cos(total) - dy * Math.sin(total)
    const y = center.y + dx * Math.sin(total) + dy * Math.cos(total)
    page.drawText(safe, { x, y, size: a.size, font: fnt, color: rgb(...a.color), opacity: a.opacity, rotate: degrees(a.rotate + a.angle) })
  }
}

export interface Rasterized { png: Uint8Array; box: Box }

/**
 * Build the final PDF from page refs. `sources` maps source id -> original bytes.
 *
 * `rasterized` (used for "download redacted copy") replaces specific pages wholesale with an already-
 * rendered image instead of copying/drawing them from vectors — the caller has baked every one of that
 * page's annotations (redaction boxes painted solid, everything else included) into that image, so no
 * `drawAnnot` calls happen for it here, and none of its original page content is copied into the output
 * at all. This function stays pdf-lib-only; the actual rasterization (pdf.js + canvas) is the caller's job.
 */
export async function buildPdf(
  pages: PageRef[],
  sources: Record<string, Uint8Array>,
  assets: Record<string, Asset>,
  rasterized?: Record<string, Rasterized>,
): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  const ctx: Ctx = { fonts: new Map(), images: new Map(), out, assets }
  const rasterImages = new Map<string, PDFImage>()

  // Copy every needed source page once per source, in one batch. Pages that will be rasterized
  // instead never need their original vector content, so they're left out of this entirely.
  const copied = new Map<string, Map<number, PDFPage>>()
  const docs = new Map<string, PDFDocument>()
  const needed = new Map<string, Set<number>>()
  for (const p of pages) if (p.src && !rasterized?.[p.id]) (needed.get(p.src) ?? needed.set(p.src, new Set()).get(p.src)!).add(p.srcIndex)
  for (const [src, idx] of needed) {
    const bytes = sources[src]
    if (!bytes) throw new Error(`Missing source document "${src}"`)
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    docs.set(src, doc)
    const list = [...idx]
    const got = await out.copyPages(doc, list)
    copied.set(src, new Map(list.map((n, i) => [n, got[i]])))
  }

  const used = new Set<PDFPage>()
  for (const ref of pages) {
    const raster = rasterized?.[ref.id]
    if (raster) {
      const page = out.addPage([raster.box.width, raster.box.height])
      let img = rasterImages.get(ref.id)
      if (!img) rasterImages.set(ref.id, (img = await out.embedPng(raster.png)))
      page.drawImage(img, { x: 0, y: 0, width: raster.box.width, height: raster.box.height })
      continue
    }
    let page: PDFPage
    if (ref.src) {
      const template = copied.get(ref.src)!.get(ref.srcIndex)!
      if (used.has(template)) {
        // Duplicate of an already-placed page: copy it again from its source.
        ;[page] = await out.copyPages(docs.get(ref.src)!, [ref.srcIndex])
      } else {
        page = template
        used.add(template)
      }
      out.addPage(page)
    } else {
      page = out.addPage([ref.media.width, ref.media.height])
    }
    page.setRotation(degrees(ref.rotation))
    const c = ref.crop
    page.setCropBox(c.x, c.y, c.width, c.height)
    for (const a of ref.annots) await drawAnnot(ctx, page, a)
  }
  return out.save()
}
