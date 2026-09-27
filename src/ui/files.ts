import { contentBounds } from '../core/autotrim'
import type { Asset } from '../core/model'

export async function readBytes(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}

export function downloadBytes(bytes: Uint8Array, name: string, mime = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export const isPdfFile = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
export const isImageFile = (f: File) => f.type.startsWith('image/')

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? readBytes(b).then(resolve, reject) : reject(new Error('Could not encode image'))), 'image/png'),
  )
}

/** Load any browser-decodable image as a PNG/JPEG asset plus its pixel size. */
export async function imageToAsset(file: Blob): Promise<{ asset: Asset; width: number; height: number }> {
  const bmp = await createImageBitmap(file).catch(() => {
    throw new Error('Could not decode image')
  })
  const { width, height } = bmp
  if (file.type === 'image/png' || file.type === 'image/jpeg') {
    bmp.close()
    return { asset: { mime: file.type, bytes: await readBytes(file) }, width, height }
  }
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  c.getContext('2d')!.drawImage(bmp, 0, 0)
  bmp.close()
  return { asset: { mime: 'image/png', bytes: await canvasToPng(c) }, width, height }
}

/** Crop transparent/white margins off a drawing canvas and return it as a PNG asset. */
export async function trimmedCanvasAsset(src: HTMLCanvasElement): Promise<{ asset: Asset; width: number; height: number } | null> {
  const ctx = src.getContext('2d', { willReadFrequently: true })!
  const img = ctx.getImageData(0, 0, src.width, src.height)
  const b = contentBounds(img.data, src.width, src.height, { pad: 4 })
  if (!b) return null
  const c = document.createElement('canvas')
  c.width = b.x1 - b.x0
  c.height = b.y1 - b.y0
  c.getContext('2d')!.drawImage(src, b.x0, b.y0, c.width, c.height, 0, 0, c.width, c.height)
  return { asset: { mime: 'image/png', bytes: await canvasToPng(c) }, width: c.width, height: c.height }
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${mime};base64,${btoa(bin)}`
}

export function dataUrlToBytes(url: string): Uint8Array {
  const b64 = url.slice(url.indexOf(',') + 1)
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}
