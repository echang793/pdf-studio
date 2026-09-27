export interface PixelBounds { x0: number; y0: number; x1: number; y1: number } // x1/y1 exclusive

export interface TrimOptions {
  /** A pixel counts as ink when any RGB channel is below this (0-255). */
  threshold?: number
  /** Extra pixels kept around the content, clamped to the canvas. */
  pad?: number
}

/** Bounding box of non-background pixels in RGBA data, or null if the page is blank. */
export function contentBounds(data: Uint8ClampedArray, width: number, height: number, opts: TrimOptions = {}): PixelBounds | null {
  const threshold = opts.threshold ?? 245
  const pad = opts.pad ?? 0
  let x0 = width, y0 = height, x1 = -1, y1 = -1
  for (let y = 0; y < height; y++) {
    let row = y * width * 4
    for (let x = 0; x < width; x++, row += 4) {
      if (data[row + 3] < 16) continue
      if (data[row] < threshold || data[row + 1] < threshold || data[row + 2] < threshold) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  return {
    x0: Math.max(0, x0 - pad),
    y0: Math.max(0, y0 - pad),
    x1: Math.min(width, x1 + 1 + pad),
    y1: Math.min(height, y1 + 1 + pad),
  }
}
