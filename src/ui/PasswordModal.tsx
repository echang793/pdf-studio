import { useState } from 'react'
import { Icon } from './icons'

/** Ask for the password of a protected PDF. `error` shows after a wrong try. */
export function PasswordModal({ file, error, onSubmit, onCancel }: { file: string; error?: string; onSubmit: (pw: string) => void; onCancel: () => void }) {
  const [pw, setPw] = useState('')
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="modal" role="dialog" aria-label="Password" onSubmit={(e) => { e.preventDefault(); onSubmit(pw) }} style={{ maxWidth: 420 }}>
        <div className="panel-head">
          <h2>Password needed</h2>
          <p className="hint">“{file}” is password-protected. Enter its password to open it. It’s used only here, in your browser.</p>
        </div>
        <label className="field-label">
          Password
          <span className="field"><input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" /></span>
        </label>
        {error && <p className="hint" style={{ color: 'var(--accent)' }}>{error}</p>}
        <div className="grid2">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn primary"><Icon name="check" size={16} stroke={2.2} />Open</button>
        </div>
      </form>
    </div>
  )
}
