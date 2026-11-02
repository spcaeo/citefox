import type { ClusterRole } from '@shared/domain'
import type { AllPageRow } from '@shared/ipc'
import type { MenuItem } from '../../ui'
import { pageHref } from './links'
import { rowName } from './text'

/** What a row's ⋯ menu can do. Absent handlers leave their line out. */
export interface RowActions {
  open: (row: AllPageRow) => void
  track: (row: AllPageRow) => void
  finishSetup: (row: AllPageRow) => void
  checkNow: (row: AllPageRow) => void
  pause?: (row: AllPageRow) => void
  resume?: (row: AllPageRow) => void
  stop?: (row: AllPageRow) => void
  rename: (row: AllPageRow) => void
  addQuestions: (row: AllPageRow) => void
  addToGroup: (row: AllPageRow) => void
  moveToCluster: (row: AllPageRow) => void
  setRole?: (row: AllPageRow, clusterId: string, role: ClusterRole) => void
  pin: (row: AllPageRow) => void
  copyUrl: (row: AllPageRow) => void
  openLive: (row: AllPageRow) => void
}

export function isWorking(row: AllPageRow): boolean {
  return row.status === 'tracked' || row.status === 'setting_up' || row.status === 'paused'
}

/**
 * The row menu (deep audit §7b). Tracked pages: open, check, pause or resume,
 * rename, questions, group, cluster and role, pin, copy and open, and Stop
 * tracking last. Pages not tracked: track, group, copy and open, pin.
 */
export function rowMenuItems(row: AllPageRow, actions: RowActions): MenuItem[] {
  const name = rowName(row)
  const items: MenuItem[] = []
  const working = isWorking(row)
  if (working) {
    const target = pageHref(row)
    if (target && !target.external) {
      items.push({ id: 'open', label: 'Open page', icon: 'eye', onSelect: () => actions.open(row) })
    }
    if (row.status === 'setting_up') {
      items.push({
        id: 'setup',
        label: 'Finish setting up',
        icon: 'wand',
        onSelect: () => actions.finishSetup(row)
      })
    }
    if (row.status !== 'paused') {
      items.push({
        id: 'check',
        label: 'Check now…',
        icon: 'refresh',
        onSelect: () => actions.checkNow(row)
      })
    }
    if (row.status === 'paused' && actions.resume) {
      const resume = actions.resume
      items.push({
        id: 'resume',
        label: 'Resume tracking',
        icon: 'play',
        onSelect: () => resume(row)
      })
    } else if (row.status !== 'paused' && actions.pause) {
      const pause = actions.pause
      items.push({
        id: 'pause',
        label: 'Pause tracking',
        icon: 'pause',
        onSelect: () => pause(row)
      })
    }
    items.push(
      {
        id: 'rename',
        label: 'Rename…',
        icon: 'pencil',
        groupStart: true,
        onSelect: () => actions.rename(row)
      },
      {
        id: 'questions',
        label: 'Add questions…',
        icon: 'plus',
        onSelect: () => actions.addQuestions(row)
      }
    )
  } else if (row.status === 'not_tracked' || row.status === 'removed') {
    items.push({
      id: 'track',
      label: 'Track this page',
      icon: 'plus',
      onSelect: () => actions.track(row)
    })
  }
  items.push({
    id: 'group',
    label: 'Add to group…',
    icon: 'layers',
    groupStart: true,
    onSelect: () => actions.addToGroup(row)
  })
  if (working) {
    items.push({
      id: 'cluster',
      label: 'Move to cluster…',
      icon: 'arrow-right',
      onSelect: () => actions.moveToCluster(row)
    })
    const cluster = row.clusters?.[0]
    if (cluster && actions.setRole) {
      const setRole = actions.setRole
      items.push(
        {
          id: 'pillar',
          label: `Set as pillar of ${cluster.name}`,
          icon: 'target',
          onSelect: () => setRole(row, cluster.id, 'pillar')
        },
        {
          id: 'support',
          label: 'Set as supporting',
          icon: 'layers',
          onSelect: () => setRole(row, cluster.id, 'supporting')
        }
      )
    }
  }
  if (row.status !== 'removed') {
    items.push({
      id: 'pin',
      label: row.pinned ? `Unpin ${name}` : `Pin ${name}`,
      icon: 'target',
      groupStart: true,
      onSelect: () => actions.pin(row)
    })
  }
  items.push(
    {
      id: 'copy',
      label: 'Copy URL',
      icon: 'copy',
      groupStart: row.status === 'removed',
      onSelect: () => actions.copyUrl(row)
    },
    {
      id: 'live',
      label: 'Open live page',
      icon: 'external',
      onSelect: () => actions.openLive(row)
    }
  )
  if (working && actions.stop) {
    const stop = actions.stop
    items.push({
      id: 'stop',
      label: 'Stop tracking…',
      icon: 'x',
      tone: 'danger',
      groupStart: true,
      onSelect: () => stop(row)
    })
  }
  return items
}
