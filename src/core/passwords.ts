import { EncryptedPDFError, PDFDocument } from 'pdf-lib'

/**
 * Password protection and unlocking via qpdf (WebAssembly, loaded by the caller). The runner writes `input` to its
 * virtual file system, runs qpdf with the arguments built here, and returns the exit code and the output file.
 * Passwords only ever go into that argument list in memory; nothing is logged or stored.
 */
export type QpdfRun = (input: Uint8Array, args: (inPath: string, outPath: string) => string[]) => Promise<{ code: number; out: Uint8Array | null }>

export class PasswordError extends Error {}

// qpdf exit codes: 0 ok, 2 error, 3 succeeded with warnings.
const ok = (code: number) => code === 0 || code === 3

/**
 * True when the file is encrypted (needs a password to open, or carries permission restrictions). pdf-lib refuses
 * encrypted files with a specific error, which makes a cheap test (qpdf's own check needs the password).
 */
export async function isEncrypted(bytes: Uint8Array): Promise<boolean> {
  try {
    await PDFDocument.load(bytes, { updateMetadata: false })
    return false
  } catch (e) {
    return e instanceof EncryptedPDFError || /encrypt/i.test(e instanceof Error ? e.message : String(e))
  }
}

/** Remove encryption. `password` may be '' for files that only restrict printing/copying. */
export async function unlockPdf(bytes: Uint8Array, password: string, run: QpdfRun): Promise<Uint8Array> {
  const r = await run(bytes, (i, o) => [`--password=${password}`, '--decrypt', i, o])
  if (!ok(r.code) || !r.out) {
    // qpdf can't open it with that password (the only common reason this fails on a file pdf.js could read).
    throw new PasswordError(password ? 'That password is not right' : 'This PDF needs a password to open')
  }
  return r.out
}

export interface ProtectOptions {
  /** Password needed to open the file ('' = anyone can open it). */
  user: string
  /** Block printing, editing and copying text (enforced by viewers that respect PDF permissions). */
  restrict: boolean
}

function randomOwner(): string {
  const b = new Uint8Array(18)
  crypto.getRandomValues(b)
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** Encrypt with AES-256. The owner password (needed to change permissions) is random: nobody needs it here. */
export async function protectPdf(bytes: Uint8Array, o: ProtectOptions, run: QpdfRun): Promise<Uint8Array> {
  const perms = o.restrict ? ['--print=none', '--modify=none', '--extract=n'] : []
  const r = await run(bytes, (i, out) => ['--encrypt', o.user, randomOwner(), '256', ...perms, '--', i, out])
  if (!ok(r.code) || !r.out) throw new Error('Could not add the password to this PDF')
  return r.out
}
