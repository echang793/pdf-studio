import type { RefObject } from 'react'
import type { Annot, AnnotPatch, FontName, RGB } from '../core/model'
import { Icon, type IconName } from './icons'
import type { Tool } from './tools'

interface Props {
  tool: Tool
  onTool: (t: Tool) => void
  selected: Annot | null
  onPatch: (p: AnnotPatch) => void
  onDelete: () => void
  onImage: () => void
  onSignature: () => void
  textRef: RefObject<HTMLTextAreaElement | null>
}

const TOOLS: [Tool, string, IconName, string][] = [
  ['select', 'Select', 'select', 'Move and resize items'],
  ['text', 'Text', 'text', 'Drag or click on the page to add a text box'],
  ['whiteout', 'White-out', 'whiteout', 'Cover existing content with white'],
  ['highlight', 'Highlight', 'highlight', 'Translucent yellow marker'],
  ['rect', 'Box', 'box', 'Outline rectangle'],
]

const INKS: [string, RGB][] = [
  ['Black', [0.118, 0.114, 0.102]],
  ['Navy', [0.114, 0.169, 0.42]],
  ['Red', [0.702, 0.149, 0.118]],
  ['Green', [0.184, 0.369, 0.322]],
]
const FILLS: [string, RGB][] = [
  ['White', [1, 1, 1]],
  ['Yellow', [1, 0.92, 0.2]],
  ['Mint', [0.62, 0.86, 0.74]],
  ['Pink', [1, 0.72, 0.78]],
]

const css = (c: RGB) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`
const same = (a: RGB | null, b: RGB) => !!a && a.every((v, i) => Math.abs(v - b[i]) < 0.01)

function Swatches({ label, list, value, onPick }: { label: string; list: [string, RGB][]; value: RGB | null; onPick: (c: RGB) => void }) {
  return (
    <div className="swatches" role="radiogroup" aria-label={label}>
      <span className="hint" style={{ minWidth: 48 }}>{label}</span>
      {list.map(([name, c]) => (
        <button key={name} role="radio" aria-checked={same(value, c)} aria-label={name} className={`swatch ${same(value, c) ? 'on' : ''}`} style={{ background: css(c) }} onClick={() => onPick(c)} />
      ))}
    </div>
  )
}

export function EditPanel({ tool, onTool, selected, onPatch, onDelete, onImage, onSignature, textRef }: Props) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Edit</h2>
        <p className="hint">Pick a tool, then drag on the page.</p>
      </div>
      <div className="tools">
        {TOOLS.map(([t, label, icon, title]) => (
          <button key={t} className={`tool ${tool === t ? 'on' : ''}`} aria-pressed={tool === t} title={title} onClick={() => onTool(t)}>
            <Icon name={icon} size={20} stroke={1.9} />{label}
          </button>
        ))}
        <button className="tool" onClick={onImage} title="Insert a picture"><Icon name="image" size={20} stroke={1.9} />Image</button>
      </div>
      <button className="btn big" onClick={onSignature}><Icon name="signature" size={20} stroke={1.8} />Add signature</button>

      {selected && (
        <div className="group divided">
          <span className="eyebrow">Selected {selected.kind === 'rect' ? 'shape' : selected.kind}</span>
          {selected.kind === 'text' && (
            <>
              <label className="field-label">
                Content
                <textarea ref={textRef} className="field-area" rows={3} value={selected.text} placeholder="Type here…" onChange={(e) => onPatch({ text: e.target.value })} />
              </label>
              <div className="grid2">
                <label className="field-label">
                  Font
                  <span className="field">
                    <select value={selected.font} onChange={(e) => onPatch({ font: e.target.value as FontName })}>
                      <option value="Helvetica">Sans</option>
                      <option value="Times">Serif</option>
                      <option value="Courier">Mono</option>
                    </select>
                  </span>
                </label>
                <label className="field-label">
                  Size
                  <span className="field">
                    <input type="number" min={4} max={144} value={selected.size} onChange={(e) => onPatch({ size: Math.min(144, Math.max(4, Number(e.target.value) || 12)) })} />
                    <span className="unit">pt</span>
                  </span>
                </label>
              </div>
              <Swatches label="Color" list={INKS} value={selected.color} onPick={(color) => onPatch({ color })} />
            </>
          )}
          {selected.kind === 'rect' && (
            <>
              <Swatches label="Fill" list={FILLS} value={selected.fill} onPick={(fill) => onPatch({ fill })} />
              <Swatches label="Border" list={INKS} value={selected.stroke} onPick={(stroke) => onPatch({ stroke })} />
              <div className="row">
                <label className="check"><input type="checkbox" checked={!!selected.fill} onChange={(e) => onPatch({ fill: e.target.checked ? [1, 1, 1] : null })} />Fill</label>
                <label className="check"><input type="checkbox" checked={!!selected.stroke} onChange={(e) => onPatch({ stroke: e.target.checked ? INKS[2][1] : null })} />Border</label>
              </div>
              <label className="field-label">
                Opacity
                <input type="range" min={0.1} max={1} step={0.05} value={selected.opacity} onChange={(e) => onPatch({ opacity: Number(e.target.value) })} style={{ accentColor: 'var(--accent)' }} />
              </label>
            </>
          )}
          <button className="btn danger" onClick={onDelete}><Icon name="trash" size={16} />Delete item</button>
        </div>
      )}

      <div className="note">
        <Icon name="info" size={20} />
        <p><strong>Fixing a typo?</strong> Cover it with White-out, then drop a Text box on top. Text already inside a PDF can’t be rewritten in place reliably.</p>
      </div>
    </div>
  )
}
