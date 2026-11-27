import type { Box } from './geometry'
import type { OcrWord } from './model'
import { patchRectPt } from './patch'

/** The parts of tesseract.js's `blocks` output that are used here. */
export interface TessBlock {
  paragraphs: { lines: { words: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[] }[] }[]
}

const MIN_CONFIDENCE = 30 // below this tesseract is mostly guessing; better no text than wrong text

/** Recognised words on an image of the whole unrotated MediaBox (imgW x imgH px) -> word boxes in PDF space. */
export function wordsFromTesseract(blocks: TessBlock[], imgW: number, imgH: number, media: Box): OcrWord[] {
  const out: OcrWord[] = []
  for (const b of blocks) for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words) {
    const text = w.text.trim()
    if (!text || w.confidence < MIN_CONFIDENCE) continue
    const r = patchRectPt({ x: w.bbox.x0, y: w.bbox.y0, w: w.bbox.x1 - w.bbox.x0, h: w.bbox.y1 - w.bbox.y0 }, imgW, imgH, media)
    out.push({ text, x: r.x, y: r.y, w: r.width, h: r.height })
  }
  return out
}
