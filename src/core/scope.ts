import { parsePageRange } from './pageRange'

export type ScopeMode = 'current' | 'all' | 'odd' | 'even' | 'custom' | 'selected'
export interface Scope { mode: ScopeMode; range: string }

/** Turn a scope choice into page ids (document order), or a user-facing error. */
export function resolveScope(
  scope: Scope,
  pages: { id: string }[],
  current: string | null,
  selected?: ReadonlySet<string>,
): { ids: string[]; error?: undefined } | { ids: []; error: string } {
  if (scope.mode === 'current') return current ? { ids: [current] } : { ids: [], error: 'No page selected' }
  if (scope.mode === 'selected') {
    const ids = selected ? pages.filter((p) => selected.has(p.id)).map((p) => p.id) : []
    return ids.length ? { ids } : { ids: [], error: 'No pages selected' }
  }
  try {
    const spec = scope.mode === 'custom' ? scope.range : scope.mode
    return { ids: parsePageRange(spec, pages.length).map((i) => pages[i].id) }
  } catch (e) {
    return { ids: [], error: e instanceof Error ? e.message : String(e) }
  }
}
