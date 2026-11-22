export interface InpaintOptions {
  /** How far (px) to look for known pixels when filling one. Default 6. */
  radius?: number
}

/**
 * Fills the masked pixels of an RGBA image in place by "peeling" the hole from its edge inward: each
 * layer of unknown pixels takes a distance-weighted average of the known pixels around it, then counts
 * as known for the next layer. Pure and framework-free so it's unit-tested in Node.
 *
 * It's a plain fill, not a texture synthesizer: great for small marks on smooth or gradient areas
 * (sky, walls, skin), soft/blurry on busy textures. Pixels outside the mask are never modified.
 * Returns how many pixels were filled. With nothing known anywhere (everything masked) it fills nothing.
 */
export function inpaint(data: Uint8ClampedArray, mask: Uint8Array, w: number, h: number, opts: InpaintOptions = {}): { filled: number } {
  if (mask.length !== w * h) throw new RangeError(`mask must have ${w * h} entries, got ${mask.length}`)
  if (data.length !== w * h * 4) throw new RangeError(`image data must have ${w * h * 4} entries, got ${data.length}`)
  const radius = Math.max(1, Math.round(opts.radius ?? 6))

  const known = new Uint8Array(w * h)
  let masked = 0
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) masked++
    else known[i] = 1
  }
  if (masked === 0 || masked === mask.length) return { filled: 0 }

  const queued = new Uint8Array(w * h)
  const touchesKnown = (i: number) => {
    const x = i % w
    const y = (i - x) / w
    return (x > 0 && known[i - 1]) || (x < w - 1 && known[i + 1]) || (y > 0 && known[i - w]) || (y < h - 1 && known[i + w])
  }

  let frontier: number[] = []
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] && touchesKnown(i)) { frontier.push(i); queued[i] = 1 }
  }

  let filled = 0
  while (frontier.length) {
    // Compute the whole layer from the known set as it was at the start, so pixels in one layer
    // don't bleed into each other and the result doesn't depend on scan order.
    const out = new Uint8ClampedArray(frontier.length * 3)
    for (let n = 0; n < frontier.length; n++) {
      const i = frontier[n]
      const px = i % w
      const py = (i - px) / w
      let r = 0, g = 0, b = 0, wsum = 0
      for (let dy = -radius; dy <= radius; dy++) {
        const y = py + dy
        if (y < 0 || y >= h) continue
        for (let dx = -radius; dx <= radius; dx++) {
          const x = px + dx
          if (x < 0 || x >= w) continue
          const j = y * w + x
          if (!known[j]) continue
          const wt = 1 / (dx * dx + dy * dy + 1)
          const k = j * 4
          r += data[k] * wt; g += data[k + 1] * wt; b += data[k + 2] * wt
          wsum += wt
        }
      }
      // A pixel on the frontier always has a known 4-neighbour inside the window, so wsum > 0.
      out[n * 3] = r / wsum; out[n * 3 + 1] = g / wsum; out[n * 3 + 2] = b / wsum
    }
    const next: number[] = []
    for (let n = 0; n < frontier.length; n++) {
      const i = frontier[n]
      const k = i * 4
      data[k] = out[n * 3]; data[k + 1] = out[n * 3 + 1]; data[k + 2] = out[n * 3 + 2]
      known[i] = 1
      filled++
    }
    for (const i of frontier) {
      const x = i % w
      const y = (i - x) / w
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]
      for (const j of nb) if (j >= 0 && mask[j] && !known[j] && !queued[j]) { queued[j] = 1; next.push(j) }
    }
    frontier = next
  }
  return { filled }
}

/** Grow a mask by `r` px on every side (square window), e.g. to swallow anti-aliased edges of a brush stroke. */
export function dilateMask(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const out = new Uint8Array(mask)
  const rad = Math.max(0, Math.round(r))
  if (rad === 0) return out
  // Separable: horizontal pass into `tmp`, then vertical pass into `out`.
  const tmp = new Uint8Array(mask.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue
      for (let dx = Math.max(0, x - rad); dx <= Math.min(w - 1, x + rad); dx++) tmp[y * w + dx] = 1
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!tmp[y * w + x]) continue
      for (let dy = Math.max(0, y - rad); dy <= Math.min(h - 1, y + rad); dy++) out[dy * w + x] = 1
    }
  }
  return out
}
