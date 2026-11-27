import { rectFromDisplay, rectToDisplay } from './geometry'
import { uid, type FontName, type PageRef, type RGB, type TextAnnot } from './model'

export type Align = 'left' | 'center' | 'right'

/** Header and footer text with tokens {page} {pages} {date} {file}; blank text = none. */
export interface HeaderFooterSpec {
  header: string
  headerAlign: Align
  footer: string
  footerAlign: Align
  font: FontName
  size: number
  color: RGB
  /** Distance from the visible page edge, in points. */
  margin: number
  /** Number given to the first page of the document. */
  start: number
}

export interface StampContext { page: number; pages: number; file: string; date: string }

export function formatStamp(tpl: string, c: StampContext): string {
  return tpl.replace(/\{(page|pages|file|date)\}/g, (_, k: keyof StampContext) => String(c[k]))
}

/**
 * The header/footer text boxes for one page: full width between the side margins, at the top and bottom of what the
 * reader sees (the crop box, after rotation), tagged so re-applying can replace them.
 */
export function headerFooterAnnots(p: PageRef, spec: HeaderFooterSpec, c: StampContext): TextAnnot[] {
  const view = rectToDisplay(p.media, p.rotation, p.crop) // display space, y down
  const h = spec.size * 1.25
  const w = Math.max(1, view.width - 2 * spec.margin)
  const out: TextAnnot[] = []
  const add = (tpl: string, align: Align, tag: 'header' | 'footer', top: number) => {
    const text = formatStamp(tpl, c).trim()
    if (!text) return
    const rect = rectFromDisplay(p.media, p.rotation, { x: view.x + spec.margin, y: top, width: w, height: h })
    out.push({ id: uid('hf'), kind: 'text', text, size: spec.size, color: spec.color, font: spec.font, rect, rotate: p.rotation, align, tag })
  }
  add(spec.header, spec.headerAlign, 'header', view.y + spec.margin)
  add(spec.footer, spec.footerAlign, 'footer', view.y + view.height - spec.margin - h)
  return out
}
