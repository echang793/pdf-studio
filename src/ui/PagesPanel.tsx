import { useState } from 'react'
import type { Scope } from '../core/scope'
import { Icon } from './icons'
import { ScopePicker } from './ScopePicker'

interface Props {
  scope: Scope
  onScope: (s: Scope) => void
  scopeError?: string
  selectedCount?: number
  busy: boolean
  onRotate: (delta: number) => void
  onDelete: () => void
  onDuplicate: () => void
  onBlank: (where: 'before' | 'after', size: 'letter' | 'a4' | 'same') => void
  onExtract: () => void
  onSplit: (every: number) => void
  onAddPdf: () => void
}

export function PagesPanel(p: Props) {
  const [every, setEvery] = useState(1)
  const [blankSize, setBlankSize] = useState<'letter' | 'a4' | 'same'>('same')
  const dis = !!p.scopeError || p.busy
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Pages</h2>
        <p className="hint">Drag thumbnails to reorder. Pick which pages the buttons below act on.</p>
      </div>

      <ScopePicker scope={p.scope} onChange={p.onScope} error={p.scopeError} selectedCount={p.selectedCount} />

      <div className="group">
        <div className="grid2">
          <button className="btn" disabled={dis} onClick={() => p.onRotate(-90)}><Icon name="rotateL" size={16} />Rotate left</button>
          <button className="btn" disabled={dis} onClick={() => p.onRotate(90)}><Icon name="rotateR" size={16} />Rotate right</button>
          <button className="btn" disabled={dis} onClick={p.onDuplicate}><Icon name="copy" size={16} />Duplicate</button>
          <button className="btn danger" disabled={dis} onClick={p.onDelete}><Icon name="trash" size={16} />Delete</button>
        </div>
        <button className="btn" disabled={dis} onClick={p.onExtract} title="Download the chosen pages as a new PDF"><Icon name="extract" size={16} />Extract to new PDF</button>
      </div>

      <div className="group divided">
        <span className="eyebrow">Insert blank page</span>
        <label className="field" aria-label="Blank page size">
          <select value={blankSize} onChange={(e) => setBlankSize(e.target.value as typeof blankSize)}>
            <option value="same">Same size as current page</option>
            <option value="letter">Letter · 8.5 × 11 in</option>
            <option value="a4">A4 · 210 × 297 mm</option>
          </select>
        </label>
        <div className="grid2">
          <button className="btn" disabled={p.busy} onClick={() => p.onBlank('before', blankSize)}><Icon name="plus" size={16} />Before</button>
          <button className="btn" disabled={p.busy} onClick={() => p.onBlank('after', blankSize)}><Icon name="plus" size={16} />After</button>
        </div>
      </div>

      <div className="group divided">
        <span className="eyebrow">Merge &amp; split</span>
        <button className="btn" disabled={p.busy} onClick={p.onAddPdf}><Icon name="merge" size={16} />Add pages from another PDF</button>
        <div className="row">
          <label className="field-label" style={{ flex: 1 }}>
            Split every
            <span className="field">
              <input type="number" min={1} value={every} onChange={(e) => setEvery(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
              <span className="unit">pages</span>
            </span>
          </label>
          <button className="btn" style={{ alignSelf: 'flex-end' }} disabled={p.busy} onClick={() => p.onSplit(every)}><Icon name="split" size={16} />Download .zip</button>
        </div>
      </div>
    </div>
  )
}
