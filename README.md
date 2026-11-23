# PDF Studio

A free PDF cropper and editor that runs entirely in your browser. It covers what the paid
PDF sites do for cropping and page work, without accounts, uploads or a paywall. Your files
never leave your machine.

## Features

**Crop**
- Drag the crop frame or its handles, or draw a new frame on the page.
- Type exact margins in mm, inches or points, optionally the same on all sides.
- Apply to this page, all pages, odd, even, or a range like `1-3, 7, 10-`.
- Auto-trim: detects content and removes the white space around it.
- Non-destructive: cropping sets the PDF's CropBox, so the hidden edges stay in the file.
  "Full page" restores them, even on a file you already downloaded.

**Pages**
- Shift-click or cmd/ctrl-click thumbnails to pick several pages at once; everything below acts on
  whatever's picked, or on This page / All / Odd / Even / a typed range like `1-3, 7, 10-`.
- Drag thumbnails to reorder; rotate, duplicate, delete.
- Insert blank pages (same size, Letter or A4).
- Merge pages from other PDFs, extract a range to a new PDF, or split every N pages into a `.zip`.
- Add image(s) as pages, or export chosen pages as PNG/JPEG images at 72/150/300 dpi.
- Compress: shrinks JPEG images already embedded in the PDF; downloads a separate, smaller copy.
- Redact: see below.

**Watermark**
- Stamp text across a page range — font, size, color, opacity, angle. Re-applying replaces the old
  one instead of stacking, so it's easy to tweak.

**Edit**
- Text boxes (sans, serif or mono; size; color), white-out, highlight, outline boxes.
- Redact: unlike White-out, this actually removes what's underneath. "Download redacted copy"
  flattens just the pages with a Redact box into images — nothing about the live document changes,
  and it's a separate download so it can't happen by accident.
- Images (PNG, JPEG, or anything the browser can decode).
- Signatures: draw, type or upload. Saved signatures stay in this browser only.

**Erase** (PDF tab, fifth mode)
- Remove a watermark, stamp or blemish from pages of a PDF: paint over it and press Erase. Same Quick /
  AI fill as the Image tab. Pick This / All / Odd / Even / a range (or thumbnails) to erase the same marks
  on many pages at once; that's one undo step. Page rotation is handled.
- AI fill is the default. Marks bigger than one model window (a watermark across a page) are filled piece by piece at
  the page's full resolution, so text stays sharp instead of being squeezed and blurred. Quick fill is a plain
  fill and goes soft on anything but smooth areas. Paint snugly over the mark: a thick band gives the model little
  to copy from, and results get worse the bigger the hole.
- An erased page becomes a picture of itself (up to 300 dpi) with the marked area filled in. What was under the
  marks is gone from the downloaded PDF, but text on that page can no longer be selected and its text boxes
  and stamps are flattened in. Pages you don't erase are untouched.

**Image** (separate tab next to PDF)
- Erase a mark or blemish from one of your own images: paint over it, press Erase, and it fills in
  from the surrounding pixels. Undo each fill, reset to the original, save as PNG or JPEG.
- **Quick fill** is instant and offline: a plain fill that's great on skies, walls and gradients and
  soft on busy textures.
- **AI fill** rebuilds texture using the LaMa inpainting model running in your browser (WebGPU when
  available, otherwise CPU). First use downloads about 66 MB once (WebGPU) or 52 MB (CPU) and caches it;
  after that a fill takes about half a second on GPU, several seconds on CPU. Your image never leaves
  your device. If the download fails or its checksum doesn't match, it falls back to Quick fill.
- Use it on images you own or may edit — it isn't meant for stripping other people's copyright marks.

Also: undo/redo, drag-and-drop to open, dark mode, and a phone layout.

**Limits:**
- Text already inside a PDF can't be rewritten in place. To fix a word, cover it with White-out
  and add a Text box on top.
- Compress only recompresses images already stored as JPEG in a plain RGB/grayscale color space;
  other formats (Flate, CMYK, indexed) are left as-is rather than risk shifting their colors.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| ⌘Z / Ctrl+Z | Undo |
| ⇧⌘Z / Ctrl+Y | Redo |
| ⌘S / Ctrl+S | Download |
| Delete / Backspace | Delete the selected item |
| Esc | Deselect, back to the Select tool |
| J / K or PageDown / PageUp | Next / previous page |

## Run it locally

Needs Node.js 20 or newer.

```bash
npm install
npm run dev
```

Then open the address it prints (usually http://localhost:5173).

## Other commands

```bash
npm test          # unit tests (Vitest)
npm run lint      # oxlint
npm run typecheck # TypeScript
npm run build     # production build into dist/
npm run preview   # serve the production build locally
```

`dist/` must be served over HTTP (`npm run preview` or any static host); opening
`dist/index.html` straight from disk won't work because browsers block module scripts on `file://`.

## Deploy

Every push to `main` runs `.github/workflows/deploy.yml`: tests, then build, then publish to
GitHub Pages. The build uses relative paths, so it also works on any other static host.

## Credits and downloads for AI fill

Nothing here is bundled into the site; each file is fetched on first use, pinned to an exact version
and checked against a SHA-256 before it's used (see `src/render/lama.ts`).

- Model: [LaMa](https://github.com/advimman/lama) (Apache-2.0), via the quantized ONNX copy
  [othytenk/lama-int4-int8](https://huggingface.co/othytenk/lama-int4-int8) of
  [Carve/LaMa-ONNX](https://huggingface.co/Carve/LaMa-ONNX) (Apache-2.0), from huggingface.co.
- Engine: [onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web) 1.31.1 (MIT); its `.wasm` files come from cdn.jsdelivr.net.

## How it works

- [pdf.js](https://mozilla.github.io/pdf.js/) renders pages. The editor draws the full MediaBox,
  so cropped-away areas stay visible and restorable while you work.
- [pdf-lib](https://pdf-lib.js.org/) writes the output: CropBox, rotation, page order, merged
  pages, and stamped text, shapes and images.
- Page edits are plain data (`PageRef` in `src/core/model.ts`). The PDF is built from that data
  only when you download.

```
src/core/    pure logic, unit-tested: geometry, page ranges, auto-trim, PDF build, split, compress, inpaint (+ AI pre/post-processing, mask resampling)
src/state/   reducer with undo/redo history
src/render/  pdf.js loading and rendering, plus canvas work: image export, JPEG recompression,
             page rasterization for redaction
src/ui/      React components
tests/       Vitest tests for core and state
```
