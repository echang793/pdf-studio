/**
 * Resample a binary mask (1 = marked) to another size so the same marks can be applied to a page of a
 * different pixel size. Any covered source pixel under a target pixel's footprint marks it, so a thin
 * stroke survives shrinking.
 */
export function resampleMask(mask: Uint8Array, w: number, h: number, tw: number, th: number): Uint8Array {
  const out = new Uint8Array(tw * th)
  for (let ty = 0; ty < th; ty++) {
    const y0 = Math.min(h - 1, Math.floor((ty * h) / th))
    const y1 = Math.min(h, Math.max(y0 + 1, Math.ceil(((ty + 1) * h) / th)))
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.min(w - 1, Math.floor((tx * w) / tw))
      const x1 = Math.min(w, Math.max(x0 + 1, Math.ceil(((tx + 1) * w) / tw)))
      let hit = 0
      for (let y = y0; y < y1 && !hit; y++) for (let x = x0; x < x1; x++) if (mask[y * w + x]) { hit = 1; break }
      out[ty * tw + tx] = hit
    }
  }
  return out
}
