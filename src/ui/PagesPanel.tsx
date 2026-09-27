import { useState } from 'react'
import type { Scope } from '../core/scope'
import { ScopePicker } from './ScopePicker'

interface Props {
  scope: Scope
  onScope: (s: Scope) => void
  scopeError?: string
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
      <h2>Pages</h2>
      <p className="hint">Drag thumbnails to reorder.</p>
      <ScopePicker scope={p.scope} onChange={p.onScope} error={p.scopeError} />
      <div className="actions">
        <button disabled={dis} onClick={() => p.onRotate(-90)} title="Rotate left">⟲ Rotate left</button>
        <button disabled={dis} onClick={() => p.onRotate(90)} title="Rotate right">⟳ Rotate right</button>
      </div>
      <div className="actions">
        <button disabled={dis} onClick={p.onDuplicate}>Duplicate</button>
        <button disabled={dis} className="danger" onClick={p.onDelete}>Delete</button>
      </div>
      <div className="actions">
        <button disabled={dis} onClick={p.onExtract} title="Download the chosen pages as a new PDF">Extract to new PDF</button>
      </div>

      <h3>Insert blank page</h3>
      <div className="row">
        <select value={blankSize} onChange={(e) => setBlankSize(e.target.value as typeof blankSize)} aria-label="Blank page size">
          <option value="same">Same size as current</option>
          <option value="letter">Letter (8.5×11 in)</option>
          <option value="a4">A4</option>
        </select>
      </div>
      <div className="actions">
        <button disabled={p.busy} onClick={() => p.onBlank('before', blankSize)}>Before current</button>
        <button disabled={p.busy} onClick={() => p.onBlank('after', blankSize)}>After current</button>
      </div>

      <h3>Merge &amp; split</h3>
      <div className="actions">
        <button disabled={p.busy} onClick={p.onAddPdf}>Add pages from another PDF…</button>
      </div>
      <div className="row">
        <label>
          Split every{' '}
          <input type="number" min={1} value={every} onChange={(e) => setEvery(Math.max(1, Math.floor(Number(e.target.value) || 1)))} style={{ width: '4.5em' }} />{' '}
          page(s)
        </label>
        <button disabled={p.busy} onClick={() => p.onSplit(every)}>Download .zip</button>
      </div>
    </div>
  )
}
