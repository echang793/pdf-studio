import type { Box, Rotation } from './geometry'

export type RGB = [number, number, number] // 0-1 each
export type FontName = 'Helvetica' | 'Times' | 'Courier'

interface AnnotBase {
  id: string
  /** Bounds in unrotated PDF user space. */
  rect: Box
  /** Page rotation when placed; content is drawn upright for that rotation. */
  rotate: Rotation
}
export interface TextAnnot extends AnnotBase {
  kind: 'text'; text: string; size: number; color: RGB; font: FontName
  /** Horizontal alignment inside the box (default left). */
  align?: 'left' | 'center' | 'right'
  /** Set on generated header/footer boxes, so re-applying replaces them. */
  tag?: 'header' | 'footer'
}
export interface RectAnnot extends AnnotBase { kind: 'rect'; fill: RGB | null; stroke: RGB | null; opacity: number }
/** Same shape as RectAnnot (drags/resizes the same way) but flagged for real removal: exporting a
 *  "redacted copy" rasterizes any page carrying one of these, so the covered content can't be
 *  recovered the way it still can be under a plain White-out rect. */
export interface RedactAnnot extends AnnotBase { kind: 'redact'; fill: RGB | null; stroke: RGB | null; opacity: number }
export interface ImageAnnot extends AnnotBase { kind: 'image'; asset: string }
/** A bulk stamp, generated whole by "Apply watermark" rather than drawn interactively. `angle` tilts
 *  it independently of the page's own rotation (0 = upright text at that rotation). */
export interface WatermarkAnnot extends AnnotBase { kind: 'watermark'; text: string; size: number; color: RGB; opacity: number; angle: number; font: FontName }
export type Annot = TextAnnot | RectAnnot | RedactAnnot | ImageAnnot | WatermarkAnnot
export type AnnotPatch = Partial<Omit<TextAnnot, 'kind' | 'id'>> & Partial<Omit<RectAnnot, 'kind' | 'id'>> & Partial<Omit<RedactAnnot, 'kind' | 'id'>> & Partial<Omit<ImageAnnot, 'kind' | 'id'>> & Partial<Omit<WatermarkAnnot, 'kind' | 'id'>>

export interface PageRef {
  id: string
  /** Source document id, or null for an inserted blank page. */
  src: string | null
  srcIndex: number
  rotation: Rotation
  media: Box
  crop: Box
  annots: Annot[]
  /** An image (asset key, PNG of the whole unrotated MediaBox) that stands in for the page's original
   *  content: set when part of the page was erased. The source page is then not copied into the output,
   *  so what was erased is really gone. */
  base?: {
    asset: string
    /** Patch mode: the image covers only this area (PDF user space) and is drawn OVER the original page, which is
     *  kept (vector, selectable text). Transparent pixels show the original. What it covers is hidden, not removed. */
    rect?: Box
  }
}

export interface Asset { mime: 'image/png' | 'image/jpeg'; bytes: Uint8Array }

let counter = 0
export const uid = (prefix = 'id') => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`
