import type { Scope, ScopeMode } from '../core/scope'

const MODES: [ScopeMode, string, string][] = [
  ['current', 'This', 'This page'],
  ['all', 'All', 'All pages'],
  ['odd', 'Odd', 'Odd pages'],
  ['even', 'Even', 'Even pages'],
  ['custom', 'Range', 'A custom page range'],
]

export function ScopePicker({
  scope, onChange, error, label = 'Apply to', selectedCount = 0,
}: { scope: Scope; onChange: (s: Scope) => void; error?: string; label?: string; selectedCount?: number }) {
  const picking = selectedCount > 1 && scope.mode === 'selected'
  return (
    <div className="group scope">
      <span className="eyebrow" id="scope-label">{label}</span>
      {picking && (
        <div className="picked-chip">
          <span>{selectedCount} page{selectedCount === 1 ? '' : 's'} picked on the left</span>
          <button type="button" className="btn ghost" onClick={() => onChange({ ...scope, mode: 'current' })}>Clear</button>
        </div>
      )}
      <div className="seg" role="radiogroup" aria-labelledby="scope-label">
        {MODES.map(([m, text, title]) => (
          <button key={m} type="button" role="radio" aria-checked={!picking && scope.mode === m} title={title} className={!picking && scope.mode === m ? 'on' : ''} onClick={() => onChange({ ...scope, mode: m })}>
            {text}
          </button>
        ))}
      </div>
      {scope.mode === 'custom' && (
        <label className="field" aria-label="Page range">
          <input placeholder="e.g. 1-3, 7, 10-" value={scope.range} onChange={(e) => onChange({ ...scope, range: e.target.value })} autoFocus />
        </label>
      )}
      {error && <p className="err">{error}</p>}
    </div>
  )
}
