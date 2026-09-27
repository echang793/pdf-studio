import type { Scope, ScopeMode } from '../core/scope'

const MODES: [ScopeMode, string, string][] = [
  ['current', 'This', 'This page'],
  ['all', 'All', 'All pages'],
  ['odd', 'Odd', 'Odd pages'],
  ['even', 'Even', 'Even pages'],
  ['custom', 'Range', 'A custom page range'],
]

export function ScopePicker({ scope, onChange, error, label = 'Apply to' }: { scope: Scope; onChange: (s: Scope) => void; error?: string; label?: string }) {
  return (
    <div className="group scope">
      <span className="eyebrow" id="scope-label">{label}</span>
      <div className="seg" role="radiogroup" aria-labelledby="scope-label">
        {MODES.map(([m, text, title]) => (
          <button key={m} type="button" role="radio" aria-checked={scope.mode === m} title={title} className={scope.mode === m ? 'on' : ''} onClick={() => onChange({ ...scope, mode: m })}>
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
