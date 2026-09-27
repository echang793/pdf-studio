import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { boxToMargins, displaySize, marginsToBox, rectFromDisplay, type Box, type Margins } from './core/geometry'
import { uid, type Annot, type AnnotPatch, type Asset, type PageRef } from './core/model'
import { buildPdf, loadSource, SourceError } from './core/pdf'
import { resolveScope, type Scope } from './core/scope'
import { chunk, zipFiles } from './core/split'
import { autoTrimMargins, closeAll, openForRender } from './render/pdfjs'
import { initialState, reducer } from './state/store'
import { AnnotLayer } from './ui/AnnotLayer'
import { CropOverlay } from './ui/CropOverlay'
import { CropPanel } from './ui/CropPanel'
import { EditPanel } from './ui/EditPanel'
import { downloadBytes, imageToAsset, isImageFile, isPdfFile, readBytes } from './ui/files'
import { PageCanvas } from './ui/PageCanvas'
import { PagesPanel } from './ui/PagesPanel'
import { SignatureModal } from './ui/SignatureModal'
import { ThumbRail } from './ui/ThumbRail'
import type { Tool } from './ui/tools'
import { useFitScale } from './ui/useFitScale'

type Mode = 'crop' | 'pages' | 'edit'
const SIZES = { letter: { width: 612, height: 792 }, a4: { width: 595.28, height: 841.89 } }
const sameMargins = (a: Margins, b: Margins) => (['top', 'right', 'bottom', 'left'] as const).every((k) => Math.abs(a[k] - b[k]) < 0.05)

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [mode, setMode] = useState<Mode>('crop')
  const [tool, setTool] = useState<Tool>('select')
  const [scope, setScope] = useState<Scope>({ mode: 'current', range: '' })
  const [draftState, setDraftState] = useState<{ key: string; m: Margins } | null>(null)
  const [selectedAnnot, setSelectedAnnot] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null)
  const [showSig, setShowSig] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [name, setName] = useState('document')
  const sources = useRef<Record<string, Uint8Array>>({})
  const [assets, setAssets] = useState<Record<string, Asset>>({})
  const openInput = useRef<HTMLInputElement>(null)
  const addInput = useRef<HTMLInputElement>(null)
  const imgInput = useRef<HTMLInputElement>(null)
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
  const resolved = resolveScope(scope, pages, state.current)
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

  const build = useCallback(async (list: PageRef[]) => buildPdf(list, sources.current, assets), [assets])

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
      const typing = e.target instanceof HTMLElement && e.target.matches('input, textarea, select, [contenteditable]')
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); dispatch({ type: e.shiftKey ? 'redo' : 'undo' }) }
      else if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); dispatch({ type: 'redo' }) }
      else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (pages.length) download() }
      else if (typing) return
      else if ((e.key === 'Delete' || e.key === 'Backspace') && annot) { e.preventDefault(); deleteAnnot() }
      else if (e.key === 'Escape') { setSelectedAnnot(null); setTool('select') }
      else if ((e.key === 'PageDown' || e.key === 'j') && pages[index + 1]) dispatch({ type: 'select', id: pages[index + 1].id })
      else if ((e.key === 'PageUp' || e.key === 'k') && pages[index - 1]) dispatch({ type: 'select', id: pages[index - 1].id })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    const files = [...e.dataTransfer.files]
    if (files.some(isPdfFile)) addFiles(files, pages.length === 0)
    else if (files.length && isImageFile(files[0]) && page) addImageFile(files[0])
  }

  const dirty = !!(draft && pageMargins && !sameMargins(draft, pageMargins))

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header className="topbar">
        <strong className="brand">PDF Studio</strong>
        <button onClick={() => openInput.current?.click()} disabled={busy}>Open PDF</button>
        <div className="seg modes" role="tablist">
          {(['crop', 'pages', 'edit'] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} disabled={!page} onClick={() => setMode(m)}>
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button onClick={() => dispatch({ type: 'undo' })} disabled={!state.past.length} title="Undo (⌘Z)">↶</button>
        <button onClick={() => dispatch({ type: 'redo' })} disabled={!state.future.length} title="Redo (⇧⌘Z)">↷</button>
        <button className="primary" onClick={download} disabled={!pages.length || busy} title="Download (⌘S)">Download</button>
        <input ref={openInput} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { addFiles([...(e.target.files ?? [])], true); e.target.value = '' }} />
        <input ref={addInput} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { addFiles([...(e.target.files ?? [])], false); e.target.value = '' }} />
        <input ref={imgInput} type="file" accept="image/*" hidden onChange={(e) => { addImageFile(e.target.files?.[0]); e.target.value = '' }} />
      </header>

      {!page ? (
        <main className="empty" onClick={() => openInput.current?.click()}>
          <div>
            <h1>Drop a PDF here</h1>
            <p>or click to choose one. Crop, trim, reorder, rotate, merge, split, add text, images and signatures.</p>
            <p className="hint">Everything happens in your browser. Files are never uploaded.</p>
          </div>
        </main>
      ) : (
        <div className="workspace">
          <aside className="rail">
            <ThumbRail pages={pages} current={state.current} onSelect={(id) => dispatch({ type: 'select', id })} onMove={(from, to) => dispatch({ type: 'move', from, to })} />
          </aside>
          <main className="stage" ref={stage}>
            <div className="page-wrap" style={{ width: size.width * scale, height: size.height * scale }}>
              <PageCanvas page={page} scale={scale} />
              {mode === 'crop' && margins && <CropOverlay size={size} scale={scale} margins={margins} onChange={setDraft} />}
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
            <div className="zoom">
              <button onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))} aria-label="Zoom out">−</button>
              <button onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
              <button onClick={() => setZoom((z) => Math.min(6, z * 1.25))} aria-label="Zoom in">+</button>
              <span className="pageno">{index + 1} / {pages.length}</span>
            </div>
          </main>
          <aside className="side">
            {mode === 'crop' && margins && (
              <CropPanel
                margins={margins} onMargins={setDraft} scope={scope} onScope={setScope} scopeError={resolved.error}
                dirty={dirty} busy={busy} onApply={applyCrop} onAutoTrim={autoTrim} onRevertDraft={() => setDraft(null)}
                onReset={() => { if (!resolved.error) { dispatch({ type: 'resetCrop', ids: resolved.ids }); setDraft(null) } }}
              />
            )}
            {mode === 'pages' && (
              <PagesPanel
                scope={scope} onScope={setScope} scopeError={resolved.error} busy={busy}
                onRotate={(delta) => !resolved.error && dispatch({ type: 'rotate', ids: resolved.ids, delta })}
                onDelete={() => {
                  if (resolved.error) return
                  if (resolved.ids.length >= pages.length) return notify('Can’t delete every page', true)
                  dispatch({ type: 'delete', ids: resolved.ids })
                }}
                onDuplicate={() => !resolved.error && dispatch({ type: 'duplicate', ids: resolved.ids })}
                onBlank={insertBlank} onExtract={extract} onSplit={split} onAddPdf={() => addInput.current?.click()}
              />
            )}
            {mode === 'edit' && (
              <EditPanel
                tool={tool} onTool={setTool} selected={annot} onPatch={patchAnnot} onDelete={deleteAnnot}
                onImage={() => imgInput.current?.click()} onSignature={() => setShowSig(true)} textRef={textRef}
              />
            )}
          </aside>
        </div>
      )}

      {showSig && <SignatureModal onClose={() => setShowSig(false)} onDone={(r) => { setShowSig(false); placeImage(r.asset, r.width / 4, r.height / 4) }} />}
      {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role="status">{toast.text}</div>}
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
