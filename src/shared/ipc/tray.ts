/** Tray line and tray menu. */

import type { TrayMenu } from '../domain'
import { invoke, invokeWith, type InvokeChannelSpecs } from './contract'
import type { ProjectIdRequest } from './projects'

/**
 * Sidebar tray line (FR-24.8).
 * The menu is `tray:getMenu`. This is only the two facts the sidebar prints.
 */
export interface TrayLine {
  projectId: string
  /** True while the tray icon is running. The line renders either way. */
  running: boolean
  /** Tracked pages in this project whose next check is today. 0 when the project is paused. */
  pagesDueToday: number
}

/** Invoke channels for this area. Each one is declared here only. */
export const trayChannels = {
  'tray:getLine': invokeWith<ProjectIdRequest, TrayLine>(),
  'tray:getMenu': invoke<TrayMenu>()
} as const satisfies InvokeChannelSpecs
