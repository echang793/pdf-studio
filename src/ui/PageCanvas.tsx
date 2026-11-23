import { useEffect, useRef, useState } from 'react'
import { displaySize } from '../core/geometry'
import type { PageRef } from '../core/model'
import { renderPage } from '../render/pdfjs'

/** Canvas showing a page's full media box at `scale` px/pt. Re-renders only when geometry changes. */
export function PageCanvas({ page, scale, className }: { page: PageRef; scale: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)
  const size = displaySize(page.media, page.rotation)
  const { src, srcIndex, rotation, media } = page
  const baseKey = page.base?.asset ?? null

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const job = renderPage({ ...page, src, srcIndex, rotation, media }, canvas, scale)
    job.promise.then(() => setError(null), (e) => setError(e instanceof Error ? e.message : String(e)))
    return job.cancel
    // eslint-disable-next-line react-hooks/exhaustive-deps -- geometry fields below are the real inputs
  }, [src, srcIndex, rotation, baseKey, media.x, media.y, media.width, media.height, scale])

  return (
    <>
      <canvas ref={ref} className={className} style={{ width: size.width * scale, height: size.height * scale }} />
      {error && <div className="render-error">Render failed: {error}</div>}
    </>
  )
}
