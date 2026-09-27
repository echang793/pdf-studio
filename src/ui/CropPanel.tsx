import { useState } from 'react'
import { fromPt, toPt, type Margins, type Unit } from '../core/geometry'
import type { Scope } from '../core/scope'
import { Icon } from './icons'
import { ScopePicker } from './ScopePicker'

interface Props {
  margins: Margins
  onMargins: (m: Margins) => void
  unit: Unit
  onUnit: (u: Unit) => void
  scope: Scope
  onScope: (s: Scope) => void
  scopeError?: string
  scopeCount: number
  dirty: boolean
  busy: boolean
  onApply: () => void
  onReset: () => void
  onAutoTrim: () => void
  onRevertDraft: () => void
}

const SIDES: (keyof Margins)[] = ['top', 'bottom', 'left', 'right']
const UNITS: Unit[] = ['mm', 'in', 'pt']
const STEP: Record<Unit, number> = { pt: 1, in: 0.05, mm: 1 }
const DIGITS: Record<Unit, number> = { pt: 1, in: 3, mm: 1 }

export function CropPanel(p: Props) {
  const [uniform, setUniform] = useState(false)
  const set = (side: keyof Margins, raw: string) => {
    const v = toPt(Number(raw), p.unit)
    if (!Number.isFinite(v)) return
    p.onMargins(uniform ? { top: v, bottom: v, left: v, right: v } : { ...p.margins, [side]: v })
  }
  const blocked = !!p.scopeError || p.busy
  const n = p.scopeCount

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Crop</h2>
        <p className="hint">Drag the frame, draw a new one on the page, or type exact margins.</p>
      </div>

      <div className="group">
        <div className="group-head">
          <span className="eyebrow" id="margins-label">Margins</span>
          <div className="seg light small" role="radiogroup" aria-label="Units">
            {UNITS.map((u) => (
              <button key={u} role="radio" aria-checked={p.unit === u} className={p.unit === u ? 'on' : ''} onClick={() => p.onUnit(u)}>{u}</button>
            ))}
          </div>
        </div>
        <div className="grid2" role="group" aria-labelledby="margins-label">
          {SIDES.map((side) => (
            <label key={side} className="field-label">
              {side[0].toUpperCase() + side.slice(1)}
              <span className="field">
                <input
                  type="number" inputMode="decimal" min={0} step={STEP[p.unit]}
                  value={Number(fromPt(p.margins[side], p.unit).toFixed(DIGITS[p.unit]))}
                  onChange={(e) => set(side, e.target.value)}
                />
                <span className="unit">{p.unit}</span>
              </span>
            </label>
          ))}
        </div>
        <label className="check"><input type="checkbox" checked={uniform} onChange={(e) => setUniform(e.target.checked)} />Same on all sides</label>
      </div>

      <ScopePicker scope={p.scope} onChange={p.onScope} error={p.scopeError} />

      <div className="group">
        <button className="btn primary big" disabled={blocked} onClick={p.onApply}>
          <Icon name="check" stroke={2.2} />
          Apply crop{n ? ` to ${n} page${n === 1 ? '' : 's'}` : ''}
        </button>
        <div className="grid2">
          <button className="btn" disabled={blocked} onClick={p.onAutoTrim} title="Detect content and remove the white space around it">
            <Icon name="trim" size={16} />{p.busy ? 'Trimming…' : 'Auto-trim'}
          </button>
          <button className="btn" disabled={blocked} onClick={p.onReset} title="Restore the original page size">
            <Icon name="reset" size={16} />Full page
          </button>
        </div>
        {p.dirty && <button className="btn ghost" onClick={p.onRevertDraft}>Discard frame changes</button>}
      </div>

      <div className="note">
        <Icon name="shield" size={20} />
        <p><strong>Nothing is deleted.</strong> Cropping only hides the edges — “Full page” brings them back, even after download. Files never leave this browser.</p>
      </div>
    </div>
  )
}
