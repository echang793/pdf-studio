import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { isEncrypted, PasswordError, protectPdf, unlockPdf, type QpdfRun } from '../src/core/passwords'

// The real qpdf WebAssembly build, run under Node (the browser loads the same module).
const DIST = new URL('../node_modules/@neslinesli93/qpdf-wasm/dist/', import.meta.url).pathname
let mod: Promise<{ FS: { writeFile(p: string, d: Uint8Array): void; readFile(p: string): Uint8Array; unlink(p: string): void }; callMain(a: string[]): number }> | null = null
const run: QpdfRun = async (input, args) => {
  mod ??= import(DIST + 'qpdf.js').then((m) => m.default({ locateFile: () => DIST + 'qpdf.wasm', noInitialRun: true, print: () => {}, printErr: () => {} }))
  const q = await mod
  q.FS.writeFile('/in.pdf', input)
  let code: number
  try { code = q.callMain(args('/in.pdf', '/out.pdf')) } catch (e) { code = (e as { status?: number }).status ?? 2 }
  let out: Uint8Array | null = null
  try { out = q.FS.readFile('/out.pdf'); q.FS.unlink('/out.pdf') } catch { out = null }
  return { code, out }
}

async function plain() {
  const d = await PDFDocument.create()
  d.addPage([200, 200]).drawText('hello')
  d.addPage([200, 200])
  return new Uint8Array(await d.save())
}

describe('passwords (qpdf)', () => {
  it('protect -> the file needs the password; unlock with it gives a normal PDF back', async () => {
    const locked = await protectPdf(await plain(), { user: 'secret pass!', restrict: false }, run)
    expect(await isEncrypted(locked)).toBe(true)
    await expect(PDFDocument.load(locked)).rejects.toThrow(/encrypt/i)
    const open = await unlockPdf(locked, 'secret pass!', run)
    expect(await isEncrypted(open)).toBe(false)
    expect((await PDFDocument.load(open)).getPageCount()).toBe(2)
  }, 20_000)
  it('a wrong password is reported as such', async () => {
    const locked = await protectPdf(await plain(), { user: 'right', restrict: false }, run)
    await expect(unlockPdf(locked, 'wrong', run)).rejects.toBeInstanceOf(PasswordError)
  }, 20_000)
  it('restrictions without an open password: opens with no password, and unlocking removes them', async () => {
    const locked = await protectPdf(await plain(), { user: '', restrict: true }, run)
    expect(await isEncrypted(locked)).toBe(true)
    const open = await unlockPdf(locked, '', run)
    expect(await isEncrypted(open)).toBe(false)
  }, 20_000)
  it('an unencrypted file is reported as not encrypted', async () => {
    expect(await isEncrypted(await plain())).toBe(false)
  }, 20_000)
})
