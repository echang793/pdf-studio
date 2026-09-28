import type { FontName, RGB } from '../core/model'
import type { Scope } from '../core/scope'
import { Icon } from './icons'
import { ScopePicker } from './ScopePicker'
import { INKS, Swatches } from './swatches'

export interface WatermarkSpec { text: string; size: number; color: RGB; opacity: number; angle: number; font: FontName }

interface Props {
  spec: WatermarkSpec
  onSpec: (s: WatermarkSpec) => void
  scope: Scope
  onScope: (s: Scope) => void
  scopeError?: string
  scopeCount: number
  selectedCount?: number
  busy: boolean
  onApply: () => void
  onRemove: () => void
}

export function WatermarkPanel(p: Props) {
  const set = (patch: Partial<WatermarkSpec>) => p.onSpec({ ...p.spec, ...patch })
  const blocked = !!p.scopeError || p.busy || !p.spec.text.trim()

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Watermark</h2>
        <p className="hint">Set the text and look, pick which pages, then apply. Re-applying replaces the old one.</p>
      </div>

      <label className="field-label">
        Text
        <span className="field"><input value={p.spec.text} placeholder="e.g. DRAFT" onChange={(e) => set({ text: e.target.value })} /></span>
      </label>

      <div className="grid2">
        <label className="field-label">
          Font
          <span className="field">
            <select value={p.spec.font} onChange={(e) => set({ font: e.target.value as FontName })}>
              <option value="Helvetica">Sans</option>
              <option value="Times">Serif</option>
              <option value="Courier">Mono</option>
            </select>
          </span>
        </label>
        <label className="field-label">
          Size
          <span className="field">
            <input type="number" min={8} max={200} value={p.spec.size} onChange={(e) => set({ size: Math.min(200, Math.max(8, Number(e.target.value) || 60)) })} />
            <span className="unit">pt</span>
          </span>
        </label>
      </div>

      <Swatches label="Color" list={INKS} value={p.spec.color} onPick={(color) => set({ color })} />

      <label className="field-label">
        Opacity
        <input type="range" min={0.05} max={1} step={0.05} value={p.spec.opacity} onChange={(e) => set({ opacity: Number(e.target.value) })} style={{ accentColor: 'var(--accent)' }} />
      </label>

      <label className="field-label">
        Angle · {p.spec.angle}°
        <input type="range" min={-90} max={90} step={5} value={p.spec.angle} onChange={(e) => set({ angle: Number(e.target.value) })} style={{ accentColor: 'var(--accent)' }} />
      </label>

      <ScopePicker scope={p.scope} onChange={p.onScope} error={p.scopeError} selectedCount={p.selectedCount} />

      <div className="grid2">
        <button className="btn primary" disabled={blocked} onClick={p.onApply}>
          <Icon name="check" size={16} stroke={2.2} />Apply to {p.scopeCount || 0}
        </button>
        <button className="btn" disabled={!!p.scopeError || p.busy} onClick={p.onRemove}>
          <Icon name="trash" size={16} />Remove from {p.scopeCount || 0}
        </button>
      </div>

      <div className="note">
        <Icon name="info" size={20} />
        <p>Watermarks are re-generated when you Apply, so tweak the settings and press Apply again to update pages you already stamped.</p>
      </div>
    </div>
  )
}
