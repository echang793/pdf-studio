import type { Box, Size } from './geometry'

export type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

/** New rect after dragging handle `h` by (dx, dy) px, kept inside bounds and at least `min` in size. */
export function dragRect(start: Box, h: Handle, dx: number, dy: number, bounds: Size, min: number, lockAspect: boolean): Box {
  let { x, y, width: w, height: hgt } = start
  if (h === 'move') {
    x = Math.min(Math.max(0, x + dx), bounds.width - w)
    y = Math.min(Math.max(0, y + dy), bounds.height - hgt)
    return { x, y, width: w, height: hgt }
  }
  let x0 = x, y0 = y, x1 = x + w, y1 = y + hgt
  if (h.includes('w')) x0 = Math.min(Math.max(0, x0 + dx), x1 - min)
  if (h.includes('e')) x1 = Math.max(Math.min(bounds.width, x1 + dx), x0 + min)
  if (h.includes('n')) y0 = Math.min(Math.max(0, y0 + dy), y1 - min)
  if (h.includes('s')) y1 = Math.max(Math.min(bounds.height, y1 + dy), y0 + min)
  if (lockAspect && h.length === 2 && start.width > 0 && start.height > 0) {
    const ratio = start.width / start.height
    const nw = x1 - x0
    const nh = nw / ratio
    if (h.includes('n')) y0 = Math.max(0, y1 - nh)
    else y1 = Math.min(bounds.height, y0 + nh)
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}
