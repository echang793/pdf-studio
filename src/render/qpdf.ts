import wasmUrl from '@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url'
import type { QpdfRun } from '../core/passwords'

/**
 * qpdf (WebAssembly, @neslinesli93/qpdf-wasm 0.3.1, qpdf 12) for passwords. The ~1.3 MB engine is served with the
 * site and only loaded the first time a password feature is used. Files never leave the browser.
 */
interface Qpdf {
  callMain: (args: string[]) => number
  FS: { writeFile(p: string, d: Uint8Array): void; readFile(p: string): Uint8Array; unlink(p: string): void }
}

let mod: Promise<Qpdf> | null = null
let seq = 0

function load(): Promise<Qpdf> {
  mod ??= import('@neslinesli93/qpdf-wasm')
    .then((m) => {
      // This build ignores print/printErr and binds console.log/error when the module is created, so qpdf's own
      // messages ("invalid password", file names) would land in the console. Give it silent ones for that call.
      const { log, error } = console
      console.log = console.error = () => {}
      try {
        return (m.default as unknown as (o: object) => Promise<Qpdf>)({ locateFile: () => wasmUrl, noInitialRun: true })
      } finally {
        console.log = log
        console.error = error
      }
    })
    .catch((e) => { mod = null; throw e })
  return mod
}

export const qpdfRun: QpdfRun = async (input, args) => {
  const q = await load()
  const n = ++seq
  const inPath = `/in${n}.pdf`, outPath = `/out${n}.pdf`
  q.FS.writeFile(inPath, input)
  let code: number
  try { code = q.callMain(args(inPath, outPath)) } catch (e) { code = (e as { status?: number }).status ?? 2 }
  let out: Uint8Array | null = null
  try { out = q.FS.readFile(outPath).slice() } catch { out = null }
  for (const p of [inPath, outPath]) { try { q.FS.unlink(p) } catch { /* not created */ } }
  return { code, out }
}
