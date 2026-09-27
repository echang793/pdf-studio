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
export interface TextAnnot extends AnnotBase { kind: 'text'; text: string; size: number; color: RGB; font: FontName }
export interface RectAnnot extends AnnotBase { kind: 'rect'; fill: RGB | null; stroke: RGB | null; opacity: number }
export interface ImageAnnot extends AnnotBase { kind: 'image'; asset: string }
export type Annot = TextAnnot | RectAnnot | ImageAnnot
export type AnnotPatch = Partial<Omit<TextAnnot, 'kind' | 'id'>> & Partial<Omit<RectAnnot, 'kind' | 'id'>> & Partial<Omit<ImageAnnot, 'kind' | 'id'>>

export interface PageRef {
  id: string
  /** Source document id, or null for an inserted blank page. */
  src: string | null
  srcIndex: number
  rotation: Rotation
  media: Box
  crop: Box
  annots: Annot[]
}

export interface Asset { mime: 'image/png' | 'image/jpeg'; bytes: Uint8Array }

let counter = 0
export const uid = (prefix = 'id') => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`
