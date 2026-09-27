/**
 * Coordinate helpers. "Unrotated" = PDF user space (origin bottom-left, y up) of the page's MediaBox.
 * "Display" = what the viewer sees after /Rotate (clockwise), origin top-left, y down, in points.
 */
export type Rotation = 0 | 90 | 180 | 270
export interface Box { x: number; y: number; width: number; height: number }
export interface Point { x: number; y: number }
export interface Size { width: number; height: number }
export interface Margins { top: number; right: number; bottom: number; left: number }
export type Unit = 'pt' | 'in' | 'mm'

const PER_UNIT: Record<Unit, number> = { pt: 1, in: 72, mm: 72 / 25.4 }
export const toPt = (v: number, u: Unit) => v * PER_UNIT[u]
export const fromPt = (v: number, u: Unit) => v / PER_UNIT[u]

export function normRotation(deg: number): Rotation {
  const r = (((Math.round(deg / 90) * 90) % 360) + 360) % 360
  return r as Rotation
}

export function displaySize(media: Box, rot: Rotation): Size {
  return rot === 90 || rot === 270
    ? { width: media.height, height: media.width }
    : { width: media.width, height: media.height }
}

export function toDisplay(media: Box, rot: Rotation, p: Point): Point {
  const u = p.x - media.x
  const v = p.y - media.y
  const { width: W, height: H } = media
  switch (rot) {
    case 0: return { x: u, y: H - v }
    case 90: return { x: v, y: u }
    case 180: return { x: W - u, y: v }
    case 270: return { x: H - v, y: W - u }
  }
}

export function fromDisplay(media: Box, rot: Rotation, d: Point): Point {
  const { width: W, height: H } = media
  let u: number, v: number
  switch (rot) {
    case 0: u = d.x; v = H - d.y; break
    case 90: u = d.y; v = d.x; break
    case 180: u = W - d.x; v = d.y; break
    case 270: u = W - d.y; v = H - d.x; break
  }
  return { x: u + media.x, y: v + media.y }
}

function rectFromCorners(a: Point, b: Point): Box {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}

/** Unrotated box -> display rect (x,y = top-left). */
export function rectToDisplay(media: Box, rot: Rotation, r: Box): Box {
  return rectFromCorners(toDisplay(media, rot, r), toDisplay(media, rot, { x: r.x + r.width, y: r.y + r.height }))
}

/** Display rect (x,y = top-left) -> unrotated box. */
export function rectFromDisplay(media: Box, rot: Rotation, d: Box): Box {
  return rectFromCorners(fromDisplay(media, rot, d), fromDisplay(media, rot, { x: d.x + d.width, y: d.y + d.height }))
}

export const MIN_SIZE = 1

/** Clamp display margins so the remaining area is inside the page and at least MIN_SIZE wide/tall. */
export function clampMargins(size: Size, m: Margins): Margins {
  const c = (v: number) => (Number.isFinite(v) ? Math.max(0, v) : 0)
  let { top, right, bottom, left } = { top: c(m.top), right: c(m.right), bottom: c(m.bottom), left: c(m.left) }
  right = Math.min(right, size.width - MIN_SIZE)
  left = Math.min(left, size.width - MIN_SIZE - right)
  bottom = Math.min(bottom, size.height - MIN_SIZE)
  top = Math.min(top, size.height - MIN_SIZE - bottom)
  return { top, right, bottom, left }
}

/** Display margins (pt) -> unrotated crop box. */
export function marginsToBox(media: Box, rot: Rotation, m: Margins): Box {
  const size = displaySize(media, rot)
  const c = clampMargins(size, m)
  const d: Box = { x: c.left, y: c.top, width: size.width - c.left - c.right, height: size.height - c.top - c.bottom }
  return rectFromDisplay(media, rot, d)
}

/** Unrotated crop box -> display margins (pt). */
export function boxToMargins(media: Box, rot: Rotation, box: Box): Margins {
  const size = displaySize(media, rot)
  const d = rectToDisplay(media, rot, box)
  return { top: d.y, left: d.x, right: size.width - d.x - d.width, bottom: size.height - d.y - d.height }
}

/** Intersect box with media (crop boxes outside the media box are meaningless). */
export function clampToMedia(media: Box, b: Box): Box {
  const x0 = Math.max(media.x, b.x)
  const y0 = Math.max(media.y, b.y)
  const x1 = Math.min(media.x + media.width, b.x + b.width)
  const y1 = Math.min(media.y + media.height, b.y + b.height)
  if (x1 - x0 < MIN_SIZE || y1 - y0 < MIN_SIZE) return { ...media }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}
