import { useEffect, useMemo, useState, type JSX } from 'react'
import type { PageVersion, PageVersionList } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { errorText } from '../components/errorText'
import { useChangeVersion } from '../shell/changes'
import { openDrawer } from '../shell/drawers'
import { useEngineRevision } from '../shell/engineRevision'
import { Button, Chip, EmptyState, ListGrid, type ListColumn } from '../ui'
import { formatDay, formatMoment } from '../utils/dates'
import { createPageChangesSource, type PageChangesSource } from './client'
import { versionDrawerValues } from './model'
import './pageChanges.css'

/**
 * A page's History › Page versions: every version CiteFox read (the newest 24),
 * the dates the page stated, what changed since the one before, and whether it
 * was logged as a fix. "See what changed" opens the two reads side by side.
 */
export function VersionsPanel({
  projectId,
  pageId,
  source
}: {
  projectId: string
  pageId: string
  source?: Pick<PageChangesSource, 'pageChanges:versions'>
}): JSX.Element {
  const client = useMemo(() => source ?? createPageChangesSource(), [source])
  const revision = useEngineRevision()
  const decided = useChangeVersion('pageChanges')
  const fixes = useChangeVersion('fixes')
  const [state, setState] = useState<{ list: PageVersionList | null; error: string | null }>({
    list: null,
    error: null
  })
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    let live = true
    void Promise.resolve()
      .then(() => client['pageChanges:versions']({ projectId, pageId }))
      .then(
        (list) => {
          if (live) setState({ list, error: null })
        },
        (cause: unknown) => {
          if (live)
            setState({ list: null, error: errorText(cause, 'Could not load the versions.') })
        }
      )
    return () => {
      live = false
    }
  }, [client, projectId, pageId, revision, decided, fixes, reloads])

  const list = state.list?.pageId === pageId ? state.list : null
  const open = (version: PageVersion): void => {
    if (version.previousSnapshotId === null) return
    openDrawer(
      'page-change',
      versionDrawerValues(pageId, version.previousSnapshotId, version.snapshotId)
    )
  }

  const columns: ListColumn<PageVersion>[] = [
    {
      id: 'read',
      label: 'Read',
      width: 210,
      sort: (row) => row.firstReadAt,
      render: (row) => (
        <span className="pc-version-read">
          <span>{formatMoment(row.firstReadAt)}</span>
          <span className="faint">
            {row.reads > 1
              ? `${pluralize(row.reads, 'read')}, last ${formatMoment(row.lastReadAt)}`
              : '1 read'}
          </span>
        </span>
      )
    },
    {
      id: 'published',
      label: 'Published',
      hint: 'The date the page states it was published',
      width: 128,
      sort: (row) => row.publishedAt,
      render: (row) =>
        row.publishedAt ? formatDay(row.publishedAt) : <span className="faint">—</span>
    },
    {
      id: 'updated',
      label: 'Updated',
      hint: 'The "Updated" date the page states',
      width: 128,
      sort: (row) => row.modifiedAt,
      render: (row) =>
        row.modifiedAt ? formatDay(row.modifiedAt) : <span className="faint">—</span>
    },
    {
      id: 'changed',
      label: 'What changed',
      width: 'fill',
      minWidth: 240,
      wrap: true,
      sort: false,
      render: (row) =>
        row.previousSnapshotId === null ? (
          <span className="faint">The oldest version kept</span>
        ) : (
          <span className="pc-version-change">
            <span>{row.sentence}</span>
            {row.change ? <StateChip version={row} /> : null}
          </span>
        )
    },
    {
      id: 'words',
      label: 'Words',
      width: 88,
      numeric: true,
      sort: (row) => row.wordCount,
      render: (row) => row.wordCount.toLocaleString('en-US')
    },
    {
      id: 'open',
      label: 'Compare',
      hideLabel: true,
      width: 168,
      sort: false,
      render: (row) =>
        row.previousSnapshotId === null ? null : (
          <Button size="sm" variant="ghost" onClick={() => open(row)}>
            See what changed
          </Button>
        )
    }
  ]

  return (
    <div className="pc-versions">
      <p className="muted">
        Each time CiteFox reads this page it keeps the text. A new version starts when the text
        changes. The newest 24 versions are kept.
      </p>
      <ListGrid
        label="Page versions"
        noun={['version', 'versions']}
        rows={list?.versions ?? []}
        rowKey={(row) => row.snapshotId}
        rowLabel={(row) => `Version read ${formatMoment(row.firstReadAt)}`}
        columns={columns}
        urlKey="pv"
        loading={list === null && state.error === null}
        error={
          state.error ? { message: state.error, onRetry: () => setReloads((n) => n + 1) } : null
        }
        onActivate={open}
        rowAlign="start"
        footer="paged"
        empty={
          <EmptyState
            title="No page reads yet."
            body="CiteFox keeps a version each time it reads the page."
          />
        }
      />
    </div>
  )
}

function StateChip({ version }: { version: PageVersion }): JSX.Element | null {
  const change = version.change
  if (!change) return null
  if (change.state === 'linked') {
    return (
      <Chip tone="ok" size="sm">
        Logged as fix {change.fixNumber ?? ''}
      </Chip>
    )
  }
  if (change.state === 'dismissed') {
    return (
      <Chip tone="neutral" size="sm">
        Not a fix
      </Chip>
    )
  }
  return (
    <Chip tone="fox" size="sm">
      Changed, not logged
    </Chip>
  )
}
