import { dilateMask } from './inpaint'

/**
 * Find a watermark automatically, as a 0/1 mask, from page images all drawn at the same size (RGBA, w x h).
 *
 * A watermark is the thing that sits in the same place with the same colour on most pages, while body text
 * changes from page to page. So a pixel is marked when, on at least 60% of pages (and 2+), it is neither blank
 * page nor dark ink, and its colour agrees across those pages. Pixels within 2 px of dark ink are skipped
 * (text anti-aliasing). Dark repeated things (headers, page numbers, logos in black) are left alone on purpose. With one page there is nothing to compare, so coloured pixels are
 * taken instead. The result is meant as a starting point you can review, not a final answer.
 */
export function findRepeatedMark(pages: Uint8ClampedArray[], w: number, h: number, opts: { grow?: number } = {}): Uint8Array {
  const grow = opts.grow ?? 3
  const n = w * h
  const papers = pages.map((d) => paperOf(d, n))
  const mask = new Uint8Array(n)
  if (pages.length === 0) return mask

  // Light pixels hugging dark ink are anti-aliased text edges, not watermark: skip anything within 2 px of ink.
  const nearInk = pages.map((d, p) => {
    const dark = new Uint8Array(n)
    const pl = luma(papers[p][0], papers[p][1], papers[p][2])
    for (let i = 0; i < n; i++) if (luma(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) < 0.35 * pl) dark[i] = 1
    return dilateMask(dark, w, h, 2)
  })
  const isCandidate = (p: number, i: number) => {
    if (nearInk[p][i]) return false
    const d = pages[p], paper = papers[p]
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2]
    const off = Math.max(Math.abs(r - paper[0]), Math.abs(g - paper[1]), Math.abs(b - paper[2]))
    return off > 10 && luma(r, g, b) >= 0.35 * luma(paper[0], paper[1], paper[2])
  }

  if (pages.length === 1) {
    const d = pages[0]
    for (let i = 0; i < n; i++) {
      if (!isCandidate(0, i)) continue
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2]
      const m = (r + g + b) / 3
      if (Math.hypot(r - m, g - m, b - m) >= 12) mask[i] = 1
    }
  } else {
    const need = Math.max(2, Math.ceil(0.6 * pages.length))
    const colored = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      let count = 0
      let lo0 = 255, lo1 = 255, lo2 = 255, hi0 = 0, hi1 = 0, hi2 = 0
      for (let p = 0; p < pages.length; p++) {
        if (!isCandidate(p, i)) continue
        const d = pages[p]
        count++
        const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2]
        if (r < lo0) lo0 = r; if (r > hi0) hi0 = r
        if (g < lo1) lo1 = g; if (g > hi1) hi1 = g
        if (b < lo2) lo2 = b; if (b > hi2) hi2 = b
      }
      if (count >= need && hi0 - lo0 <= 24 && hi1 - lo1 <= 24 && hi2 - lo2 <= 24) {
        mask[i] = 1
        const r = (lo0 + hi0) / 2, g = (lo1 + hi1) / 2, b = (lo2 + hi2) / 2, m = (r + g + b) / 3
        if (Math.hypot(r - m, g - m, b - m) >= 12) colored[i] = 1
      }
    }
    // Grey repeats are only trusted where they are thick: an opening (erode, then dilate) by 2 px drops thin
    // speckle such as small text that renders grey, and keeps watermark strokes. Coloured repeats are kept as is.
    const thick = dilateMask(erodeMask(mask, w, h, 2), w, h, 2)
    for (let i = 0; i < n; i++) mask[i] = mask[i] && (colored[i] || thick[i]) ? 1 : 0
  }
  return grow > 0 ? dilateMask(mask, w, h, grow) : mask
}

function erodeMask(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const inv = new Uint8Array(m.length)
  for (let i = 0; i < m.length; i++) inv[i] = m[i] ? 0 : 1
  const grown = dilateMask(inv, w, h, r)
  // Outside the image counts as "not marked", so pixels within r of the border erode too.
  const out = new Uint8Array(m.length)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x
    out[i] = !grown[i] && x >= r && y >= r && x < w - r && y < h - r ? 1 : 0
  }
  return out
}

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

/** The commonest colour on a page (its paper), from a coarse histogram. */
function paperOf(d: Uint8ClampedArray, n: number): number[] {
  const bins = new Uint32Array(4096)
  const sum = new Float64Array(4096 * 3)
  const step = Math.max(1, Math.floor(n / 200_000))
  for (let i = 0; i < n; i += step) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2]
    const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    bins[k]++
    sum[k * 3] += r; sum[k * 3 + 1] += g; sum[k * 3 + 2] += b
  }
  let best = 0
  for (let k = 1; k < 4096; k++) if (bins[k] > bins[best]) best = k
  return [sum[best * 3] / bins[best], sum[best * 3 + 1] / bins[best], sum[best * 3 + 2] / bins[best]]
}
