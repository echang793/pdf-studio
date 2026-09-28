import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { displaySize, rectToDisplay } from '../core/geometry'
import type { PageRef } from '../core/model'
import { Icon } from './icons'
import { PageCanvas } from './PageCanvas'

const THUMB_W = 104

export interface ClickMods { shiftKey: boolean; toggle: boolean }

function Thumb({ page, index, active, picked, onSelect }: { page: PageRef; index: number; active: boolean; picked: boolean; onSelect: (mods: ClickMods) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id })
  const full = displaySize(page.media, page.rotation)
  const crop = rectToDisplay(page.media, page.rotation, page.crop)
  // Scale so the *cropped* page fits the thumb width; show only the crop window.
  const scale = THUMB_W / crop.width
  const h = Math.min(crop.height * scale, THUMB_W * 1.5)
  const cropped = crop.width < full.width - 0.5 || crop.height < full.height - 0.5
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className={`thumb ${active ? 'active' : ''} ${picked ? 'picked' : ''}`}
      aria-label={`Page ${index + 1}${cropped ? ', cropped' : ''}${picked ? ', selected' : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={(e) => onSelect({ shiftKey: e.shiftKey, toggle: e.metaKey || e.ctrlKey })}
      {...attributes}
      {...listeners}
    >
      <div className="thumb-frame">
        <div className="thumb-window" style={{ width: THUMB_W, height: h }}>
          <div style={{ position: 'absolute', left: -crop.x * scale, top: -crop.y * scale }}>
            <PageCanvas page={page} scale={scale} />
          </div>
        </div>
        {picked && <span className="pick-badge"><Icon name="check" size={12} stroke={2.8} label="Selected" /></span>}
        {(cropped || page.annots.length > 0) && (
          <span className="thumb-badges">
            {cropped && <span className="badge" title="Cropped"><Icon name="crop" size={12} stroke={2.6} label="Cropped" /></span>}
            {page.annots.length > 0 && <span className="badge" title="Has edits"><Icon name="edit" size={12} stroke={2.6} label="Has edits" /></span>}
          </span>
        )}
      </div>
      <span className="thumb-label">{String(index + 1).padStart(2, '0')}</span>
    </li>
  )
}

export function ThumbRail({
  pages, current, picked, onSelect, onMove,
}: {
  pages: PageRef[]
  current: string | null
  /** Ids of pages in the active multi-selection (may include `current`). */
  picked: ReadonlySet<string>
  onSelect: (id: string, mods: ClickMods) => void
  onMove: (from: number, to: number) => void
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const end = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const from = pages.findIndex((p) => p.id === e.active.id)
    const to = pages.findIndex((p) => p.id === e.over!.id)
    onMove(from, to)
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={end}>
      <SortableContext items={pages.map((p) => p.id)} strategy={rectSortingStrategy}>
        <ol className="thumbs" aria-label="Pages (drag to reorder, shift- or cmd-click to select several)">
          {pages.map((p, i) => (
            <Thumb key={p.id} page={p} index={i} active={p.id === current} picked={picked.has(p.id)} onSelect={(mods) => onSelect(p.id, mods)} />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  )
}
