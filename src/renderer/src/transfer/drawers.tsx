import type { JSX } from 'react'
import type { DrawerEntry, DrawerId } from '../shell/drawerUrl'
import { closeDrawer, setDrawerParams } from '../shell/drawers'
import { ExportProjectDrawer } from './ExportProjectDrawer'
import { ImportProjectDrawer } from './ImportProjectDrawer'
import { ImportSettingsDrawer } from './ImportSettingsDrawer'

export interface TransferDrawerContext {
  entry: DrawerEntry
  depth: number
  /** A project was imported or an import undone: the project list reads again. */
  onProjectsChanged: () => void
  /** App settings were applied: the shell reads them again. */
  onSettingsChanged: () => void
}

/**
 * Moving to a new Mac. These drawers need no open project (a fresh install
 * imports its first project), so the shell draws them even with none.
 */
export const TRANSFER_DRAWERS: Partial<
  Record<DrawerId, (context: TransferDrawerContext) => JSX.Element | null>
> = {
  'export-project': ({ entry, depth }) => (
    <ExportProjectDrawer
      key={entry.params['ep.project'] ?? ''}
      projectId={entry.params['ep.project'] ?? ''}
      includeResults={entry.params['ep.results'] === '1'}
      onIncludeResults={(value) => setDrawerParams(depth, { 'ep.results': value ? '1' : null })}
      onClose={() => closeDrawer(depth)}
    />
  ),
  'import-project': ({ entry, depth, onProjectsChanged }) => (
    <ImportProjectDrawer
      key={entry.params['ip.file'] ?? ''}
      token={entry.params['ip.file'] ?? ''}
      mode={entry.params['ip.mode'] === 'replace' ? 'replace' : 'new'}
      targetId={entry.params['ip.target'] ?? null}
      onChoice={(mode, targetId) =>
        setDrawerParams(depth, {
          'ip.mode': mode === 'replace' ? 'replace' : null,
          'ip.target': mode === 'replace' ? targetId : null
        })
      }
      onClose={() => closeDrawer(depth)}
      onProjectsChanged={onProjectsChanged}
    />
  ),
  'import-settings': ({ entry, depth, onSettingsChanged }) => (
    <ImportSettingsDrawer
      key={entry.params['is.file'] ?? ''}
      token={entry.params['is.file'] ?? ''}
      onClose={() => closeDrawer(depth)}
      onSettingsChanged={onSettingsChanged}
    />
  )
}
