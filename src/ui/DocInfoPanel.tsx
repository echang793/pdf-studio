import type { DocMeta, MetaRead } from '../core/metadata'
import { Icon } from './icons'

interface Props {
  meta: DocMeta
  onMeta: (m: DocMeta) => void
  strip: boolean
  onStrip: (v: boolean) => void
  /** What the opened file said about itself, for showing what stripping drops. */
  original: MetaRead | null
}

/** Title/author/subject/keywords for the downloaded file, and whether to leave hidden info out. */
export function DocInfoPanel({ meta, onMeta, strip, onStrip, original }: Props) {
  const set = (patch: Partial<DocMeta>) => onMeta({ ...meta, ...patch })
  const hidden = original ? [original.creator && `made with ${original.creator}`, original.producer && `producer ${original.producer}`, original.created && `created ${original.created}`, original.modified && `modified ${original.modified}`].filter(Boolean) : []
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Document info</h2>
        <p className="hint">What the downloaded PDF says about itself. Leave a field empty to leave it out.</p>
      </div>
      {(['title', 'author', 'subject', 'keywords'] as const).map((k) => (
        <label key={k} className="field-label">
          {k[0].toUpperCase() + k.slice(1)}
          <span className="field"><input value={meta[k]} onChange={(e) => set({ [k]: e.target.value })} placeholder={k === 'keywords' ? 'space separated' : ''} /></span>
        </label>
      ))}
      <label className="check">
        <input type="checkbox" checked={strip} onChange={(e) => onStrip(e.target.checked)} />
        <span>Remove hidden info on download</span>
      </label>
      <div className="note">
        <Icon name="info" size={20} />
        <p>
          {strip
            ? 'Leaves out the app and producer names, creation and edit dates, per-page XMP and app data, and the names and dates on comments. The comments themselves stay.'
            : 'Hidden page data and comment authors are carried over from the original.'}
          {hidden.length > 0 && ` The opened file says: ${hidden.join(', ')}.`}
        </p>
      </div>
    </div>
  )
}
