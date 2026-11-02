import { useCallback, useMemo } from 'react'
import { setDrawerParams } from '../../shell/drawers'
import type { DrawerEntry } from '../../shell/drawerUrl'
import { formatList, parseList } from '../../utils/queryState'

/** What every page drawer gets from the shell: its entry on the URL, its depth, the project. */
export interface PagesDrawerContext {
  entry: DrawerEntry
  depth: number
  projectId: string
}

/** One value a drawer keeps on the URL. Typing rewrites in place; `push` makes a Back step. */
export function useDrawerValue(
  context: PagesDrawerContext,
  key: string,
  options: { push?: boolean } = {}
): [string, (value: string | null) => void] {
  const { entry, depth } = context
  const value = entry.params[key] ?? ''
  const push = options.push === true
  const set = useCallback(
    (next: string | null) => setDrawerParams(depth, { [key]: next || null }, { push }),
    [depth, key, push]
  )
  return [value, set]
}

/** A comma list a drawer keeps on the URL (picked rows, page ids). */
export function useDrawerList(
  context: PagesDrawerContext,
  key: string
): [readonly string[], (ids: readonly string[]) => void] {
  const [raw, setRaw] = useDrawerValue(context, key)
  const list = useMemo(() => parseList(raw), [raw])
  const set = useCallback((ids: readonly string[]) => setRaw(formatList(ids)), [setRaw])
  return [list, set]
}
