import { LAMA_SIZE } from '../core/aiInpaint'

/**
 * Runs the LaMa inpainting model in the browser via onnxruntime-web. Everything downloaded is pinned to an
 * exact version/commit and checked against a SHA-256 before it's used, then kept in Cache Storage so it's
 * fetched once. Images never leave the device — only the model and engine files come in.
 *
 *  - model: huggingface.co/othytenk/lama-int4-int8 (quantized copy of Carve/LaMa-ONNX; Apache-2.0)
 *  - engine: onnxruntime-web 1.31.1 (MIT), its .wasm from cdn.jsdelivr.net (the JS side is bundled)
 */
const MODEL = {
  label: 'AI model',
  url: 'https://huggingface.co/othytenk/lama-int4-int8/resolve/b52ebb642126086fe3da1524a3b1d7629ae4c6a9/lama_int4_int8_r4.onnx',
  sha256: '4e3b78a253eb4abf21896811c928ffa91214b916e5d6ced24cecdd7999b4aaa1',
  bytes: 36_931_151,
}
const ORT_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/'
const ENGINE = {
  webgpu: { label: 'GPU engine', url: `${ORT_CDN}ort-wasm-simd-threaded.asyncify.wasm`, sha256: 'ca319e9539cd0f1e291cf56074760121eaf39650f5dbf84b6e52c07f4b2944ec', bytes: 28_747_738 },
  wasm: { label: 'CPU engine', url: `${ORT_CDN}ort-wasm-simd-threaded.wasm`, sha256: '4b884c203b0fa48d057be3332c65513ff85aa3c5bddd6946acc0fab7ecda001d', bytes: 14_848_852 },
}
const CACHE = 'pdf-studio-ai-v1'

export type AiProgress = (label: string, done: number, total: number) => void
export interface Lama { backend: 'webgpu' | 'wasm'; run: (image: Float32Array, mask: Float32Array) => Promise<Float32Array> }

interface Asset { label: string; url: string; sha256: string; bytes: number }

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

/** Download (or read from cache) one pinned file and verify its SHA-256. Throws on any mismatch. */
async function fetchVerified(a: Asset, onProgress?: AiProgress): Promise<Uint8Array> {
  const cache = 'caches' in globalThis ? await caches.open(CACHE).catch(() => null) : null
  const hit = await cache?.match(a.url)
  if (hit) {
    const bytes = new Uint8Array(await hit.arrayBuffer())
    if (hex(await crypto.subtle.digest('SHA-256', bytes)) === a.sha256) return bytes
    await cache!.delete(a.url) // corrupt or stale entry: fall through and re-download
  }
  const res = await fetch(a.url)
  if (!res.ok || !res.body) throw new Error(`${a.label}: download failed (HTTP ${res.status})`)
  const total = a.bytes // exact size of the pinned file (content-length can be the compressed size)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let done = 0
  for (;;) {
    const { value, done: end } = await reader.read()
    if (end) break
    chunks.push(value)
    done += value.length
    onProgress?.(a.label, done, total)
  }
  const bytes = new Uint8Array(done)
  let off = 0
  for (const c of chunks) { bytes.set(c, off); off += c.length }
  if (hex(await crypto.subtle.digest('SHA-256', bytes)) !== a.sha256) throw new Error(`${a.label}: downloaded file failed its integrity check`)
  await cache?.put(a.url, new Response(bytes)).catch(() => {}) // caching is best-effort (quota, private mode)
  return bytes
}

async function webgpuUsable(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu
    return !!gpu && !!(await gpu.requestAdapter())
  } catch {
    return false
  }
}

async function createRunner(backend: 'webgpu' | 'wasm', model: Uint8Array, onProgress?: AiProgress): Promise<Lama> {
  const wasm = await fetchVerified(ENGINE[backend], onProgress)
  const ort = backend === 'webgpu' ? await import('onnxruntime-web/webgpu') : await import('onnxruntime-web/wasm')
  ort.env.wasm.wasmBinary = wasm
  ort.env.logLevel = 'error' // the engine's "some nodes ran on CPU" warnings are expected and just noise
  if (!crossOriginIsolated) ort.env.wasm.numThreads = 1 // multi-threading needs special headers GitHub Pages can't send
  const session = await ort.InferenceSession.create(model.slice(), {
    executionProviders: [backend],
    extra: { session: { disable_quant_qdq: '1' } }, // required by this quantized export (see its model card)
  })
  return {
    backend,
    async run(image, mask) {
      const out = await session.run({
        image: new ort.Tensor('float32', image, [1, 3, LAMA_SIZE, LAMA_SIZE]),
        mask: new ort.Tensor('float32', mask, [1, 1, LAMA_SIZE, LAMA_SIZE]),
      })
      return out.output.data as Float32Array
    },
  }
}

let pending: Promise<Lama> | null = null

/** Load the model + engine once (GPU if usable, else CPU). A failed load can be retried. */
export function loadLama(onProgress?: AiProgress): Promise<Lama> {
  pending ??= (async () => {
    const model = await fetchVerified(MODEL, onProgress)
    if (await webgpuUsable()) {
      try { return await createRunner('webgpu', model, onProgress) } catch { /* fall back to the CPU engine below */ }
    }
    return createRunner('wasm', model, onProgress)
  })().catch((e) => { pending = null; throw e })
  return pending
}
