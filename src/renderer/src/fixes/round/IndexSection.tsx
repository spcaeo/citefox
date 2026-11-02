import { useEffect, useState, type JSX } from 'react'
import type { ChangeLedger, IndexCheckPreview } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { SendToGoogle } from '../../changes/cells'
import { drillCell, pagesDrill } from '../../changes/drills'
import { INDEX_LABELS, type IndexBucket } from '../../changes/model'
import { useDrill } from '../../drill'
import { cleanError } from '../../progress/model'
import { Button, Confirm, ListGrid, SectionHead, UrlText, type ListColumn } from '../../ui'
import { pathOf } from '../model'
import type { ProjectFixesSource } from '../source'
import {
  indexByDays,
  indexPageIds,
  notIndexedRows,
  previewLine,
  type IndexBucketRow
} from './model'

const BUCKETS: readonly IndexBucket[] = ['indexed', 'not_indexed', 'not_checked']

/**
 * Google index: "Check index" asks what it would spend (`fixes:indexPreview`) and
 * shows it in the one small confirm (`?index=confirm`); only its "Check index"
 * spends searches (`fixes:checkIndex`). Under it, the changed pages by days live and what Google
 * shows for each, every count opening its pages.
 */
export function IndexSection({
  ledger,
  projectId,
  client,
  confirming,
  onConfirming,
  onChecked
}: {
  ledger: ChangeLedger
  projectId: string
  client: ProjectFixesSource
  confirming: boolean
  onConfirming: (open: boolean) => void
  onChecked: () => void
}): JSX.Element {
  const { open } = useDrill()
  const pageIds = indexPageIds(ledger)
  const [notice, setNotice] = useState<string | null>(null)
  const notIndexed = notIndexedRows(ledger)
  const columns: readonly ListColumn<IndexBucketRow>[] = [
    { id: 'days', label: 'Days live', width: 'fill', minWidth: 140, render: (row) => row.label },
    {
      id: 'pages',
      label: 'Changed pages',
      width: 132,
      numeric: true,
      render: (row) => row.rows.length,
      drill: (row) =>
        row.rows.length === 0
          ? null
          : drillCell(
              open,
              pagesDrill(ledger, row.rows, {
                id: `index:${row.id}:all`,
                title: `Changed pages live ${row.label}`,
                description: 'The newest change on each page, by days live.'
              })
            )
    },
    ...BUCKETS.map((bucket): ListColumn<IndexBucketRow> => ({
      id: bucket,
      label: INDEX_LABELS[bucket],
      width: 120,
      numeric: true,
      render: (row) => row.byIndex[bucket].length,
      drill: (row) =>
        row.byIndex[bucket].length === 0
          ? null
          : drillCell(
              open,
              pagesDrill(ledger, row.byIndex[bucket], {
                id: `index:${row.id}:${bucket}`,
                title: `${INDEX_LABELS[bucket]} · live ${row.label}`,
                description: 'From each page’s last “Check index”.'
              })
            )
    }))
  ]

  return (
    <section className="rnd-index" aria-labelledby="rnd-index-h">
      <SectionHead
        id="rnd-index-h"
        title="Google index"
        description="A page Google has not indexed cannot be cited, so indexing comes first."
        actions={
          <Button
            size="sm"
            icon="search"
            disabled={pageIds.length === 0 || confirming}
            onClick={() => {
              setNotice(null)
              onConfirming(true)
            }}
          >
            Check index
          </Button>
        }
      />
      {confirming ? (
        <IndexConfirm
          projectId={projectId}
          client={client}
          pageIds={pageIds}
          onCancel={() => onConfirming(false)}
          onDone={(text) => {
            setNotice(text)
            onConfirming(false)
            onChecked()
          }}
        />
      ) : null}
      <p className="muted fxp-notice" role="status">
        {notice}
      </p>
      <ListGrid<IndexBucketRow>
        label="Google index by days live"
        noun={['bucket', 'buckets']}
        rows={indexByDays(ledger)}
        rowKey={(row) => row.id}
        rowLabel={(row) => row.label}
        columns={columns}
        pageSize="all"
        summary={() => `${pluralize(pageIds.length, 'changed page')} live`}
        empty={null}
      />
      {notIndexed.length > 0 ? (
        <ul className="rnd-notindexed" aria-label="Pages Google has not indexed">
          {notIndexed.map((row) => (
            <li key={row.fixId}>
              <UrlText url={row.url} label={pathOf(row.url)} site={ledger.domain} />
              <SendToGoogle path={pathOf(row.url)} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

/** The confirm: what the check covers and spends, before anything is sent. */
function IndexConfirm({
  projectId,
  client,
  pageIds,
  onCancel,
  onDone
}: {
  projectId: string
  client: ProjectFixesSource
  pageIds: readonly string[]
  onCancel: () => void
  onDone: (notice: string) => void
}): JSX.Element {
  const [preview, setPreview] = useState<IndexCheckPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const key = pageIds.join(',')

  useEffect(() => {
    let live = true
    void Promise.resolve()
      .then(() => client['fixes:indexPreview']({ projectId, pageIds: key ? key.split(',') : [] }))
      .then(
        (next) => {
          if (live) setPreview(next)
        },
        (cause: unknown) => {
          if (live) setError(cleanError(cause, 'Could not work out what the check would use.'))
        }
      )
    return () => {
      live = false
    }
  }, [client, projectId, key])

  async function confirm(): Promise<void> {
    if (!preview) return
    setBusy(true)
    setError(null)
    try {
      const run = await client['fixes:checkIndex']({
        projectId,
        pageIds,
        confirmedSearches: preview.searchesMax
      })
      const done = `Checked ${pluralize(run.results.length, 'page')} with Google · used ${pluralize(run.searchesUsed, 'search', 'searches')}.`
      onDone(run.stoppedReason ? `${done} Stopped early: ${run.stoppedReason}` : done)
    } catch (cause) {
      setError(cleanError(cause, 'Could not check the index.'))
      setBusy(false)
    }
  }

  return (
    <Confirm
      title="Check the Google index?"
      body={
        <>
          <p>
            {preview === null
              ? error
                ? null
                : 'Working out what it uses…'
              : preview.canRun
                ? previewLine(preview)
                : (preview.reason ?? 'It cannot run now.')}
          </p>
          {error ? (
            <p className="bridge-alert" role="alert">
              {error}
            </p>
          ) : null}
        </>
      }
      confirmLabel={busy ? 'Checking…' : 'Check index'}
      tone="default"
      busy={busy}
      confirmDisabled={preview === null || !preview.canRun}
      onConfirm={() => void confirm()}
      onCancel={onCancel}
    />
  )
}
