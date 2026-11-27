import { useState } from 'react'
import type { FormField } from '../core/forms'
import { Icon } from './icons'

export interface FormGroup { src: string; fields: FormField[] }
type Values = Record<string, Record<string, string | boolean>>

interface Props {
  groups: FormGroup[]
  busy: boolean
  onApply: (values: Values, flatten: boolean) => void
}

const initial = (groups: FormGroup[]): Values => Object.fromEntries(groups.map((g) => [g.src, Object.fromEntries(g.fields.map((f) => [f.name, f.value]))]))

/** Fill the PDF's own form fields; optionally flatten them into the page. Give it a `key` that changes with the form so it restarts from the file's values. */
export function FormPanel({ groups, busy, onApply }: Props) {
  const [values, setValues] = useState<Values>(() => initial(groups))
  const [flatten, setFlatten] = useState(false)
  const set = (src: string, name: string, v: string | boolean) => setValues((all) => ({ ...all, [src]: { ...all[src], [name]: v } }))
  const count = groups.reduce((n, g) => n + g.fields.length, 0)

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Form</h2>
        <p className="hint">This PDF has {count} fillable field{count === 1 ? '' : 's'}. Fill them here, then Apply.</p>
      </div>
      {groups.map((g, gi) => (
        <div key={g.src} className="group">
          {groups.length > 1 && <span className="eyebrow">File {gi + 1}</span>}
          {g.fields.map((f) => {
            const v = values[g.src]?.[f.name]
            const label = <>{f.name}{f.readOnly && ' (read-only)'}</>
            if (f.kind === 'checkbox') {
              return <label key={f.name} className="check"><input type="checkbox" disabled={f.readOnly || busy} checked={!!v} onChange={(e) => set(g.src, f.name, e.target.checked)} /><span>{label}</span></label>
            }
            if (f.kind === 'text') {
              return (
                <label key={f.name} className="field-label">
                  {label}
                  <span className="field">
                    {f.multiline
                      ? <textarea rows={3} disabled={f.readOnly || busy} value={String(v ?? '')} onChange={(e) => set(g.src, f.name, e.target.value)} />
                      : <input disabled={f.readOnly || busy} value={String(v ?? '')} onChange={(e) => set(g.src, f.name, e.target.value)} />}
                  </span>
                </label>
              )
            }
            return (
              <label key={f.name} className="field-label">
                {label}
                <span className="field">
                  <select disabled={f.readOnly || busy} value={String(v ?? '')} onChange={(e) => set(g.src, f.name, e.target.value)}>
                    <option value="">—</option>
                    {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </span>
              </label>
            )
          })}
        </div>
      ))}
      <label className="check">
        <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} />
        <span>Flatten (bake the answers into the page; fields can no longer be edited)</span>
      </label>
      <button className="btn primary" disabled={busy} onClick={() => onApply(values, flatten)}>
        <Icon name="check" size={16} stroke={2.2} />{flatten ? 'Fill and flatten' : 'Fill form'}
      </button>
      <div className="note">
        <Icon name="info" size={20} />
        <p>Without Flatten, the downloaded PDF keeps working fields with your answers in them. ⌘Z undoes a fill.</p>
      </div>
    </div>
  )
}
