import { useState, type JSX } from 'react'
import { fixKindLabel, type FixKind } from '@shared/domain'
import type { ChangeLedger, ChangeRow } from '@shared/ipc'
import { useAiContext } from '../assistant/context/useAiContext'
import { editFixValues } from '../fixes/drawer/model'
import type { ProjectFixesSource } from '../fixes/source'
import { viewPatch, type ScreenKey, type SetScreenQuery } from '../fixes/views'
import { cleanError } from '../progress/model'
import { openDrawer } from '../shell/drawers'
import { ChangeDetail } from './ChangeDetail'
import { ChangesGrid } from './ChangesGrid'
import { isShowFilter, pageName, SHOW_FILTERS, showCounts, type ShowFilter } from './model'
import { SpeedChart } from './SpeedChart'
import { PinToSummary } from '../overview/board/PinToSummary'

/**
 * Changes (`?view=changes`): how fast changes get cited, then the ledger of every
 * change with its detail in a drawer (`?row=`). The filter is `?show=`.
 */
export function ChangesView({
  ledger,
  projectId,
  client,
  query,
  setQuery,
  reload
}: {
  ledger: ChangeLedger
  projectId: string
  client: ProjectFixesSource
  query: Readonly<Record<ScreenKey, string | null>>
  setQuery: SetScreenQuery
  reload: () => void
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const show: ShowFilter = isShowFilter(query.show) ? query.show : 'all'
  const selected = ledger.rows.find((row) => row.fixId === query.row) ?? null
  const counts = showCounts(ledger.rows)
  useAiContext({
    filters:
      show === 'all' ? {} : { show: SHOW_FILTERS.find((item) => item.id === show)?.label ?? show },
    numbers: SHOW_FILTERS.map((item) => ({
      label: `Changes · ${item.label}`,
      value: String(counts[item.id])
    }))
  })

  function lost(row: ChangeRow): void {
    setQuery({ ...viewPatch('lost'), lost: row.pageId })
  }

  async function changeKind(row: ChangeRow, kind: FixKind): Promise<void> {
    setBusy(true)
    setNotice(null)
    try {
      await client['fixes:setKind']({ projectId, fixId: row.fixId, kind })
      setNotice(`${pageName(row)} is now a ${fixKindLabel(kind).toLowerCase()}.`)
    } catch (cause) {
      setNotice(cleanError(cause, 'Could not change the kind.'))
    } finally {
      setBusy(false)
      reload()
    }
  }

  return (
    <div className="fxp-view chg-view">
      {/* With nothing logged, the list's empty state says it once. */}
      {ledger.rows.length > 0 ? (
        <SpeedChart
          ledger={ledger}
          actions={
            <PinToSummary
              projectId={projectId}
              name="whether your fixes work"
              spec={{ kind: 'fixes-working', size: 'm' }}
            />
          }
        />
      ) : null}
      <p className="muted fxp-notice" role="status">
        {notice}
      </p>
      <div className="chg-ledger" data-guide="changes-ledger">
        <ChangesGrid
          ledger={ledger}
          show={show}
          selectedId={selected?.fixId ?? null}
          busy={busy}
          onShow={(value) => setQuery({ show: value === 'all' ? null : value })}
          onSelect={(row) => setQuery({ row: row.fixId })}
          onLost={lost}
          onKind={(row, kind) => void changeKind(row, kind)}
        />
      </div>
      {query.row !== null && selected === null ? (
        <p className="muted" role="status">
          That change is not in this project any more.
        </p>
      ) : null}
      {selected ? (
        <ChangeDetail
          key={selected.fixId}
          ledger={ledger}
          row={selected}
          onClose={() => setQuery({ row: null })}
          onLost={() => lost(selected)}
          onEdit={() => {
            setQuery({ row: null }, { replace: true })
            openDrawer('fix', editFixValues(selected.fixId))
          }}
        />
      ) : null}
    </div>
  )
}
