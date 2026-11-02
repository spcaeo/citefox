import { useMemo, type JSX } from 'react'
import type { PlaygroundRunResult } from '@shared/ipc'
import { EmptyState, ListGrid, SectionHead, UrlText, type ListColumn } from '../../ui'

/** Room for every kept run, so the page scrolls, never the list. */
const ROW_PX = 48

/**
 * This session's playground runs, newest first, as the v2 list grid. Opening
 * a row shows that run's output again.
 */
export function RunHistory({
  runs,
  currentId,
  onOpen
}: {
  /** Newest first. */
  runs: readonly PlaygroundRunResult[]
  currentId: string | null
  onOpen: (run: PlaygroundRunResult) => void
}): JSX.Element {
  const columns = useMemo<ListColumn<PlaygroundRunResult>[]>(
    () => [
      {
        id: 'template',
        label: 'Template',
        width: 240,
        render: (run) => <span className="pg-tpl-name">{run.templateName}</span>
      },
      {
        id: 'url',
        label: 'URL',
        width: 'fill',
        minWidth: 220,
        render: (run) => <UrlText url={run.url} />
      }
    ],
    []
  )
  return (
    <section className="pg-history" aria-labelledby="history-h">
      <SectionHead id="history-h" title="Run history" count={runs.length} />
      <ListGrid<PlaygroundRunResult>
        label="Run history"
        noun={['run', 'runs']}
        rows={runs}
        rowKey={(run) => run.runId}
        rowLabel={(run) => `${run.templateName} · ${run.url}`}
        columns={columns}
        onActivate={onOpen}
        isRowCurrent={(run) => run.runId === currentId}
        pageSize="all"
        maxBodyHeight={Math.max(runs.length, 1) * ROW_PX}
        summary={() => (runs.length === 1 ? '1 run' : `${runs.length} runs`)}
        empty={
          <EmptyState icon="inbox" title="No runs yet." body="Run a template to see it here." />
        }
      />
    </section>
  )
}
