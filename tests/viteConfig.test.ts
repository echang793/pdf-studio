import { describe, expect, it } from 'vitest'
import config from '../vite.config'

describe('build: drop-unused-ort-wasm', () => {
  it('drops only onnxruntime’s unused .wasm files and keeps the ones the site loads (qpdf)', () => {
    const plugins = (config as { plugins: unknown[] }).plugins.flat() as { name?: string; generateBundle?: (o: unknown, b: Record<string, unknown>) => void }[]
    const p = plugins.find((x) => x?.name === 'drop-unused-ort-wasm')!
    const bundle: Record<string, unknown> = {
      'assets/ort-wasm-simd-threaded.jsep-AbC123.wasm': {},
      'assets/ort-wasm-simd-threaded-XyZ.wasm': {},
      'assets/qpdf-B7vamGNu.wasm': {},
      'assets/index-1.js': {},
    }
    p.generateBundle!({}, bundle)
    expect(Object.keys(bundle).sort()).toEqual(['assets/index-1.js', 'assets/qpdf-B7vamGNu.wasm'])
  })
})
