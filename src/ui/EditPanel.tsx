import type { RefObject } from 'react'
import type { Annot, AnnotPatch, FontName } from '../core/model'
import { Icon, type IconName } from './icons'
import { FILLS, INKS, Swatches } from './swatches'
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
  ['redact', 'Redact', 'redact', 'Permanently remove content under this box (see “Download redacted copy” in Pages)'],
]

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
          <span className="eyebrow">Selected {selected.kind === 'rect' ? 'shape' : selected.kind === 'redact' ? 'redaction' : selected.kind}</span>
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
          {selected.kind === 'redact' && (
            <p className="hint">Always covers with solid white — its color can’t be changed. Move or resize it like any box.</p>
          )}
          <button className="btn danger" onClick={onDelete}><Icon name="trash" size={16} />Delete item</button>
        </div>
      )}

      <div className="note">
        <Icon name="info" size={20} />
        <p><strong>Fixing a typo?</strong> Cover it with White-out, then drop a Text box on top. Text already inside a PDF can’t be rewritten in place reliably. <strong>Hiding something sensitive?</strong> White-out only paints over it — use Redact instead, then “Download redacted copy” in Pages.</p>
      </div>
    </div>
  )
}
