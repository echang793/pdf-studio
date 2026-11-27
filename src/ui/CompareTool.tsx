import { useEffect, useRef, useState, type DragEvent } from 'react'
import { diffBoxes, diffWords, type PxBox, type WordOp } from '../core/compare'
import { uid, type PageRef } from '../core/model'
import { loadSource, SourceError } from '../core/pdf'
import { closeDoc, openForRender, pageWords, rasterizeFull } from '../render/pdfjs'
import { isPdfFile, readBytes } from './files'
import { Icon } from './icons'

interface Doc { id: string; name: string; bytes: Uint8Array; pages: PageRef[] }
interface PageResult { onlyIn?: 'A' | 'B'; boxes: PxBox[]; w: number; h: number; words: WordOp[]; added: number; removed: number }

const SCALE = 1.5 // px per point for comparing and showing

async function raster(ref: PageRef, doc: Doc, w?: number, h?: number): Promise<HTMLCanvasElement> {
  openForRender(doc.id, doc.bytes) // re-opened if the PDF tab closed everything
  const c = await rasterizeFull(ref, SCALE, {})
  if (!w || !h || (c.width === w && c.height === h)) return c
  const fit = document.createElement('canvas') // B at A's size so the pixels line up
  fit.width = w
  fit.height = h
  fit.getContext('2d')!.drawImage(c, 0, 0, w, h)
  return fit
}

async function analyse(a: Doc, b: Doc, i: number): Promise<PageResult> {
  const pa = a.pages[i], pb = b.pages[i]
  if (!pa || !pb) return { onlyIn: pa ? 'A' : 'B', boxes: [], w: 0, h: 0, words: [], added: 0, removed: 0 }
  const ca = await raster(pa, a)
  const cb = await raster(pb, b, ca.width, ca.height)
  const da = ca.getContext('2d')!.getImageData(0, 0, ca.width, ca.height).data
  const db = cb.getContext('2d')!.getImageData(0, 0, ca.width, ca.height).data
  const [wa, wb] = await Promise.all([pageWords(pa), pageWords(pb)])
  const words = diffWords(wa, wb)
  const n = (op: WordOp['op']) => words.filter((w) => w.op === op).reduce((s, w) => s + w.text.split(' ').length, 0)
  return { boxes: diffBoxes(da, db, ca.width, ca.height), w: ca.width, h: ca.height, words, added: n('add'), removed: n('del') }
}

function Drop({ label, doc, onFile }: { label: string; doc: Doc | null; onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const drop = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setOver(false); const f = [...e.dataTransfer.files].find(isPdfFile); if (f) onFile(f) }
  return (
    <button className={`dropzone ${over ? 'over' : ''}`} onClick={() => input.current?.click()} onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={drop}>
      <span className="corner c-nw" /><span className="corner c-ne" /><span className="corner c-sw" /><span className="corner c-se" />
      <Icon name="upload" size={36} stroke={1.6} />
      <strong>{label}</strong>
      <span>{doc ? `${doc.name} · ${doc.pages.length} page${doc.pages.length === 1 ? '' : 's'}` : 'Drop a PDF or click'}</span>
      <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
    </button>
  )
}

