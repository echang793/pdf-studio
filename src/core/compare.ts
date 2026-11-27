/** Comparing two versions of a document: a word diff of their text and boxes around what looks different. Pure. */

export interface WordOp { op: 'same' | 'add' | 'del'; text: string }

const MAX_CELLS = 4_000_000 // LCS table limit (~16 MB); bigger middles get a coarse "replaced" diff

/** Word-level diff (longest common subsequence after trimming the shared start and end). Runs are joined with spaces. */
export function diffWords(a: string[], b: string[]): WordOp[] {
  let s = 0
  while (s < a.length && s < b.length && a[s] === b[s]) s++
  let e = 0
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++
  const am = a.slice(s, a.length - e), bm = b.slice(s, b.length - e)
  const raw: { op: WordOp['op']; w: string }[] = a.slice(0, s).map((w) => ({ op: 'same', w }))

  const n = am.length, m = bm.length
  if (n * m > MAX_CELLS) {
    for (const w of am) raw.push({ op: 'del', w })
    for (const w of bm) raw.push({ op: 'add', w })
  } else if (n || m) {
    // lcs[i][j] = LCS length of am[i..] and bm[j..]
    const W = m + 1
    const lcs = new Uint32Array((n + 1) * W)
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * W + j] = am[i] === bm[j] ? lcs[(i + 1) * W + j + 1] + 1 : Math.max(lcs[(i + 1) * W + j], lcs[i * W + j + 1])
      }
    }
    let i = 0, j = 0
    const dels: string[] = [], adds: string[] = []
    const flush = () => {
      for (const w of dels) raw.push({ op: 'del', w })
      for (const w of adds) raw.push({ op: 'add', w })
      dels.length = 0
      adds.length = 0
    }
    while (i < n || j < m) {
      if (i < n && j < m && am[i] === bm[j]) { flush(); raw.push({ op: 'same', w: am[i] }); i++; j++ }
      else if (j < m && (i === n || lcs[i * W + j + 1] >= lcs[(i + 1) * W + j])) adds.push(bm[j++])
      else dels.push(am[i++])
    }
    flush()
  }
  for (const w of a.slice(a.length - e)) raw.push({ op: 'same', w })

  const out: WordOp[] = []
  for (const r of raw) {
    const last = out.at(-1)
    if (last && last.op === r.op) last.text += ' ' + r.w
    else out.push({ op: r.op, text: r.w })
  }
  return out
}

export interface PxBox { x: number; y: number; w: number; h: number }

/**
 * Boxes around areas that differ between two same-size RGBA images. Pixels count as changed past `tol`; the image
 * is cut into `cell`-px squares, squares with a few changed pixels are flagged, and touching (or one-square-apart)
 * flagged squares merge into one box. Anti-aliasing noise and single stray pixels don't make boxes.
 */
export function diffBoxes(a: Uint8ClampedArray, b: Uint8ClampedArray, w: number, h: number, opts: { tol?: number; cell?: number; minPx?: number } = {}): PxBox[] {
  const tol = opts.tol ?? 24, cell = opts.cell ?? 12, minPx = opts.minPx ?? 3
  const cw = Math.ceil(w / cell), ch = Math.ceil(h / cell)
  const count = new Uint32Array(cw * ch)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (Math.abs(a[i] - b[i]) > tol || Math.abs(a[i + 1] - b[i + 1]) > tol || Math.abs(a[i + 2] - b[i + 2]) > tol) count[((y / cell) | 0) * cw + ((x / cell) | 0)]++
    }
  }
  const flagged = new Uint8Array(cw * ch)
  for (let k = 0; k < flagged.length; k++) if (count[k] >= minPx) flagged[k] = 1
  const seen = new Uint8Array(cw * ch)
  const boxes: PxBox[] = []
  for (let k = 0; k < flagged.length; k++) {
    if (!flagged[k] || seen[k]) continue
    let x0 = cw, y0 = ch, x1 = -1, y1 = -1
    const stack = [k]
    seen[k] = 1
    while (stack.length) {
      const c = stack.pop()!
      const cx = c % cw, cy = (c / cw) | 0
      if (cx < x0) x0 = cx; if (cx > x1) x1 = cx
      if (cy < y0) y0 = cy; if (cy > y1) y1 = cy
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = cx + dx, ny = cy + dy
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue
        const nk = ny * cw + nx
        if (flagged[nk] && !seen[nk]) { seen[nk] = 1; stack.push(nk) }
      }
    }
    boxes.push({ x: x0 * cell, y: y0 * cell, w: Math.min(w, (x1 + 1) * cell) - x0 * cell, h: Math.min(h, (y1 + 1) * cell) - y0 * cell })
  }
  return boxes
}
