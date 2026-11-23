import { useEffect, useRef, useState } from 'react'
import { maskBounds, workingScale } from '../core/aiInpaint'
import { dilateMask } from '../core/inpaint'
import { resampleMask } from '../core/maskResample'
import type { Asset, PageRef } from '../core/model'
import type { Scope } from '../core/scope'
import { fill } from '../render/fill'
import { canvasToPngBytes, rasterizeFull, unrotateCanvas } from '../render/pdfjs'
import { EraserStage, EraseSettings } from './EraserParts'
import { Icon } from './icons'
import { ScopePicker } from './ScopePicker'
import { useEraser } from './useEraser'

const defaultBrush = (w: number, h: number) => Math.max(8, Math.round(Math.min(w, h) / 40))

interface Props {
  page: PageRef
  pages: PageRef[]
  assets: Record<string, Asset>
  scope: Scope
  onScope: (s: Scope) => void
  scopeIds: string[]
  scopeError?: string
  selectedCount: number
  canUndo: boolean
  onUndo: () => void
  /** Store erased page images (PNG, unrotated MediaBox). Returns each page's new asset key. */
  onCommit: (items: Record<string, Uint8Array>) => Record<string, string>
  onNotify: (text: string, error?: boolean) => void
}

/** Erase marks on PDF pages: the page becomes a picture with the marked area filled in. */
export function PageEraser({ page, pages, assets, scope, onScope, scopeIds, scopeError, selectedCount, canUndo, onUndo, onCommit, onNotify }: Props) {
  const [ready, setReady] = useState<string | null>(null) // page key the canvas currently shows
  const [batch, setBatch] = useState<string | null>(null)
  const committed = useRef<string | null>(null) // asset key of our own latest commit (no reload needed for it)
  const pageRef = useRef(page)
  pageRef.current = page

  const e = useEraser({
    onNotify,
    keys: false, // ⌘Z is the document's undo here
    onFilled: async (canvas) => {
      const p = pageRef.current
      const bytes = await canvasToPngBytes(unrotateCanvas(canvas, p.rotation))
      const keys = onCommit({ [p.id]: bytes })
      committed.current = keys[p.id]
    },
  })
  const { load } = e

  const key = `${page.id}|${page.base?.asset ?? ''}|${page.rotation}|${page.media.width}x${page.media.height}`
  useEffect(() => {
    if (page.base && page.base.asset === committed.current) { setReady(key); return }
    let stale = false
    ;(async () => {
      try {
        const canvas = await rasterizeFull(page, workingScale(page.media), assets)
        if (stale) return
        load({ w: canvas.width, h: canvas.height, draw: (ctx) => ctx.drawImage(canvas, 0, 0) }, defaultBrush(canvas.width, canvas.height))
        setReady(key)
      } catch (err) {
        if (!stale) onNotify(`Could not prepare the page: ${err instanceof Error ? err.message : err}`, true)
      }
    })()
    return () => { stale = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures the page inputs; assets only matter for annotation images
  }, [key, load])

  const many = scopeIds.length > 1 || (scopeIds.length === 1 && scopeIds[0] !== page.id)

  /** The same marks on several pages: each is rendered, filled and stored; one undo step in total. */
  const eraseMany = () => {
    const marks = e.marksMask()
    if (!marks) return onNotify('Paint over the mark first', true)
    e.setBusy(true)
    setTimeout(async () => {
      try {
        const out: Record<string, Uint8Array> = {}
        let fellBack: string | null = null
        for (const [i, id] of scopeIds.entries()) {
          setBatch(`Page ${i + 1} of ${scopeIds.length}…`)
          const p = pages.find((x) => x.id === id)!
          const canvas = await rasterizeFull(p, workingScale(p.media), assets)
          const mask = dilateMask(resampleMask(marks.mask, marks.w, marks.h, canvas.width, canvas.height), canvas.width, canvas.height, 2)
          const bounds = maskBounds(mask, canvas.width, canvas.height)
          if (!bounds) continue
          const ctx = canvas.getContext('2d')!
          const r = await fill(e.mode, ctx, canvas.width, canvas.height, mask, bounds, Math.round(e.brush * (canvas.width / marks.w)), (label, done, total) => e.setAi({ label, done, total }))
          e.setAi(null)
          if (r.failed && !fellBack) fellBack = r.message
          out[id] = await canvasToPngBytes(unrotateCanvas(canvas, p.rotation))
        }
        const n = Object.keys(out).length
        if (n === 0) return onNotify('Nothing to erase on those pages', true)
        onCommit(out)
        e.clearMarks()
        onNotify(fellBack ?? `Erased the marks on ${n} page${n === 1 ? '' : 's'}`, !!fellBack)
      } catch (err) {
        e.setAi(null)
        onNotify(err instanceof Error ? err.message : String(err), true)
      } finally {
        setBatch(null)
        e.setBusy(false)
      }
    }, 20)
  }

  const { dirty, busy, ai, mode } = e
  const loading = ready !== key
  const label = busy
    ? (batch ?? (ai ? 'Downloading…' : mode === 'ai' ? 'Filling with AI…' : 'Filling…'))
    : many ? `Erase marked area on ${scopeIds.length} pages` : 'Erase marked area'

  return (
    <>
      <EraserStage eraser={e} footer={<span className="pageno">{loading ? 'Preparing page…' : `${e.source?.w ?? 0} × ${e.source?.h ?? 0} px`}</span>} />
      <aside className="side">
        <div className="panel">
          <div className="panel-head">
            <h2>Erase on page</h2>
            <p className="hint">Paint over the watermark or mark, then press Erase. Use ⌘Z to step back.</p>
          </div>
          <EraseSettings eraser={e} maxBrush={Math.max(60, Math.round(Math.max(e.source?.w ?? 0, e.source?.h ?? 0) / 8))} />
          <ScopePicker scope={scope} onChange={onScope} error={scopeError} selectedCount={selectedCount} label="Erase the same marks on" />
          <div className="group">
            <button className="btn primary big" disabled={!dirty || busy || loading || !!scopeError} onClick={many ? eraseMany : e.erase}>
              <Icon name="check" stroke={2.2} />{label}
            </button>
            <div className="grid2">
              <button className="btn" disabled={!dirty || busy} onClick={e.clearMarks}><Icon name="close" size={16} />Clear marks</button>
              <button className="btn" disabled={!canUndo || busy} onClick={onUndo}><Icon name="undo" size={16} />Undo</button>
            </div>
          </div>
          <div className="note">
            <Icon name="info" size={20} />
            <p>
              Erasing turns a page into a picture of itself with the marked area filled in, and what was under the marks is gone from the
              downloaded PDF. Text on that page can no longer be selected, and its text boxes and stamps are flattened in.
              Pages you don’t erase stay untouched. Use it on files you own or may edit.
            </p>
          </div>
          {page.base && (
            <div className="note"><Icon name="info" size={20} /><p>This page has been erased before, so it’s already a picture.</p></div>
          )}
        </div>
      </aside>
    </>
  )
}
