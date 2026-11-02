import { useMemo } from 'react'
import type { ScopeOptions } from '../../scope'
import { useDrawerStack } from '../../shell/drawers'
import { useDrawerLevel, type DrawerCrumb } from '../../ui'
import type { PagesDrawerContext } from './params'

/**
 * The trail of a drawer stacked on a cluster or group drawer, with that
 * drawer's crumb named after its cluster or group ("Money pages", not
 * "Group"). Undefined when nothing is under it: the router's trail stands.
 */
export function useStackedCrumbs(
  context: PagesDrawerContext,
  options: ScopeOptions | null
): readonly DrawerCrumb[] | undefined {
  const level = useDrawerLevel()
  const { stack } = useDrawerStack()
  const below = context.depth > 0 ? stack[context.depth - 1] : undefined
  return useMemo(() => {
    if (!level || !below || level.crumbs.length === 0) return undefined
    const sets =
      below.id === 'group' ? options?.groups : below.id === 'cluster' ? options?.clusters : null
    const id = below.params[below.id === 'group' ? 'group.id' : 'cluster.id']
    const name = sets?.find((set) => set.id === id)?.name
    if (!name) return undefined
    const crumbs = [...level.crumbs]
    const last = crumbs[crumbs.length - 1]
    if (last) crumbs[crumbs.length - 1] = { ...last, label: name }
    return crumbs
  }, [level, below, options])
}
