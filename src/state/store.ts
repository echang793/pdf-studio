import { clampToMedia, marginsToBox, normRotation, type Box, type Margins, type Size } from '../core/geometry'
import { headerFooterAnnots, type HeaderFooterSpec } from '../core/headerFooter'
import { uid, type Annot, type AnnotPatch, type ImageAnnot, type OcrWord, type PageRef, type WatermarkAnnot } from '../core/model'

type WatermarkSpec = Omit<WatermarkAnnot, 'id' | 'rect' | 'rotate'>

export interface Doc { pages: PageRef[] }

export interface State {
  doc: Doc
  past: Doc[]
  future: Doc[]
  /** Page shown in the main editor. */
  current: string | null
}

export type Action =
  | { type: 'addPages'; pages: PageRef[] }
  | { type: 'crop'; ids: string[]; margins: Margins }
  | { type: 'setCrops'; crops: Record<string, PageRef['crop']> }
  | { type: 'resetCrop'; ids: string[] }
  | { type: 'rotate'; ids: string[]; delta: number }
  | { type: 'move'; from: number; to: number }
  | { type: 'delete'; ids: string[] }
  | { type: 'duplicate'; ids: string[] }
  | { type: 'insertBlank'; index: number; size: Size }
  | { type: 'addImagePage'; index: number; size: Size; annot: Omit<ImageAnnot, 'id' | 'rect' | 'rotate'> }
  | { type: 'setWatermark'; ids: string[]; spec: WatermarkSpec | null }
  /** Erased pages: an asset key (whole page replaced) or { asset, rect } (a patch drawn over the original). */
  | { type: 'setBases'; items: Record<string, string | { asset: string; rect: Box }> }
  /** Point every page of source `from` at `to` (a rewritten copy of the same pages, e.g. with watermark objects removed). */
  | { type: 'replaceSource'; from: string; to: string }
  /** Store OCR words on erased pages (makes them searchable in the download). */
  | { type: 'setOcr'; items: Record<string, OcrWord[]> }
  /** Header/footer on these pages (null removes it); numbers come from each page's place in the document. */
  | { type: 'setHeaderFooter'; ids: string[]; spec: HeaderFooterSpec | null; file: string; date: string }
  | { type: 'addAnnot'; pageId: string; annot: Annot }
  | { type: 'updateAnnot'; pageId: string; id: string; patch: AnnotPatch }
  | { type: 'removeAnnot'; pageId: string; id: string }
  | { type: 'select'; id: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset' }

export const initialState: State = { doc: { pages: [] }, past: [], future: [], current: null }

const HISTORY_LIMIT = 100

function mapPages(doc: Doc, ids: string[], fn: (p: PageRef) => PageRef): Doc {
  const set = new Set(ids)
  return { pages: doc.pages.map((p) => (set.has(p.id) ? fn(p) : p)) }
}

/** Pure document transitions. Returns the same Doc when nothing changes. */
function docReducer(doc: Doc, a: Action): Doc {
  switch (a.type) {
    case 'addPages':
      return { pages: [...doc.pages, ...a.pages] }
    case 'crop':
      return mapPages(doc, a.ids, (p) => ({ ...p, crop: marginsToBox(p.media, p.rotation, a.margins) }))
    case 'setCrops':
      return { pages: doc.pages.map((p) => (a.crops[p.id] ? { ...p, crop: clampToMedia(p.media, a.crops[p.id]) } : p)) }
    case 'resetCrop':
      return mapPages(doc, a.ids, (p) => ({ ...p, crop: { ...p.media } }))
    case 'rotate':
      return mapPages(doc, a.ids, (p) => ({ ...p, rotation: normRotation(p.rotation + a.delta) }))
    case 'move': {
      const n = doc.pages.length
      if (a.from === a.to || a.from < 0 || a.to < 0 || a.from >= n || a.to >= n) return doc
      const pages = [...doc.pages]
      const [p] = pages.splice(a.from, 1)
      pages.splice(a.to, 0, p)
      return { pages }
    }
    case 'delete': {
      const set = new Set(a.ids)
      const pages = doc.pages.filter((p) => !set.has(p.id))
      return pages.length === 0 || pages.length === doc.pages.length ? doc : { pages }
    }
    case 'duplicate': {
      const set = new Set(a.ids)
      return { pages: doc.pages.flatMap((p) => (set.has(p.id) ? [p, { ...p, id: uid('pg') }] : [p])) }
    }
    case 'insertBlank': {
      const box = { x: 0, y: 0, width: a.size.width, height: a.size.height }
      const blank: PageRef = { id: uid('pg'), src: null, srcIndex: 0, rotation: 0, media: box, crop: { ...box }, annots: [] }
      const pages = [...doc.pages]
      pages.splice(Math.max(0, Math.min(a.index, pages.length)), 0, blank)
      return { pages }
    }
    case 'setWatermark':
      return mapPages(doc, a.ids, (p) => {
        const rest = p.annots.filter((x) => x.kind !== 'watermark')
        if (!a.spec) return { ...p, annots: rest }
        const wm: WatermarkAnnot = { ...a.spec, id: uid('wm'), rect: p.crop, rotate: p.rotation }
        return { ...p, annots: [...rest, wm] }
      })
    case 'addImagePage': {
      const box = { x: 0, y: 0, width: a.size.width, height: a.size.height }
      const page: PageRef = { id: uid('pg'), src: null, srcIndex: 0, rotation: 0, media: box, crop: { ...box }, annots: [{ ...a.annot, id: uid('an'), rect: { ...box }, rotate: 0 }] }
      const pages = [...doc.pages]
      pages.splice(Math.max(0, Math.min(a.index, pages.length)), 0, page)
      return { pages }
    }
    case 'setBases': {
      // Erased pages: the image already has the page's annotations painted in, so they're cleared.
      const ids = Object.keys(a.items).filter((id) => doc.pages.some((p) => p.id === id))
      if (ids.length === 0) return doc
      return mapPages(doc, ids, (p) => {
        const it = a.items[p.id]
        return typeof it === 'string' ? { ...p, base: { asset: it }, annots: [], ocr: undefined } : { ...p, base: { asset: it.asset, rect: it.rect }, ocr: undefined }
      })
    }
    case 'setOcr': {
      const ids = Object.keys(a.items).filter((id) => doc.pages.some((p) => p.id === id))
      if (ids.length === 0) return doc
      return mapPages(doc, ids, (p) => ({ ...p, ocr: a.items[p.id] }))
    }
    case 'replaceSource': {
      const ids = doc.pages.filter((p) => p.src === a.from).map((p) => p.id)
      if (ids.length === 0) return doc
      return mapPages(doc, ids, (p) => ({ ...p, src: a.to }))
    }
    case 'setHeaderFooter': {
      const total = doc.pages.length
      const spec = a.spec
      return mapPages(doc, a.ids, (p) => {
        const rest = p.annots.filter((x) => !(x.kind === 'text' && x.tag))
        if (!spec) return { ...p, annots: rest }
        const i = doc.pages.indexOf(p)
        const ctx = { page: i + spec.start, pages: total + spec.start - 1, file: a.file, date: a.date }
        return { ...p, annots: [...rest, ...headerFooterAnnots(p, spec, ctx)] }
      })
    }
    case 'addAnnot':
      return mapPages(doc, [a.pageId], (p) => ({ ...p, annots: [...p.annots, a.annot] }))
    case 'updateAnnot':
      return mapPages(doc, [a.pageId], (p) => ({
        ...p,
        annots: p.annots.map((x) => (x.id === a.id ? ({ ...x, ...a.patch } as Annot) : x)),
      }))
    case 'removeAnnot':
      return mapPages(doc, [a.pageId], (p) => ({ ...p, annots: p.annots.filter((x) => x.id !== a.id) }))
    default:
      return doc
  }
}

function fixCurrent(doc: Doc, current: string | null): string | null {
  if (current && doc.pages.some((p) => p.id === current)) return current
  return doc.pages[0]?.id ?? null
}

export function reducer(state: State, a: Action): State {
  switch (a.type) {
    case 'select':
      return { ...state, current: a.id }
    case 'reset':
      return initialState
    case 'undo': {
      const prev = state.past.at(-1)
      if (!prev) return state
      return { doc: prev, past: state.past.slice(0, -1), future: [state.doc, ...state.future], current: fixCurrent(prev, state.current) }
    }
    case 'redo': {
      const [next, ...rest] = state.future
      if (!next) return state
      return { doc: next, past: [...state.past, state.doc], future: rest, current: fixCurrent(next, state.current) }
    }
    default: {
      const doc = docReducer(state.doc, a)
      if (doc === state.doc) return state
      return {
        doc,
        past: [...state.past, state.doc].slice(-HISTORY_LIMIT),
        future: [],
        current: fixCurrent(doc, state.current),
      }
    }
  }
}
