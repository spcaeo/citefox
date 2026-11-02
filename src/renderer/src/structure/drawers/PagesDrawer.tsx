import { lazy, Suspense, type JSX } from 'react'
import type { PagesDrawerContext } from './params'

const ClusterDrawer = lazy(() =>
  import('./ClusterDrawer').then((module) => ({ default: module.ClusterDrawer }))
)
const GroupDrawer = lazy(() =>
  import('./GroupDrawer').then((module) => ({ default: module.GroupDrawer }))
)
const PickPagesDrawer = lazy(() =>
  import('./PickPagesDrawer').then((module) => ({ default: module.PickPagesDrawer }))
)
const MovePagesDrawer = lazy(() =>
  import('./MovePagesDrawer').then((module) => ({ default: module.MovePagesDrawer }))
)
const RenamePageDrawer = lazy(() =>
  import('./RenamePageDrawer').then((module) => ({ default: module.RenamePageDrawer }))
)

export type PagesDrawerId = 'cluster' | 'group' | 'pick-pages' | 'move-pages' | 'rename-page'

/** One page drawer, loaded on first open. */
export function PagesDrawer({
  id,
  context
}: {
  id: PagesDrawerId
  context: PagesDrawerContext
}): JSX.Element {
  return (
    <Suspense fallback={null}>
      {id === 'cluster' ? <ClusterDrawer context={context} /> : null}
      {id === 'group' ? <GroupDrawer context={context} /> : null}
      {id === 'pick-pages' ? <PickPagesDrawer context={context} /> : null}
      {id === 'move-pages' ? <MovePagesDrawer context={context} /> : null}
      {id === 'rename-page' ? <RenamePageDrawer context={context} /> : null}
    </Suspense>
  )
}
