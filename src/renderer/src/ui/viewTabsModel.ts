import type { UiIconName } from './UiIcon'

/** The views a screen can switch between (topic mock-ups, owner 2026-10-29). */
export type ScreenView = 'tree' | 'grid' | 'list' | 'pages' | 'progress'

export const VIEW_LABELS: Readonly<Record<ScreenView, string>> = {
  tree: 'Tree',
  grid: 'Grid',
  list: 'List',
  pages: 'Pages',
  progress: 'Progress'
}

export const VIEW_ICONS: Readonly<Record<ScreenView, UiIconName>> = {
  tree: 'tree',
  grid: 'grid',
  list: 'list',
  pages: 'file',
  progress: 'trend'
}
