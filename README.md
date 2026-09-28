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

## How it works

- [pdf.js](https://mozilla.github.io/pdf.js/) renders pages. The editor draws the full MediaBox,
  so cropped-away areas stay visible and restorable while you work.
- [pdf-lib](https://pdf-lib.js.org/) writes the output: CropBox, rotation, page order, merged
  pages, and stamped text, shapes and images.
- Page edits are plain data (`PageRef` in `src/core/model.ts`). The PDF is built from that data
  only when you download.

```
src/core/    pure logic, unit-tested: geometry, page ranges, auto-trim, PDF build, split, compress
src/state/   reducer with undo/redo history
src/render/  pdf.js loading and rendering, plus canvas work: image export, JPEG recompression,
             page rasterization for redaction
src/ui/      React components
tests/       Vitest tests for core and state
```
