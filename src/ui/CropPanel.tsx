import { useState } from 'react'
import { fromPt, toPt, type Margins, type Unit } from '../core/geometry'
import type { Scope } from '../core/scope'
import { ScopePicker } from './ScopePicker'

interface Props {
  margins: Margins
  onMargins: (m: Margins) => void
  scope: Scope
  onScope: (s: Scope) => void
  scopeError?: string
  dirty: boolean
  busy: boolean
  onApply: () => void
  onReset: () => void
  onAutoTrim: () => void
  onRevertDraft: () => void
}

const SIDES: (keyof Margins)[] = ['top', 'bottom', 'left', 'right']
const STEP: Record<Unit, number> = { pt: 1, in: 0.05, mm: 1 }
const DIGITS: Record<Unit, number> = { pt: 1, in: 3, mm: 1 }

export function CropPanel(p: Props) {
  const [unit, setUnit] = useState<Unit>('mm')
  const [uniform, setUniform] = useState(false)

  const set = (side: keyof Margins, raw: string) => {
    const v = toPt(Number(raw), unit)
    if (!Number.isFinite(v)) return
    p.onMargins(uniform ? { top: v, bottom: v, left: v, right: v } : { ...p.margins, [side]: v })
  }

  return (
    <div className="panel">
      <h2>Crop</h2>
      <p className="hint">Drag the frame or its handles, draw a new frame on the dimmed area, or type exact margins.</p>
      <div className="row">
        <label>
          Units{' '}
          <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
            <option value="mm">mm</option>
            <option value="in">in</option>
            <option value="pt">pt</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={uniform} onChange={(e) => setUniform(e.target.checked)} /> Same on all sides
        </label>
      </div>
      <div className="margins">
        {SIDES.map((side) => (
          <label key={side}>
            {side}
            <input
              type="number"
              min={0}
              step={STEP[unit]}
              value={Number(fromPt(p.margins[side], unit).toFixed(DIGITS[unit]))}
              onChange={(e) => set(side, e.target.value)}
            />
          </label>
        ))}
      </div>
      <ScopePicker scope={p.scope} onChange={p.onScope} error={p.scopeError} />
      <div className="actions">
        <button className="primary" disabled={!!p.scopeError || p.busy} onClick={p.onApply}>
          Apply crop{p.dirty ? ' •' : ''}
        </button>
        <button disabled={!p.dirty} onClick={p.onRevertDraft}>Undo frame changes</button>
      </div>
      <div className="actions">
        <button disabled={!!p.scopeError || p.busy} onClick={p.onAutoTrim} title="Detect content and remove surrounding white space">
          {p.busy ? 'Trimming…' : 'Auto-trim whitespace'}
        </button>
        <button disabled={!!p.scopeError || p.busy} onClick={p.onReset} title="Restore original page size (nothing was deleted)">
          Reset to full page
        </button>
      </div>
      <p className="hint">Cropping is non-destructive: hidden content stays in the file, and “Reset to full page” brings it back — even after download.</p>
    </div>
  )
}
