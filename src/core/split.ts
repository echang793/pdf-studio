import { zipSync } from 'fflate'

export function chunk<T>(items: T[], n: number): T[][] {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('Split size must be at least 1')
  const out: T[][] = []
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n))
  return out
}

export function zipFiles(files: { name: string; bytes: Uint8Array }[]): Uint8Array {
  // PDFs are already compressed; store them to keep zipping fast.
  return zipSync(Object.fromEntries(files.map((f) => [f.name, [f.bytes, { level: 0 }]])))
}
