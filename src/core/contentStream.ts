/**
 * A small PDF content-stream reader: enough to find operators, their operands and the exact bytes they span, so
 * a watermark can be cut out while every other byte of the page stays as it was. Pure (Uint8Array in/out).
 */
export type Tok =
  | { t: 'num'; v: number }
  | { t: 'name'; v: string }
  | { t: 'str' }
  | { t: 'bool'; v: boolean }
  | { t: 'null' }
  | { t: 'arr'; v: Tok[] }
  | { t: 'dict'; v: Record<string, Tok> }

export interface Op { op: string; operands: Tok[]; start: number; end: number }

const WS = new Set([0, 9, 10, 12, 13, 32])
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]) // ( ) < > [ ] { } / %
const isWs = (c: number) => WS.has(c)
const isRegular = (c: number) => !WS.has(c) && !DELIM.has(c)

/** Split a content stream into operators. Never throws on odd input: unreadable bytes are skipped. */
export function parseContent(b: Uint8Array): Op[] {
  let i = 0
  const n = b.length
  const ops: Op[] = []
  let operands: Tok[] = []
  let opStart = -1

  const skipWs = () => {
    while (i < n) {
      if (isWs(b[i])) i++
      else if (b[i] === 37) { while (i < n && b[i] !== 10 && b[i] !== 13) i++ } // % comment
      else break
    }
  }
  const word = () => { const s = i; while (i < n && isRegular(b[i])) i++; return String.fromCharCode(...b.subarray(s, i)) }
  const name = () => {
    i++ // '/'
    const s = i
    while (i < n && isRegular(b[i])) i++
    return String.fromCharCode(...b.subarray(s, i)).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  }
  const literal = () => {
    i++ // '('
    let depth = 1
    while (i < n && depth > 0) {
      const c = b[i++]
      if (c === 92) i++ // backslash escapes the next byte
      else if (c === 40) depth++
      else if (c === 41) depth--
    }
  }
  const value = (): Tok | null => {
    skipWs()
    if (i >= n) return null
    const c = b[i]
    if (c === 47) return { t: 'name', v: name() }
    if (c === 40) { literal(); return { t: 'str' } }
    if (c === 60 && b[i + 1] === 60) { // << dict >>
      i += 2
      const v: Record<string, Tok> = {}
      for (;;) {
        skipWs()
        if (i >= n) break
        if (b[i] === 62 && b[i + 1] === 62) { i += 2; break }
        if (b[i] !== 47) { i++; continue }
        const k = name()
        const val = value()
        if (val) v[k] = val
      }
      return { t: 'dict', v }
    }
    if (c === 60) { while (i < n && b[i] !== 62) i++; i++; return { t: 'str' } } // <hex>
    if (c === 91) { // [ array ]
      i++
      const v: Tok[] = []
      for (;;) {
        skipWs()
        if (i >= n) break
        if (b[i] === 93) { i++; break }
        const val = value()
        if (val) v.push(val)
        else i++
      }
      return { t: 'arr', v }
    }
    if (c === 41 || c === 62 || c === 93 || c === 123 || c === 125) { i++; return null } // stray delimiter
    const s = i
    const w = word()
    if (w === '') { i++; return null }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) return { t: 'num', v: Number(w) }
    if (w === 'true' || w === 'false') return { t: 'bool', v: w === 'true' }
    if (w === 'null') return { t: 'null' }
    i = s // an operator: let the caller read it
    return null
  }

  while (i < n) {
    skipWs()
    if (i >= n) break
    if (opStart < 0) opStart = i
    const c = b[i]
    if (isRegular(c) && !/[0-9+.-]/.test(String.fromCharCode(c))) {
      const s = i
      const w = word()
      if (w === 'true' || w === 'false' || w === 'null') { operands.push(w === 'null' ? { t: 'null' } : { t: 'bool', v: w === 'true' }); continue }
      if (w === 'BI') {
        // Inline image: dict up to ID, then raw data up to a whitespace-delimited EI.
        const idAt = indexOfWord(b, 'ID', i)
        let end = n
        if (idAt >= 0) {
          let j = idAt + 3
          while (j < n - 1) {
            if (b[j] === 69 && b[j + 1] === 73 && isWs(b[j - 1]) && (j + 2 >= n || isWs(b[j + 2]) || DELIM.has(b[j + 2]))) { end = j + 2; break }
            j++
          }
        }
        i = end
        ops.push({ op: 'BI', operands: [], start: s, end })
      } else {
        ops.push({ op: w, operands, start: opStart, end: i })
      }
      operands = []
      opStart = -1
      continue
    }
    const v = value()
    if (v) operands.push(v)
    else if (i < n && !isRegular(b[i])) i++ // skip unreadable delimiter
  }
  return ops
}

