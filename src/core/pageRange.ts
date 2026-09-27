/** Parse a 1-based page range spec ("1-3,7,10-", "all", "odd", "even") into sorted, unique 0-based indices. */
export function parsePageRange(spec: string, pageCount: number): number[] {
  const s = spec.trim().toLowerCase()
  if (!s) throw new RangeError('Page range is empty')
  const all = Array.from({ length: pageCount }, (_, i) => i)
  if (s === 'all') return all
  if (s === 'odd') return all.filter((i) => i % 2 === 0)
  if (s === 'even') return all.filter((i) => i % 2 === 1)

  const out = new Set<number>()
  for (const raw of s.split(',')) {
    const part = raw.trim()
    const m = /^(\d*)\s*(-)?\s*(\d*)$/.exec(part)
    if (!part || !m || (!m[1] && !m[3])) throw new RangeError(`Invalid page range part "${raw.trim()}"`)
    const start = m[1] ? Number(m[1]) : 1
    const end = m[2] ? (m[3] ? Number(m[3]) : pageCount) : start
    for (const n of [start, end]) {
      if (n < 1 || n > pageCount) throw new RangeError(`Page ${n} is out of range (1-${pageCount})`)
    }
    if (start > end) throw new RangeError(`Range "${part}" is backwards`)
    for (let n = start; n <= end; n++) out.add(n - 1)
  }
  return [...out].sort((a, b) => a - b)
}
