import type { DocMeta, MetaRead } from '../core/metadata'
import type { ProtectOptions } from '../core/passwords'
import { Icon } from './icons'

interface Props {
  meta: DocMeta
  onMeta: (m: DocMeta) => void
  strip: boolean
  onStrip: (v: boolean) => void
  /** What the opened file said about itself, for showing what stripping drops. */
  original: MetaRead | null
  protect: ProtectOptions
  onProtect: (p: ProtectOptions) => void
}

/** Title/author/subject/keywords for the downloaded file, and whether to leave hidden info out. */
export function DocInfoPanel({ meta, onMeta, strip, onStrip, original, protect, onProtect }: Props) {
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
      <div className="group divided">
        <span className="eyebrow">Password</span>
        <label className="field-label">
          Password to open the download
          <span className="field"><input type="password" autoComplete="new-password" value={protect.user} placeholder="none" onChange={(e) => onProtect({ ...protect, user: e.target.value })} /></span>
        </label>
        <label className="check">
          <input type="checkbox" checked={protect.restrict} onChange={(e) => onProtect({ ...protect, restrict: e.target.checked })} />
          <span>Block printing, editing and copying</span>
        </label>
        <p className="hint">
          {protect.user || protect.restrict
            ? `Downloads are encrypted (AES-256)${protect.user ? ' and need this password to open. Keep it safe: it can’t be recovered' : ''}.${protect.restrict ? ' Restrictions are honoured by most viewers but are not a lock.' : ''}`
            : 'Leave empty for no password. Opening a protected PDF here asks for its password and removes it.'}
        </p>
      </div>
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