function indexOfWord(b: Uint8Array, w: string, from: number): number {
  const a = w.charCodeAt(0), c = w.charCodeAt(1)
  for (let j = from; j < b.length - 1; j++) {
    if (b[j] === a && b[j + 1] === c && (j === 0 || isWs(b[j - 1])) && (j + 2 >= b.length || isWs(b[j + 2]))) return j
  }
  return -1
}

/** Cut byte ranges (half-open, may overlap) out exactly; every byte outside them is kept as it was. */
export function removeRanges(b: Uint8Array, ranges: [number, number][]): Uint8Array {
  if (!ranges.length) return b
  const merged: [number, number][] = []
  for (const r of [...ranges].sort((p, q) => p[0] - q[0])) {
    const last = merged.at(-1)
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }
  const out: number[] = []
  let at = 0
  for (const [s, e] of merged) {
    for (let j = at; j < s; j++) out.push(b[j])
    // Two tokens that would now touch ("Q" + "q" -> "Qq") need a separator.
    if (out.length && e < b.length && !isWs(out[out.length - 1]) && !isWs(b[e])) out.push(10)
    at = e
  }
  for (let j = at; j < b.length; j++) out.push(b[j])
  return Uint8Array.from(out)
}

export interface WatermarkResolvers {
  /** Named property list (`/Tag /name BDC`): is it a watermark (an /Artifact /Watermark, or an optional-content group named like one)? */
  props: (name: string, tag: string) => boolean
  /** XObject drawn with `/name Do`: is it a watermark? */
  xobject: (name: string) => boolean
}

const isWatermarkDict = (d: Tok | undefined) => d?.t === 'dict' && d.v.Subtype?.t === 'name' && /^watermark$/i.test(d.v.Subtype.v)

/** Byte ranges of watermark content: marked-content blocks flagged as watermarks, and Do calls on watermark XObjects. */
export function findWatermarkRanges(ops: Op[], r: WatermarkResolvers): { ranges: [number, number][]; props: Set<string>; xobjects: Set<string> } {
  const ranges: [number, number][] = []
  const props = new Set<string>()
  const xobjects = new Set<string>()
  const stack: { start: number; wm: boolean }[] = []
  for (const o of ops) {
    if (o.op === 'BMC') stack.push({ start: o.start, wm: false })
    else if (o.op === 'BDC') {
      const tag = o.operands[0]?.t === 'name' ? o.operands[0].v : ''
      const p = o.operands[1]
      let wm = false
      if (p?.t === 'dict') wm = tag === 'Artifact' && isWatermarkDict(p)
      else if (p?.t === 'name' && r.props(p.v, tag)) { wm = true; props.add(p.v) }
      stack.push({ start: o.start, wm })
    } else if (o.op === 'EMC') {
      const top = stack.pop()
      if (top?.wm) ranges.push([top.start, o.end])
    } else if (o.op === 'Do') {
      const nm = o.operands[0]
      if (nm?.t === 'name' && r.xobject(nm.v)) { ranges.push([o.start, o.end]); xobjects.add(nm.v) }
    }
  }
  return { ranges, props, xobjects }
}
