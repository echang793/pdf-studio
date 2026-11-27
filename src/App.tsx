import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { compressImages } from './core/compress'
import { boxToMargins, displaySize, marginsToBox, rectFromDisplay, type Box, type Margins, type Unit } from './core/geometry'
import { uid, type Annot, type AnnotPatch, type Asset, type PageRef } from './core/model'
import { buildPdf, loadSource, SourceError, type Rasterized } from './core/pdf'
import { resolveScope, type Scope } from './core/scope'
import { chunk, zipFiles } from './core/split'
import { stripWatermarkObjects } from './core/watermarkObjects'
import { autoTrimMargins, closeAll, openForRender, rasterizePage, reencodeJpeg, registerBase, renderPageToImage } from './render/pdfjs'
import { initialState, reducer } from './state/store'
import { AnnotLayer } from './ui/AnnotLayer'
import { CropOverlay } from './ui/CropOverlay'
import { CropPanel } from './ui/CropPanel'
import { EditPanel } from './ui/EditPanel'
import { ImageEraser } from './ui/ImageEraser'
import { Icon, Logo } from './ui/icons'
import { downloadBytes, imageToAsset, isImageFile, isPdfFile, readBytes } from './ui/files'
import { PageCanvas } from './ui/PageCanvas'
import { PageEraser, type Erased } from './ui/PageEraser'
import { PagesPanel } from './ui/PagesPanel'
import { SignatureModal } from './ui/SignatureModal'
import { ThumbRail } from './ui/ThumbRail'
import type { Tool } from './ui/tools'
import { useFitScale } from './ui/useFitScale'
import { WatermarkPanel, type WatermarkSpec } from './ui/WatermarkPanel'

