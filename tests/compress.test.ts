import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import { canRecompress, compressImages, readImageMeta, type Reencoder } from '../src/core/compress'

// A tiny (2x2) but real baseline JPEG, so /DCTDecode is genuinely present.
const TINY_JPEG = Uint8Array.from(
  atob(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA//2Q==',
  ),
  (c) => c.charCodeAt(0),
)

async function pdfWithImage(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const img = await doc.embedJpg(TINY_JPEG)
  const page = doc.addPage([200, 200])
  page.drawImage(img, { x: 0, y: 0, width: 200, height: 200 })
  return doc.save()
}

async function firstImageStream(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes)
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype'))?.toString() === '/Image') return obj
  }
  throw new Error('no image found')
}

const shrink: Reencoder = async (bytes) => ({ bytes: new Uint8Array(Math.max(1, Math.floor(bytes.length / 4))), width: 2, height: 2 })
const grow: Reencoder = async (bytes) => ({ bytes: new Uint8Array(bytes.length * 2), width: 2, height: 2 })
const fails: Reencoder = async () => null

describe('canRecompress', () => {
  it('accepts only DCTDecode images in a plain RGB/Gray color space', () => {
    expect(canRecompress({ filter: '/DCTDecode', colorSpace: '/DeviceRGB', width: 2, height: 2, length: 10 })).toBe(true)
    expect(canRecompress({ filter: '/DCTDecode', colorSpace: '/DeviceGray', width: 2, height: 2, length: 10 })).toBe(true)
    expect(canRecompress({ filter: '/DCTDecode', colorSpace: '/DeviceCMYK', width: 2, height: 2, length: 10 })).toBe(false)
    expect(canRecompress({ filter: '/FlateDecode', colorSpace: '/DeviceRGB', width: 2, height: 2, length: 10 })).toBe(false)
    expect(canRecompress({ filter: null, colorSpace: null, width: 0, height: 0, length: 10 })).toBe(false)
  })
})

describe('compressImages', () => {
  it('replaces a shrinkable JPEG and updates its dict', async () => {
    const bytes = await pdfWithImage()
    const before = (await firstImageStream(bytes)).contents.length
    const result = await compressImages(bytes, shrink, {})
    expect(result.recompressed).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.before).toBe(bytes.length)
    const stream = await firstImageStream(result.bytes)
    expect(stream.contents.length).toBe(Math.floor(before / 4))
    expect(stream.dict.get(PDFName.of('Width'))?.toString()).toBe('2')
    expect(stream.dict.get(PDFName.of('Height'))?.toString()).toBe('2')
  })

  it('never makes an image bigger, and counts it as skipped', async () => {
    const bytes = await pdfWithImage()
    const before = (await firstImageStream(bytes)).contents.length
    const result = await compressImages(bytes, grow, {})
    expect(result.recompressed).toBe(0)
    expect(result.skipped).toBe(1)
    const stream = await firstImageStream(result.bytes)
    expect(stream.contents.length).toBe(before) // untouched
  })

  it('skips images the reencoder cannot handle, without throwing', async () => {
    const bytes = await pdfWithImage()
    const result = await compressImages(bytes, fails, {})
    expect(result.recompressed).toBe(0)
    expect(result.skipped).toBe(1)
  })

  it('reports meta for a non-image stream as unrecompressable', () => {
    const meta = readImageMeta({ get: () => undefined } as never, 100)
    expect(canRecompress(meta)).toBe(false)
  })
})
