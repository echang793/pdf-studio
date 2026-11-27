# PDF Studio

## Purpose
Free, private, browser-only PDF cropper/editor (plus an image watermark eraser). Nothing is uploaded; cost must stay $0.
Live at https://echang793.github.io/pdf-studio/ (GitHub Pages, deployed by `.github/workflows/deploy.yml` on push to `main`).

## Stack
TypeScript (strict) + React 19 + Vite. pdf.js (pdfjs-dist 6) renders, pdf-lib 1.17 writes. onnxruntime-web 1.31 + LaMa ONNX for AI fill
(model/engine fetched on first use, SHA-256 pinned, see `src/render/lama.ts`). Vitest (Node env), oxlint.

## Entry points
- `src/main.tsx` -> `src/App.tsx` — app shell, PDF tab modes (crop / pages / watermark / edit / erase) and the Image tab.
- `src/core/pdf.ts` `buildPdf` — builds the output PDF from `PageRef` data (`src/core/model.ts`).

## Commands
```bash
npm run dev        # dev server (Vite)
npm test           # vitest run
npm run typecheck  # tsc -b
npm run lint       # oxlint (warnings in EraserParts.tsx/swatches.tsx are known false positives)
npm run build      # tsc -b && vite build -> dist/
```

## Architecture
- Document = list of `PageRef` (plain data) in a reducer with undo/redo (`src/state/store.ts`); the PDF is built only on download.
- `src/core/` is pure, unit-tested logic (typed arrays in/out); `src/render/` touches canvas/pdf.js/onnx; `src/ui/` is React.
- Erase: `PageRef.base` (PNG asset) replaces a page's content in the output; fills in `src/render/fill.ts`
  (Remove tint = exact un-blend in `src/core/unmix.ts`, Quick = `core/inpaint.ts`, AI = tiled LaMa).
- Assets (images, erased page bases) live in App state keyed by id; `registerBase` in `render/pdfjs.ts` makes them drawable.

## Gotchas
- A tab opened before a deploy fails to load hashed chunks ("Failed to fetch dynamically imported module"): reload.
- Tests run in Node: no canvas/ImageData there; keep pixel logic in `src/core/` on raw arrays.
- Never spread a huge typed array into `Math.max(...)` (stack overflow) — use reduce.
- `vite.config.ts` plugin `drop-unused-ort-wasm` deletes onnxruntime's `.wasm` from the build (lama.ts fetches pinned
  copies). It must match only `ort-wasm*`: it once deleted every `.wasm`, which would have shipped passwords without
  qpdf (`tests/viteConfig.test.ts`). Check `find dist -name '*.wasm'` after adding any wasm dependency.
- qpdf-wasm ignores `print`/`printErr` and binds `console.error` when created; `render/qpdf.ts` swaps in silent
  console functions for that one call. qpdf's `--is-encrypted` can't open user-password files: use `isEncrypted` (pdf-lib).
- Third-party downloads: AI fill (huggingface + jsDelivr, SHA-pinned), OCR (tesseract.js worker/core/eng data from
  jsDelivr, pinned versions). qpdf wasm is served with the site.

## Do NOT touch
- Pinned URLs/SHA-256 values in `src/render/lama.ts` unless deliberately upgrading the model/engine.