type Mode = 'crop' | 'pages' | 'watermark' | 'edit' | 'erase'
const SIZES = { letter: { width: 612, height: 792 }, a4: { width: 595.28, height: 841.89 } }
const sameMargins = (a: Margins, b: Margins) => (['top', 'right', 'bottom', 'left'] as const).every((k) => Math.abs(a[k] - b[k]) < 0.05)

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [view, setView] = useState<'pdf' | 'image'>('pdf')
  const [mode, setMode] = useState<Mode>('crop')
  const [tool, setTool] = useState<Tool>('select')
  const [scope, setScopeRaw] = useState<Scope>({ mode: 'current', range: '' })
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const anchor = useRef<string | null>(null)
  const [draftState, setDraftState] = useState<{ key: string; m: Margins } | null>(null)
  const [selectedAnnot, setSelectedAnnot] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null)
  const [showSig, setShowSig] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [unit, setUnit] = useState<Unit>('mm')
  const [wmSpec, setWmSpec] = useState<WatermarkSpec>({ text: 'DRAFT', size: 72, color: [0.6, 0.6, 0.6], opacity: 0.3, angle: 45, font: 'Helvetica' })
  const [dragOver, setDragOver] = useState(false)
  const [name, setName] = useState('document')
  const sources = useRef<Record<string, Uint8Array>>({})
  const [assets, setAssets] = useState<Record<string, Asset>>({})
  const openInput = useRef<HTMLInputElement>(null)
  const addInput = useRef<HTMLInputElement>(null)
  const imgInput = useRef<HTMLInputElement>(null)
  const imgPagesInput = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const stage = useRef<HTMLDivElement>(null)

  const pages = state.doc.pages
  const index = pages.findIndex((p) => p.id === state.current)
  const page: PageRef | undefined = pages[index]
  const size = page ? displaySize(page.media, page.rotation) : { width: 612, height: 792 }
  const scale = useFitScale(stage, size) * zoom
  const pageMargins = page ? boxToMargins(page.media, page.rotation, page.crop) : null
  // The crop draft belongs to one page geometry; it lapses when the page, its crop or its rotation changes.
  const draftKey = page ? JSON.stringify([page.id, page.crop, page.rotation]) : ''
  const draft = draftState?.key === draftKey ? draftState.m : null
  const setDraft = useCallback((m: Margins | null) => setDraftState(m ? { key: draftKey, m } : null), [draftKey])
  const margins = draft ?? pageMargins
  const resolved = resolveScope(scope, pages, state.current, picked)
  const setScope = useCallback((s: Scope) => { if (s.mode !== 'selected') setPicked(new Set()); setScopeRaw(s) }, [])
  const clearPicked = useCallback(() => { setPicked(new Set()); setScopeRaw((s) => (s.mode === 'selected' ? { ...s, mode: 'current' } : s)) }, [])
  const onThumbSelect = useCallback((id: string, mods: { shiftKey: boolean; toggle: boolean }) => {
    dispatch({ type: 'select', id })
    if (mods.shiftKey && anchor.current) {
      const ids = pages.map((p) => p.id)
      const a = ids.indexOf(anchor.current)
      const b = ids.indexOf(id)
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        setPicked(new Set(ids.slice(lo, hi + 1)))
        setScopeRaw((s) => ({ ...s, mode: 'selected' }))
        return
      }
    }
    if (mods.toggle) {
      const next = new Set(picked)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      setPicked(next)
      setScopeRaw((s) => ({ ...s, mode: next.size ? 'selected' : 'current' }))
      anchor.current = id
      return
    }
    anchor.current = id
    clearPicked()
  }, [pages, picked, clearPicked])
  const annot = page?.annots.find((a) => a.id === selectedAnnot) ?? null

  const notify = useCallback((text: string, error = false) => {
    setToast({ text, error })
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), error ? 6000 : 3000)
  }, [])


  const assetUrls = useMemo(() => {
    const out: Record<string, string> = {}
    for (const [k, a] of Object.entries(assets)) out[k] = URL.createObjectURL(new Blob([a.bytes as BlobPart], { type: a.mime }))
    return out
  }, [assets])
  useEffect(() => () => Object.values(assetUrls).forEach((u) => URL.revokeObjectURL(u)), [assetUrls])

  const addFiles = useCallback(async (files: File[], replace: boolean) => {
    const pdfs = files.filter(isPdfFile)
    if (pdfs.length === 0) return notify('Choose a PDF file', true)
    setBusy(true)
    try {
      const loaded: PageRef[] = []
      for (const f of pdfs) {
        const bytes = await readBytes(f)
        const id = uid('src')
        const src = await loadSource(id, bytes)
        sources.current[id] = bytes
        openForRender(id, bytes)
        loaded.push(...src.pages)
      }
      if (replace) {
        // Drop the previous document's sources; keep only what was just opened.
        const keep = new Set(loaded.map((p) => p.src))
        closeAll()
        for (const id of Object.keys(sources.current)) if (!keep.has(id)) delete sources.current[id]
        for (const [id, b] of Object.entries(sources.current)) openForRender(id, b)
        setAssets({})
        setPicked(new Set())
        anchor.current = null
        dispatch({ type: 'reset' })
        setName(pdfs[0].name.replace(/\.pdf$/i, ''))
      }
      dispatch({ type: 'addPages', pages: loaded })
      notify(`${replace ? 'Opened' : 'Added'} ${loaded.length} page${loaded.length === 1 ? '' : 's'}`)
    } catch (e) {
      notify(e instanceof SourceError ? e.message : `Failed to open: ${e instanceof Error ? e.message : e}`, true)
    } finally {
      setBusy(false)
    }
  }, [notify])

  const build = useCallback(async (list: PageRef[], rasterized?: Record<string, Rasterized>) => buildPdf(list, sources.current, assets, rasterized), [assets])

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn() } catch (e) { notify(e instanceof Error ? e.message : String(e), true) } finally { setBusy(false) }
  }, [notify])

  const download = () => run(async () => {
    downloadBytes(await build(pages), `${name}-edited.pdf`)
    notify('Downloaded')
  })

  // ---- crop
  const applyCrop = () => {
    if (!margins || resolved.error) return
    dispatch({ type: 'crop', ids: resolved.ids, margins })
    notify(`Cropped ${resolved.ids.length} page${resolved.ids.length === 1 ? '' : 's'}`)
  }
  const autoTrim = () => run(async () => {
    const crops: Record<string, Box> = {}
    let blank = 0
    for (const id of resolved.ids) {
      const p = pages.find((x) => x.id === id)!
      const m = await autoTrimMargins(p)
      if (m) crops[id] = marginsToBox(p.media, p.rotation, m)
      else blank++
    }
    dispatch({ type: 'setCrops', crops })
    notify(`Trimmed ${Object.keys(crops).length} page(s)${blank ? `, skipped ${blank} blank` : ''}`)
  })

  // ---- watermark
  const applyWatermark = () => {
    if (resolved.error) return
    dispatch({ type: 'setWatermark', ids: resolved.ids, spec: { kind: 'watermark', ...wmSpec } })
    notify(`Watermarked ${resolved.ids.length} page${resolved.ids.length === 1 ? '' : 's'}`)
  }
  const removeWatermark = () => {
    if (resolved.error) return
    dispatch({ type: 'setWatermark', ids: resolved.ids, spec: null })
    notify(`Removed watermark from ${resolved.ids.length} page${resolved.ids.length === 1 ? '' : 's'}`)
  }

  // ---- pages
  const insertBlank = (where: 'before' | 'after', which: 'letter' | 'a4' | 'same') => {
    const sz = which === 'same' ? size : SIZES[which]
    dispatch({ type: 'insertBlank', index: Math.max(0, index) + (where === 'after' ? 1 : 0), size: sz })
  }
  const extract = () => run(async () => {
    if (resolved.error) return
    const set = new Set(resolved.ids)
    downloadBytes(await build(pages.filter((p) => set.has(p.id))), `${name}-extract.pdf`)
  })
  const split = (every: number) => run(async () => {
    const groups = chunk(pages, every)
    const files = []
    for (const [i, g] of groups.entries()) files.push({ name: `${name}-part${String(i + 1).padStart(3, '0')}.pdf`, bytes: await build(g) })
    downloadBytes(zipFiles(files), `${name}-split.zip`, 'application/zip')
    notify(`Split into ${groups.length} files`)
  })
  const exportImages = (dpi: number, format: 'png' | 'jpeg', quality: number) => run(async () => {
    if (resolved.error) return
    const mime = format === 'png' ? 'image/png' : 'image/jpeg'
    const ext = format === 'png' ? 'png' : 'jpg'
    const targets = resolved.ids.map((id) => pages.find((p) => p.id === id)!)
    const files = []
    for (const [i, p] of targets.entries()) {
      const bytes = await renderPageToImage(p, dpi / 72, mime, format === 'jpeg' ? quality : undefined)
      files.push({ name: `${name}-p${String(i + 1).padStart(3, '0')}.${ext}`, bytes })
    }
    if (files.length === 1) downloadBytes(files[0].bytes, files[0].name, mime)
    else downloadBytes(zipFiles(files), `${name}-images.zip`, 'application/zip')
    notify(`Exported ${files.length} image${files.length === 1 ? '' : 's'}`)
  })
  const fmtMB = (n: number) => `${(n / 1_000_000).toFixed(n < 1_000_000 ? 2 : 1)} MB`
  const compress = (quality: number, maxDim: number) => run(async () => {
    const built = await build(pages)
    const result = await compressImages(built, reencodeJpeg, { quality, maxDim })
    downloadBytes(result.bytes, `${name}-compressed.pdf`)
    const parts = [`${fmtMB(result.before)} → ${fmtMB(result.after)}`]
    if (result.recompressed) parts.push(`${result.recompressed} image${result.recompressed === 1 ? '' : 's'} recompressed`)
    if (result.skipped) parts.push(`${result.skipped} skipped`)
    notify(parts.join(' · '))
  })
  const redactCount = pages.reduce((n, p) => n + (p.annots.some((a) => a.kind === 'redact') ? 1 : 0), 0)
  const exportRedacted = () => run(async () => {
    const targets = pages.filter((p) => p.annots.some((a) => a.kind === 'redact'))
    if (targets.length === 0) return notify('Draw a Redact box first (Edit tab)', true)
    const rasterized: Record<string, Rasterized> = {}
    for (const p of targets) rasterized[p.id] = await rasterizePage(p, 300, assets)
    downloadBytes(await build(pages, rasterized), `${name}-redacted.pdf`)
    notify(`Downloaded a redacted copy — ${targets.length} page${targets.length === 1 ? '' : 's'} flattened to images`)
  })
  const addImagePages = (files: File[]) => run(async () => {
    const PX_TO_PT = 72 / 96 // treat images as 96 DPI unless the file says otherwise
    let at = index + 1 // insert after the current page, each new one after the last
    for (const f of files) {
      const { asset, width, height } = await imageToAsset(f)
      const key = uid('img')
      setAssets((a) => ({ ...a, [key]: asset }))
      dispatch({
        type: 'addImagePage',
        index: at++,
        size: { width: width * PX_TO_PT, height: height * PX_TO_PT },
        annot: { kind: 'image', asset: key },
      })
    }
    notify(`Added ${files.length} image page${files.length === 1 ? '' : 's'}`)
  })

  // ---- erase: pages whose content was replaced by an image with the marks filled in
  // ---- built-in (object) watermarks: found by scanning the open files whenever Erase is shown
  const srcKey = [...new Set(pages.filter((p) => !p.base).map((p) => p.src).filter((s): s is string => !!s))].join('|')
  const [builtIn, setBuiltIn] = useState<{ pages: number; key: string } | null>(null)
  useEffect(() => {
    if (mode !== 'erase' || !srcKey) return
    let stale = false
    ;(async () => {
      let n = 0
      for (const id of srcKey.split('|')) {
        const bytes = sources.current[id]
        if (!bytes) continue
        const r = await stripWatermarkObjects(bytes, { dryRun: true }).catch(() => null)
        if (r) n += r.pages.length
      }
      if (!stale) setBuiltIn(n ? { pages: n, key: srcKey } : null)
    })()
    return () => { stale = true }
  }, [mode, srcKey])

  const removeBuiltIn = () => run(async () => {
    let n = 0
    for (const id of srcKey.split('|')) {
      const bytes = sources.current[id]
      if (!bytes) continue
      const r = await stripWatermarkObjects(bytes)
      if (!r.found) continue
      const next = uid('src')
      sources.current[next] = r.bytes
      openForRender(next, r.bytes)
      dispatch({ type: 'replaceSource', from: id, to: next })
      n += r.pages.length
    }
    setBuiltIn(null)
    notify(n ? `Removed the built-in watermark from ${n} page${n === 1 ? '' : 's'}; nothing else on them changed` : 'No built-in watermark found', !n)
  })

  const commitErased = (items: Record<string, Erased>) => {
    const keys: Record<string, string> = {}
    const bases: Record<string, string | { asset: string; rect: Box }> = {}
    const added: Record<string, Asset> = {}
    for (const [id, { bytes, rect }] of Object.entries(items)) {
      const key = uid('erased')
      bases[id] = rect ? { asset: key, rect } : key
      const asset: Asset = { mime: 'image/png', bytes }
      registerBase(key, asset)
      keys[id] = key
      added[key] = asset
    }
    setAssets((a) => ({ ...a, ...added }))
    dispatch({ type: 'setBases', items: bases })
    return keys
  }

  // ---- edit
  const addAnnot = (a: Annot) => {
    if (!page) return
    dispatch({ type: 'addAnnot', pageId: page.id, annot: a })
    setSelectedAnnot(a.id)
    setTool('select')
  }
  const createAt = (t: Tool, d: Box) => {
    if (!page) return
    const base = { id: uid('an'), rect: rectFromDisplay(page.media, page.rotation, d), rotate: page.rotation }
    if (t === 'text') {
      addAnnot({ ...base, kind: 'text', text: '', size: 14, color: [0, 0, 0], font: 'Helvetica' })
      setTimeout(() => textRef.current?.focus(), 0)
    } else if (t === 'whiteout') addAnnot({ ...base, kind: 'rect', fill: [1, 1, 1], stroke: null, opacity: 1 })
    else if (t === 'highlight') addAnnot({ ...base, kind: 'rect', fill: [1, 0.92, 0.2], stroke: null, opacity: 0.4 })
    else if (t === 'rect') addAnnot({ ...base, kind: 'rect', fill: null, stroke: [0.85, 0.1, 0.1], opacity: 1 })
    else if (t === 'redact') addAnnot({ ...base, kind: 'redact', fill: [1, 1, 1], stroke: null, opacity: 1 })
  }
  const placeImage = (asset: Asset, w: number, h: number) => {
    if (!page) return
    const key = uid('img')
    setAssets((a) => ({ ...a, [key]: asset }))
    const width = Math.min(size.width * 0.4, w)
    const height = (width * h) / w
    const d = { x: (size.width - width) / 2, y: (size.height - height) / 2, width, height }
    addAnnot({ id: uid('an'), kind: 'image', rect: rectFromDisplay(page.media, page.rotation, d), rotate: page.rotation, asset: key })
    setMode('edit')
  }
  const addImageFile = (f: File | undefined) => f && run(async () => {
    const r = await imageToAsset(f)
    placeImage(r.asset, r.width, r.height)
  })
  const patchAnnot = (patch: AnnotPatch) => page && annot && dispatch({ type: 'updateAnnot', pageId: page.id, id: annot.id, patch })
  const deleteAnnot = () => {
    if (!page || !annot) return
    dispatch({ type: 'removeAnnot', pageId: page.id, id: annot.id })
    setSelectedAnnot(null)
  }

  // ---- keyboard + drag/drop
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (view === 'image') return // the image tool has its own shortcuts
      const typing = e.target instanceof HTMLElement && e.target.matches('input, textarea, select, [contenteditable]')
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); dispatch({ type: e.shiftKey ? 'redo' : 'undo' }) }
      else if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); dispatch({ type: 'redo' }) }
      else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (pages.length) download() }
      else if (typing) return
      else if ((e.key === 'Delete' || e.key === 'Backspace') && annot) { e.preventDefault(); deleteAnnot() }
      else if (e.key === 'Escape') { setSelectedAnnot(null); setTool('select'); clearPicked() }
      else if ((e.key === 'PageDown' || e.key === 'j') && pages[index + 1]) dispatch({ type: 'select', id: pages[index + 1].id })
      else if ((e.key === 'PageUp' || e.key === 'k') && pages[index - 1]) dispatch({ type: 'select', id: pages[index - 1].id })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    if (view === 'image') return // the image tool handles its own drops
    const files = [...e.dataTransfer.files]
    if (files.some(isPdfFile)) addFiles(files, pages.length === 0)
    else if (files.length && isImageFile(files[0]) && page) addImageFile(files[0])
  }

  const dirty = !!(draft && pageMargins && !sameMargins(draft, pageMargins))

  const modeIcon = { crop: 'crop', pages: 'pages', watermark: 'watermark', edit: 'edit', erase: 'whiteout' } as const

  return (
    <div
      className="app"
      onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true) }}
      onDragLeave={(e) => { if (!e.relatedTarget) setDragOver(false) }}
      onDrop={(e) => { setDragOver(false); onDrop(e) }}
    >
      <header className="topbar">
        <div className="brand">
          <Logo />
          <span className="wordmark">PDF <em>Studio</em></span>
          <div className="seg small light view-switch" role="tablist" aria-label="Tool">
            <button role="tab" aria-selected={view === 'pdf'} className={view === 'pdf' ? 'on' : ''} onClick={() => setView('pdf')}>PDF</button>
            <button role="tab" aria-selected={view === 'image'} className={view === 'image' ? 'on' : ''} onClick={() => setView('image')}>Image eraser</button>
          </div>
          {view === 'pdf' && page && (
            <button className="file-chip" onClick={() => openInput.current?.click()} disabled={busy} title="Open a different PDF">
              {name}.pdf · {pages.length} page{pages.length === 1 ? '' : 's'}
            </button>
          )}
        </div>
        {view === 'pdf' && page ? (
          <div className="seg modes" role="tablist" aria-label="Mode">
            {(['crop', 'pages', 'watermark', 'edit', 'erase'] as const).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
                <Icon name={modeIcon[m]} size={16} />
                {m[0].toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        ) : <span className="modes-spacer" />}
        <div className="top-actions">
          {view === 'image' ? (
            <span className="privacy"><Icon name="lock" size={16} /><span className="privacy-text">Runs in your browser · nothing uploaded</span></span>
          ) : page ? (
            <>
              <button className="btn icon" onClick={() => dispatch({ type: 'undo' })} disabled={!state.past.length} title="Undo (⌘Z)" aria-label="Undo"><Icon name="undo" /></button>
              <button className="btn icon" onClick={() => dispatch({ type: 'redo' })} disabled={!state.future.length} title="Redo (⇧⌘Z)" aria-label="Redo"><Icon name="redo" /></button>
              <button className="btn primary" onClick={download} disabled={busy} title="Download (⌘S)" aria-label="Download">
                <Icon name="download" stroke={2.2} /><span className="btn-label">Download</span>
              </button>
            </>
          ) : (
            <span className="privacy"><Icon name="lock" size={16} /><span className="privacy-text">Runs in your browser · nothing uploaded</span></span>
          )}
        </div>
        <input ref={openInput} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { addFiles([...(e.target.files ?? [])], true); e.target.value = '' }} />
        <input ref={addInput} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { addFiles([...(e.target.files ?? [])], false); e.target.value = '' }} />
        <input ref={imgInput} type="file" accept="image/*" hidden onChange={(e) => { addImageFile(e.target.files?.[0]); e.target.value = '' }} />
        <input ref={imgPagesInput} type="file" accept="image/*" multiple hidden onChange={(e) => { addImagePages([...(e.target.files ?? [])]); e.target.value = '' }} />
      </header>

      {view === 'image' ? (
        <ImageEraser onNotify={notify} />
      ) : !page ? (
        <main className="empty mat">
          <div className="hero">
            <h1>Crop, trim <em>&amp;</em> sign your PDFs.</h1>
            <p>Everything the paid sites do. Free, private, offline.</p>
          </div>
          <button className={`dropzone ${dragOver ? 'over' : ''}`} onClick={() => openInput.current?.click()} disabled={busy}>
            <span className="corner c-nw" /><span className="corner c-ne" /><span className="corner c-sw" /><span className="corner c-se" />
            <Icon name="upload" size={44} stroke={1.6} />
            <strong>{busy ? 'Opening…' : 'Drop a PDF here'}</strong>
            <span className="btn primary big">Choose file</span>
          </button>
          <div className="features">
            <div className="feature"><Icon name="crop" size={22} stroke={1.9} /><strong>Crop &amp; trim</strong><span>Visual frame, exact margins, auto-trim white space.</span></div>
            <div className="feature"><Icon name="pages" size={22} stroke={1.9} /><strong>Organize pages</strong><span>Reorder, rotate, merge, split and extract.</span></div>
            <div className="feature"><Icon name="edit" size={22} stroke={1.9} /><strong>Edit &amp; sign</strong><span>Text, white-out, highlights, images, signatures.</span></div>
          </div>
        </main>
      ) : (
        <div className="workspace">
          <aside className="rail" aria-label="Pages">
            <span className="eyebrow">Pages</span>
            <ThumbRail pages={pages} current={state.current} picked={picked} onSelect={onThumbSelect} onMove={(from, to) => dispatch({ type: 'move', from, to })} />
          </aside>
          {mode === 'erase' ? (
            <PageEraser
              page={page} pages={pages} assets={assets}
              scope={scope} onScope={setScope} scopeIds={resolved.ids} scopeError={resolved.error} selectedCount={picked.size}
              canUndo={state.past.length > 0} onUndo={() => dispatch({ type: 'undo' })}
              onCommit={commitErased} onNotify={notify}
              builtIn={builtIn && builtIn.key === srcKey ? builtIn : null} onRemoveBuiltIn={removeBuiltIn}
            />
          ) : (
            <>
            <div className="stage-wrap mat">
              <span className="ruler corner" />
              <span className="ruler h" />
              <span className="ruler v" />
              <main className="stage" ref={stage}>
                <div className="page-wrap" style={{ width: size.width * scale, height: size.height * scale }}>
                  <PageCanvas page={page} scale={scale} />
                  {mode === 'crop' && margins && <CropOverlay size={size} scale={scale} margins={margins} unit={unit} onChange={setDraft} />}
                  {mode !== 'crop' && <div className="shade-clip"><div className="crop-shade" style={cropShadeStyle(page, scale)} /></div>}
                  {mode === 'edit' && (
                    <AnnotLayer
                      page={page} scale={scale} tool={tool} selected={selectedAnnot} assetUrls={assetUrls}
                      onSelect={setSelectedAnnot} onCreate={createAt}
                      onMove={(id, rect) => dispatch({ type: 'updateAnnot', pageId: page.id, id, patch: { rect } })}
                      onEditText={(id) => { setSelectedAnnot(id); setTimeout(() => textRef.current?.focus(), 0) }}
                    />
                  )}
                  {mode !== 'edit' && page.annots.length > 0 && (
                    <AnnotLayer page={page} scale={scale} tool="select" selected={null} assetUrls={assetUrls} onSelect={() => {}} onCreate={() => {}} onMove={() => {}} onEditText={() => {}} />
                  )}
                </div>
              </main>
              <div className="zoom">
                <button onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))} aria-label="Zoom out">−</button>
                <button className="pct" onClick={() => setZoom(1)} title="Fit page">{Math.round(zoom * 100)}%</button>
                <button onClick={() => setZoom((z) => Math.min(6, z * 1.25))} aria-label="Zoom in">+</button>
                <span className="divider" />
                <span className="pageno">{String(index + 1).padStart(2, '0')} / {String(pages.length).padStart(2, '0')}</span>
              </div>
            </div>
            <aside className="side">
              {mode === 'crop' && margins && (
                <CropPanel
                  margins={margins} onMargins={setDraft} unit={unit} onUnit={setUnit} scopeCount={resolved.ids.length} scope={scope} onScope={setScope} scopeError={resolved.error} selectedCount={picked.size}
                  dirty={dirty} busy={busy} onApply={applyCrop} onAutoTrim={autoTrim} onRevertDraft={() => setDraft(null)}
                  onReset={() => { if (!resolved.error) { dispatch({ type: 'resetCrop', ids: resolved.ids }); setDraft(null) } }}
                />
              )}
              {mode === 'pages' && (
                <PagesPanel
                  scope={scope} onScope={setScope} scopeError={resolved.error} scopeCount={resolved.ids.length} selectedCount={picked.size} busy={busy}
                  onRotate={(delta) => !resolved.error && dispatch({ type: 'rotate', ids: resolved.ids, delta })}
                  onDelete={() => {
                    if (resolved.error) return
                    if (resolved.ids.length >= pages.length) return notify('Can’t delete every page', true)
                    dispatch({ type: 'delete', ids: resolved.ids })
                  }}
                  onDuplicate={() => !resolved.error && dispatch({ type: 'duplicate', ids: resolved.ids })}
                  onBlank={insertBlank} onExtract={extract} onSplit={split} onAddPdf={() => addInput.current?.click()}
                  onAddImages={() => imgPagesInput.current?.click()} onExportImages={exportImages} onCompress={compress}
                  redactCount={redactCount} onExportRedacted={exportRedacted}
                />
              )}
              {mode === 'watermark' && (
                <WatermarkPanel
                  spec={wmSpec} onSpec={setWmSpec} scope={scope} onScope={setScope} scopeError={resolved.error}
                  scopeCount={resolved.ids.length} selectedCount={picked.size} busy={busy} onApply={applyWatermark} onRemove={removeWatermark}
                />
              )}
              {mode === 'edit' && (
                <EditPanel
                  tool={tool} onTool={setTool} selected={annot} onPatch={patchAnnot} onDelete={deleteAnnot}
                  onImage={() => imgInput.current?.click()} onSignature={() => setShowSig(true)} textRef={textRef}
                />
              )}
            </aside>
            </>
          )}
        </div>
      )}

      {showSig && <SignatureModal onClose={() => setShowSig(false)} onDone={(r) => { setShowSig(false); placeImage(r.asset, r.width / 4, r.height / 4) }} />}
      {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role="status">{!toast.error && <Icon name="check" size={16} stroke={2.4} />}{toast.text}</div>}
    </div>
  )
}

/** Outside-crop shading outside crop mode, so the page shows what the download will show. */
function cropShadeStyle(page: PageRef, scale: number): CSSProperties {
  const m = boxToMargins(page.media, page.rotation, page.crop)
  const size = displaySize(page.media, page.rotation)
  return {
    left: m.left * scale,
    top: m.top * scale,
    width: (size.width - m.left - m.right) * scale,
    height: (size.height - m.top - m.bottom) * scale,
  }
}
