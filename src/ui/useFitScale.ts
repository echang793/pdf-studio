import { useEffect, useState, type RefObject } from 'react'
import type { Size } from '../core/geometry'

/** Scale (px per pt) that fits `size` inside the element, tracking resizes. */
export function useFitScale(ref: RefObject<HTMLElement | null>, size: Size, pad = 40): number {
  const [box, setBox] = useState({ width: 800, height: 600 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect
      setBox((b) => (b.width === width && b.height === height ? b : { width, height }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  })
  const s = Math.min((box.width - pad) / size.width, (box.height - pad) / size.height)
  return Number.isFinite(s) && s > 0 ? Math.max(0.1, s) : 1
}
