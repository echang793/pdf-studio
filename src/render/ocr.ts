import type { TessBlock } from '../core/ocr'

/**
 * OCR with tesseract.js 7 (Apache-2.0), English. It is only loaded when you ask for OCR; on first use it fetches its
 * engine and English data from cdn.jsdelivr.net (about 5 MB) and caches them in this browser. The image itself is
 * read in a worker on this device and never uploaded.
 */
type Progress = (label: string, fraction: number) => void
type W = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>

let worker: Promise<W> | null = null
let report: Progress | undefined

const LABEL: Record<string, string> = {
  'loading tesseract core': 'Downloading the OCR engine',
  'initializing tesseract': 'Starting OCR',
  'loading language traineddata': 'Downloading English text data',
  'initializing api': 'Starting OCR',
  'recognizing text': 'Reading text',
}

function getWorker(): Promise<W> {
  worker ??= import('tesseract.js')
    .then((t) => t.createWorker('eng', 1, { logger: (m: { status: string; progress: number }) => report?.(LABEL[m.status] ?? m.status, m.progress) }))
    .catch((e) => { worker = null; throw e })
  return worker
}

/** Words found on an image, with boxes in that image's pixels. */
export async function recognize(image: HTMLCanvasElement, onProgress?: Progress): Promise<TessBlock[]> {
  report = onProgress
  try {
    const w = await getWorker()
    const { data } = await w.recognize(image, {}, { blocks: true })
    return (data.blocks ?? []) as unknown as TessBlock[]
  } finally {
    report = undefined
  }
}
