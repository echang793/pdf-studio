import type { Scope, ScopeMode } from '../core/scope'

const MODES: [ScopeMode, string][] = [
  ['current', 'This page'],
  ['all', 'All'],
  ['odd', 'Odd'],
  ['even', 'Even'],
  ['custom', 'Range'],
]

export function ScopePicker({ scope, onChange, error, label = 'Apply to' }: { scope: Scope; onChange: (s: Scope) => void; error?: string; label?: string }) {
  return (
    <fieldset className="scope">
      <legend>{label}</legend>
      <div className="seg">
        {MODES.map(([m, text]) => (
          <button key={m} type="button" className={scope.mode === m ? 'on' : ''} onClick={() => onChange({ ...scope, mode: m })}>
            {text}
          </button>
        ))}
      </div>
      {scope.mode === 'custom' && (
        <input
          aria-label="Page range"
          placeholder="e.g. 1-3, 7, 10-"
          value={scope.range}
          onChange={(e) => onChange({ ...scope, range: e.target.value })}
        />
      )}
      {error && <p className="err">{error}</p>}
    </fieldset>
  )
}
