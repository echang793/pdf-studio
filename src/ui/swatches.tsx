import type { RGB } from '../core/model'

export const INKS: [string, RGB][] = [
  ['Black', [0.118, 0.114, 0.102]],
  ['Navy', [0.114, 0.169, 0.42]],
  ['Red', [0.702, 0.149, 0.118]],
  ['Green', [0.184, 0.369, 0.322]],
]
export const FILLS: [string, RGB][] = [
  ['White', [1, 1, 1]],
  ['Yellow', [1, 0.92, 0.2]],
  ['Mint', [0.62, 0.86, 0.74]],
  ['Pink', [1, 0.72, 0.78]],
]

export const rgbCss = (c: RGB) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`
export const sameColor = (a: RGB | null, b: RGB) => !!a && a.every((v, i) => Math.abs(v - b[i]) < 0.01)

export function Swatches({ label, list, value, onPick }: { label: string; list: [string, RGB][]; value: RGB | null; onPick: (c: RGB) => void }) {
  return (
    <div className="swatches" role="radiogroup" aria-label={label}>
      <span className="hint" style={{ minWidth: 48 }}>{label}</span>
      {list.map(([name, c]) => (
        <button key={name} role="radio" aria-checked={sameColor(value, c)} aria-label={name} className={`swatch ${sameColor(value, c) ? 'on' : ''}`} style={{ background: rgbCss(c) }} onClick={() => onPick(c)} />
      ))}
    </div>
  )
}
