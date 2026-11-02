import { createElement, type JSX } from 'react'
import type { DrawerId } from '../../shell/drawerUrl'
import { PagesDrawer, type PagesDrawerId } from './PagesDrawer'
import type { PagesDrawerContext } from './params'
import './drawers.css'

const IDS: readonly PagesDrawerId[] = [
  'cluster',
  'group',
  'pick-pages',
  'move-pages',
  'rename-page'
]

/**
 * The page drawers of All pages and Site structure. They open over any route
 * (a cluster from All pages, Move pages from a cluster), so the shell draws
 * them (`shell/DrawerHost.tsx` spreads this into `SHELL_DRAWERS`).
 */
export const PAGES_DRAWERS: Partial<
  Record<DrawerId, (context: PagesDrawerContext) => JSX.Element>
> = Object.fromEntries(
  IDS.map((id) => [
    id,
    (context: PagesDrawerContext) => createElement(PagesDrawer, { id, context })
  ])
)

export { notifyPagesChanged, usePagesRevision } from './changes'
export type { MoveResult } from './MovePagesDrawer'
