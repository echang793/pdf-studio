import type { Align, HeaderFooterSpec } from '../core/headerFooter'
import type { FontName } from '../core/model'
import { Icon } from './icons'
import { INKS, Swatches } from './swatches'

interface Props {
  spec: HeaderFooterSpec
  onSpec: (s: HeaderFooterSpec) => void
  scopeCount: number
  blocked: boolean
  onApply: () => void
  onRemove: () => void
}

function AlignPicker({ value, onChange, label }: { value: Align; onChange: (a: Align) => void; label: string }) {
  return (
    <div className="seg light" role="radiogroup" aria-label={label}>
      {(['left', 'center', 'right'] as const).map((a) => (
        <button key={a} role="radio" aria-checked={value === a} className={value === a ? 'on' : ''} onClick={() => onChange(a)}>
          {a === 'left' ? 'Left' : a === 'center' ? 'Centre' : 'Right'}
        </button>
      ))}
    </div>
  )
}

/** Page numbers, headers and footers, stamped as ordinary (editable) text boxes on the chosen pages. */
export function HeaderFooterPanel(p: Props) {
  const set = (patch: Partial<HeaderFooterSpec>) => p.onSpec({ ...p.spec, ...patch })
  const empty = !p.spec.header.trim() && !p.spec.footer.trim()
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Page numbers, header &amp; footer</h2>
        <p className="hint">Use {'{page}'}, {'{pages}'}, {'{date}'} and {'{file}'} in the text. Uses the same pages chosen above.</p>
      </div>

      <label className="field-label">
        Header
        <span className="field"><input value={p.spec.header} placeholder="e.g. {file}" onChange={(e) => set({ header: e.target.value })} /></span>
      </label>
      <AlignPicker label="Header alignment" value={p.spec.headerAlign} onChange={(headerAlign) => set({ headerAlign })} />

      <label className="field-label">
        Footer
        <span className="field"><input value={p.spec.footer} placeholder="e.g. Page {page} of {pages}" onChange={(e) => set({ footer: e.target.value })} /></span>
      </label>
      <AlignPicker label="Footer alignment" value={p.spec.footerAlign} onChange={(footerAlign) => set({ footerAlign })} />

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
            <input type="number" min={6} max={48} value={p.spec.size} onChange={(e) => set({ size: Math.min(48, Math.max(6, Number(e.target.value) || 10)) })} />
            <span className="unit">pt</span>
          </span>
        </label>
        <label className="field-label">
          Margin
          <span className="field">
            <input type="number" min={0} max={144} value={p.spec.margin} onChange={(e) => set({ margin: Math.min(144, Math.max(0, Number(e.target.value) || 0)) })} />
            <span className="unit">pt</span>
          </span>
        </label>
        <label className="field-label">
          First page is number
          <span className="field">
            <input type="number" min={0} max={99999} value={p.spec.start} onChange={(e) => set({ start: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
          </span>
        </label>
      </div>

      <Swatches label="Color" list={INKS} value={p.spec.color} onPick={(color) => set({ color })} />

      <div className="grid2">
        <button className="btn primary" disabled={p.blocked || empty} onClick={p.onApply}>
          <Icon name="check" size={16} stroke={2.2} />Apply to {p.scopeCount || 0}
        </button>
        <button className="btn" disabled={p.blocked} onClick={p.onRemove}>
          <Icon name="trash" size={16} />Remove from {p.scopeCount || 0}
        </button>
      </div>
      <div className="note">
        <Icon name="info" size={20} />
        <p>Numbers follow each page’s place in the document. Moved pages around? Press Apply again to renumber. Each line becomes a normal text box you can still nudge in Edit.</p>
      </div>
    </div>
  )
}
