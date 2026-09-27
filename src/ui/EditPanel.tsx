import type { RefObject } from 'react'
import type { Annot, AnnotPatch, FontName, RGB } from '../core/model'
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

const TOOLS: [Tool, string, string][] = [
  ['select', 'Select', 'Move and resize items'],
  ['text', 'Text', 'Drag or click on the page to add a text box'],
  ['whiteout', 'White-out', 'Cover existing content with white (then add text on top to “correct” it)'],
  ['highlight', 'Highlight', 'Translucent yellow marker'],
  ['rect', 'Box', 'Outline rectangle'],
]

const hex = (c: RGB) => '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
const rgbOf = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB

export function EditPanel({ tool, onTool, selected, onPatch, onDelete, onImage, onSignature, textRef }: Props) {
  return (
    <div className="panel">
      <h2>Edit</h2>
      <div className="tools">
        {TOOLS.map(([t, label, title]) => (
          <button key={t} className={tool === t ? 'on' : ''} title={title} onClick={() => onTool(t)}>{label}</button>
        ))}
        <button onClick={onImage} title="Insert a PNG/JPG/other image">Image…</button>
        <button onClick={onSignature} title="Draw, type or upload a signature">Signature…</button>
      </div>
      <p className="hint">
        To fix existing text: add a <b>White-out</b> over it, then a <b>Text</b> box on top. (Rewriting text embedded in a PDF
        in place isn’t reliable in any browser tool — fonts are usually subset.)
      </p>

      {selected && (
        <div className="props">
          <h3>Selected {selected.kind === 'rect' ? 'shape' : selected.kind}</h3>
          {selected.kind === 'text' && (
            <>
              <textarea
                ref={textRef}
                rows={4}
                value={selected.text}
                placeholder="Type here…"
                onChange={(e) => onPatch({ text: e.target.value })}
              />
              <div className="row">
                <select value={selected.font} onChange={(e) => onPatch({ font: e.target.value as FontName })} aria-label="Font">
                  <option value="Helvetica">Sans (Helvetica)</option>
                  <option value="Times">Serif (Times)</option>
                  <option value="Courier">Mono (Courier)</option>
                </select>
                <input type="number" min={4} max={144} value={selected.size} onChange={(e) => onPatch({ size: Math.min(144, Math.max(4, Number(e.target.value) || 12)) })} aria-label="Font size" style={{ width: '4.5em' }} />
                <input type="color" value={hex(selected.color)} onChange={(e) => onPatch({ color: rgbOf(e.target.value) })} aria-label="Text color" />
              </div>
            </>
          )}
          {selected.kind === 'rect' && (
            <div className="row">
              <label>Fill <input type="checkbox" checked={!!selected.fill} onChange={(e) => onPatch({ fill: e.target.checked ? [1, 1, 1] : null })} /></label>
              {selected.fill && <input type="color" value={hex(selected.fill)} onChange={(e) => onPatch({ fill: rgbOf(e.target.value) })} aria-label="Fill color" />}
              <label>Border <input type="checkbox" checked={!!selected.stroke} onChange={(e) => onPatch({ stroke: e.target.checked ? [0.85, 0.1, 0.1] : null })} /></label>
              {selected.stroke && <input type="color" value={hex(selected.stroke)} onChange={(e) => onPatch({ stroke: rgbOf(e.target.value) })} aria-label="Border color" />}
              <label>Opacity <input type="range" min={0.1} max={1} step={0.05} value={selected.opacity} onChange={(e) => onPatch({ opacity: Number(e.target.value) })} /></label>
            </div>
          )}
          <div className="actions">
            <button className="danger" onClick={onDelete}>Delete item</button>
          </div>
        </div>
      )}
    </div>
  )
}