/** Compare two PDFs page by page: what moved or changed (boxed) and which words were added or removed. */
export function CompareTool({ onNotify }: { onNotify: (text: string, error?: boolean) => void }) {
  const [a, setA] = useState<Doc | null>(null)
  const [b, setB] = useState<Doc | null>(null)
  const [results, setResults] = useState<(PageResult | null)[]>([])
  const [at, setAt] = useState(0)
  const canvA = useRef<HTMLCanvasElement>(null)
  const canvB = useRef<HTMLCanvasElement>(null)

  const load = async (f: File, side: 'A' | 'B') => {
    try {
      const bytes = await readBytes(f)
      const id = uid('cmp')
      const src = await loadSource(id, bytes)
      openForRender(id, bytes)
      const doc: Doc = { id, name: f.name, bytes, pages: src.pages }
      const set = side === 'A' ? setA : setB
      set((old) => { if (old) closeDoc(old.id); return doc })
      setResults([])
      setAt(0)
    } catch (e) {
      onNotify(e instanceof SourceError ? e.message : `Could not open ${f.name}`, true)
    }
  }

  // Analyse every page pair in the background once both files are in.
  useEffect(() => {
    if (!a || !b) return
    let stale = false
    const n = Math.max(a.pages.length, b.pages.length)
    ;(async () => {
      for (let i = 0; i < n && !stale; i++) {
        const r = await analyse(a, b, i).catch(() => null)
        if (!stale) setResults((rs) => { const next = [...rs]; next[i] = r; return next })
      }
    })()
    return () => { stale = true }
  }, [a, b])

  // Draw the current pair with the changed areas boxed.
  useEffect(() => {
    if (!a || !b) return
    let stale = false
    ;(async () => {
      const pa = a.pages[at], pb = b.pages[at]
      const ca = pa ? await raster(pa, a) : null
      const cb = pb ? await raster(pb, b, ca?.width, ca?.height) : null
      if (stale) return
      const r = results[at]
      for (const [target, src] of [[canvA.current, ca], [canvB.current, cb]] as const) {
        if (!target) continue
        if (!src) { target.width = 1; target.height = 1; continue }
        target.width = src.width
        target.height = src.height
        const ctx = target.getContext('2d')!
        ctx.drawImage(src, 0, 0)
        ctx.lineWidth = 3
        ctx.strokeStyle = 'rgba(229, 72, 77, 0.95)'
        ctx.fillStyle = 'rgba(229, 72, 77, 0.10)'
        for (const bx of r?.boxes ?? []) { ctx.fillRect(bx.x - 3, bx.y - 3, bx.w + 6, bx.h + 6); ctx.strokeRect(bx.x - 3, bx.y - 3, bx.w + 6, bx.h + 6) }
      }
    })()
    return () => { stale = true }
  }, [a, b, at, results])

  useEffect(() => () => { if (a) closeDoc(a.id) }, [a])
  useEffect(() => () => { if (b) closeDoc(b.id) }, [b])

  if (!a || !b) {
    return (
      <main className="empty mat">
        <div className="hero">
          <h1>Compare two <em>versions</em>.</h1>
          <p>See which pages changed, what moved, and which words were added or removed. Nothing is uploaded.</p>
        </div>
        <div className="compare-drops">
          <Drop label="Original" doc={a} onFile={(f) => load(f, 'A')} />
          <Drop label="Changed version" doc={b} onFile={(f) => load(f, 'B')} />
        </div>
      </main>
    )
  }

  const n = Math.max(a.pages.length, b.pages.length)
  const all = Array.from({ length: n }, (_, i) => results[i] ?? null)
  const done = all.filter(Boolean).length
  const r = all[at]
  const changed = all.filter((x) => x && (x.onlyIn || x.boxes.length || x.added || x.removed)).length
  const status = (x: PageResult | null) => !x ? '…' : x.onlyIn ? `only in ${x.onlyIn === 'A' ? 'original' : 'changed'}` : x.boxes.length || x.added || x.removed ? `${x.boxes.length} area${x.boxes.length === 1 ? '' : 's'}${x.added || x.removed ? ` · +${x.added} −${x.removed}` : ''}` : 'same'

  return (
    <div className="workspace compare">
      <aside className="rail">
        <p className="eyebrow" style={{ padding: '12px 16px 0' }}>{done < n ? `Comparing ${done} / ${n}…` : `${changed} of ${n} page${n === 1 ? '' : 's'} differ`}</p>
        <ol className="compare-list">
          {all.map((x, i) => (
            <li key={i}>
              <button className={`${i === at ? 'on' : ''} ${x && (x.onlyIn || x.boxes.length || x.added || x.removed) ? 'diff' : ''}`} onClick={() => setAt(i)}>
                <span>Page {i + 1}</span><small>{status(x)}</small>
              </button>
            </li>
          ))}
        </ol>
        <div style={{ padding: 16, display: 'grid', gap: 8 }}>
          <button className="btn ghost" onClick={() => { closeDoc(a.id); closeDoc(b.id); setA(null); setB(null); setResults([]); setAt(0) }}>Compare other files</button>
        </div>
      </aside>
      <div className="stage-wrap mat compare-stage">
        <div className="compare-pair">
          <figure><figcaption>Original · {a.name}</figcaption>{a.pages[at] ? <canvas ref={canvA} /> : <div className="compare-missing">No page {at + 1}</div>}</figure>
          <figure><figcaption>Changed · {b.name}</figcaption>{b.pages[at] ? <canvas ref={canvB} /> : <div className="compare-missing">No page {at + 1}</div>}</figure>
        </div>
        <div className="zoom">
          <button onClick={() => setAt(Math.max(0, at - 1))} disabled={at === 0} aria-label="Previous page">‹</button>
          <span className="pageno">{at + 1} / {n}</span>
          <button onClick={() => setAt(Math.min(n - 1, at + 1))} disabled={at >= n - 1} aria-label="Next page">›</button>
        </div>
      </div>
      <aside className="side">
        <div className="panel">
          <div className="panel-head">
            <h2>Page {at + 1}</h2>
            <p className="hint">{!r ? 'Comparing…' : r.onlyIn ? `This page is only in the ${r.onlyIn === 'A' ? 'original' : 'changed version'}.` : `${r.boxes.length} changed area${r.boxes.length === 1 ? '' : 's'} (boxed in red); ${r.added} word${r.added === 1 ? '' : 's'} added, ${r.removed} removed.`}</p>
          </div>
          {r && !r.onlyIn && (
            r.added || r.removed ? (
              <p className="compare-text">
                {r.words.map((w, i) => {
                  if (w.op === 'same') {
                    const ws = w.text.split(' ')
                    const t = ws.length > 16 ? `${ws.slice(0, 6).join(' ')} … ${ws.slice(-6).join(' ')}` : w.text
                    return <span key={i} className="same">{t} </span>
                  }
                  return <span key={i} className={w.op}>{w.text} </span>
                })}
              </p>
            ) : <p className="hint">{r.words.length ? 'The text is the same.' : 'No text found on this page (it may be a scan); only the picture was compared.'}</p>
          )}
          <div className="note">
            <Icon name="info" size={20} />
            <p>Pages are matched by position. Red boxes mark where the pages look different; the text list shows <span className="del">removed</span> and <span className="add">added</span> words.</p>
          </div>
        </div>
      </aside>
    </div>
  )
}
