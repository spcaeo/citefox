import { useCallback, useMemo, useState } from 'react'
import type { ClusterRole } from '@shared/domain'
import type { AllPageRow, StoppedPage } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { copyText } from '../../components/clipboard'
import { openTarget } from '../../drill'
import { messageOf } from '../../grid/hooks/useSavedViews'
import { openDrawer } from '../../shell/drawers'
import type { MoveResult } from '../../structure/drawers'
import type { BulkDrawerActions } from '../components/BulkActions'
import type { AllPagesSource } from '../source'
import { setupHref } from '../utils/links'
import type { RowActions } from '../utils/rowMenu'
import { rowName } from '../utils/text'

/** The line above the grid: what the last action did, with Undo when it can be undone. */
export interface Notice {
  text: string
  undo?: () => void
}

export interface RowActionsState {
  actions: RowActions
  drawers: BulkDrawerActions
  notice: Notice | null
  setNotice: (notice: Notice | null) => void
  /** The page waiting on "Stop tracking …?". */
  stopping: AllPageRow | null
  confirmStop: () => void
  cancelStop: () => void
  stopBusy: boolean
  /** Undo for a bulk Stop tracking. */
  undoStopped: (pages: readonly StoppedPage[]) => void
}

/**
 * The row menu and bulk drawers of All pages (deep audit §7b): each action
 * reports on the notice line and reloads the rows; Stop tracking asks first
 * and offers Undo (`allpages:undoTrack` with the status it had).
 */
export function useRowActions({
  source,
  projectId,
  reloadRows,
  onOpenPage,
  onPin,
  onTrack,
  setPageRole
}: {
  source: AllPagesSource
  projectId: string | null
  reloadRows: () => void
  onOpenPage: (pageId: string) => void
  onPin: (row: AllPageRow) => void
  onTrack: (row: AllPageRow) => void
  setPageRole: ((pageId: string, clusterId: string, role: ClusterRole) => Promise<unknown>) | null
}): RowActionsState {
  const [notice, setNotice] = useState<Notice | null>(null)
  const [stopping, setStopping] = useState<AllPageRow | null>(null)
  const [stopBusy, setStopBusy] = useState(false)

  const report = useCallback(
    (promise: Promise<unknown>, text: string, failed: string, undo?: () => void) => {
      promise.then(
        () => {
          setNotice(undo ? { text, undo } : { text })
          reloadRows()
        },
        (cause: unknown) => setNotice({ text: messageOf(cause, failed) })
      )
    },
    [reloadRows]
  )

  const fromDrawer = useCallback(
    (result: unknown) => {
      const message = (result as MoveResult | undefined)?.message
      if (message) setNotice({ text: message })
      reloadRows()
    },
    [reloadRows]
  )

  const undoStopped = useCallback(
    (pages: readonly StoppedPage[]) => {
      if (projectId === null) return
      report(
        Promise.all(
          pages.map((page) =>
            source.undoTrack({
              projectId,
              pageId: page.pageId,
              previousStatus: page.previousStatus
            })
          )
        ),
        `Tracking ${pluralize(pages.length, 'page')} again, as before.`,
        'Could not undo. Track the pages again from the list.'
      )
    },
    [projectId, report, source]
  )

  const { updatePage, removePage } = source
  const actions = useMemo<RowActions>(() => {
    const move = (row: AllPageRow, to: 'cluster' | 'group'): void =>
      openDrawer('move-pages', { 'move.ids': row.id, 'move.to': to }, { onResult: fromDrawer })
    const setStatus = (row: AllPageRow, status: 'paused' | 'tracked'): void => {
      if (projectId === null || !updatePage) return
      report(
        updatePage({ projectId, pageId: row.id, status }),
        status === 'paused'
          ? `Paused ${rowName(row)}. History is kept; no searches run until you resume.`
          : `Resumed ${rowName(row)}. It is checked again at its next check.`,
        'Could not change the page.'
      )
    }
    return {
      open: (row) => onOpenPage(row.id),
      track: onTrack,
      finishSetup: (row) => {
        window.location.hash = setupHref(row)
      },
      checkNow: (row) => openDrawer('check-now', { 'check.scope': 'pages', 'check.ids': row.id }),
      ...(updatePage
        ? {
            pause: (row: AllPageRow) => setStatus(row, 'paused'),
            resume: (row: AllPageRow) => setStatus(row, 'tracked')
          }
        : {}),
      ...(removePage ? { stop: (row: AllPageRow) => setStopping(row) } : {}),
      rename: (row) => openDrawer('rename-page', { 'rename.id': row.id }, { onResult: fromDrawer }),
      addQuestions: (row) => openDrawer('add-questions', { target: row.id }),
      addToGroup: (row) => move(row, 'group'),
      moveToCluster: (row) => move(row, 'cluster'),
      ...(setPageRole
        ? {
            setRole: (row: AllPageRow, clusterId: string, role: ClusterRole) =>
              report(
                setPageRole(row.id, clusterId, role),
                `${rowName(row)} is now ${role === 'pillar' ? 'the pillar of its cluster' : 'a supporting page'}.`,
                'Could not set the role.'
              )
          }
        : {}),
      pin: onPin,
      copyUrl: (row) => {
        void copyText(row.url).then((ok) =>
          setNotice({ text: ok ? `Copied ${row.url}` : 'Could not copy the URL.' })
        )
      },
      openLive: (row) => openTarget({ kind: 'url', url: row.url })
    }
  }, [
    fromDrawer,
    onOpenPage,
    onPin,
    onTrack,
    projectId,
    report,
    setPageRole,
    updatePage,
    removePage
  ])

  const drawers = useMemo<BulkDrawerActions>(
    () => ({
      checkNow: (ids) =>
        openDrawer('check-now', { 'check.scope': 'pages', 'check.ids': ids.join(',') }),
      move: (ids, to, fresh) =>
        openDrawer(
          'move-pages',
          { 'move.ids': ids.join(','), 'move.to': to, ...(fresh ? { 'move.pick': 'new' } : {}) },
          { onResult: fromDrawer }
        ),
      addQuestions: (id) => openDrawer('add-questions', { target: id })
    }),
    [fromDrawer]
  )

  const confirmStop = useCallback(() => {
    const row = stopping
    if (row === null || projectId === null || !removePage) return
    setStopBusy(true)
    const previousStatus = row.status
    removePage({ projectId, pageId: row.id }).then(
      () => {
        setStopBusy(false)
        setStopping(null)
        setNotice({
          text: `Stopped tracking ${rowName(row)}. History stays; no more searches are used.`,
          undo: () =>
            report(
              source.undoTrack({ projectId, pageId: row.id, previousStatus }),
              `Tracking ${rowName(row)} again.`,
              'Could not undo. Track the page again from its row.'
            )
        })
        reloadRows()
      },
      (cause: unknown) => {
        setStopBusy(false)
        setStopping(null)
        setNotice({ text: messageOf(cause, 'Could not stop tracking the page.') })
      }
    )
  }, [stopping, projectId, removePage, reloadRows, report, source])

  return {
    actions,
    drawers,
    notice,
    setNotice,
    stopping,
    confirmStop,
    cancelStop: () => setStopping(null),
    stopBusy,
    undoStopped
  }
}
