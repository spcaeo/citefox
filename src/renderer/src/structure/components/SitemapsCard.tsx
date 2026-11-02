import { useId, useMemo, useState, type FormEvent, type JSX } from 'react'
import type { SitemapOverview } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { DrillButton, DrillFigure, openTarget } from '../../drill'
import {
  Button,
  Chip,
  EmptyState,
  ListGrid,
  UrlText,
  type ListColumn,
  type MenuItem
} from '../../ui'
import { FULL_PAGE_BODY, PAGE_ROWS } from '../constants'
import type { StructureClient } from '../client'
import type { StructureDrills } from '../hooks/useStructureDrills'
import type { RunAction } from '../types'
import { childSitemapsDrill, sitemapPagesDrill } from '../utils/drills'
import {
  lastmodDay,
  orderSitemaps,
  sitemapFile,
  sitemapStatus,
  sitemapTotal,
  sitemapUrlCount,
  type SitemapRow
} from '../utils/model'
import { AsyncDrill } from './AsyncDrill'
import { SyncSettings } from './SyncSettings'

type SitemapEntry = SitemapOverview['sitemaps'][number]

/** The Sitemaps tab: the sitemap list grid, an add form, and the sync rules in the rail. */
export function SitemapsTab(props: {
  client: StructureClient
  projectId: string
  domain: string
  overview: SitemapOverview
  drills: StructureDrills
  run: RunAction
  busy: string | null
}): JSX.Element {
  return (
    <div className="str-split">
      <div className="str-main-col">
        <SitemapsGrid {...props} />
      </div>
      <SyncSettings
        client={props.client}
        projectId={props.projectId}
        overview={props.overview}
        run={props.run}
        busy={props.busy}
      />
    </div>
  )
}

function SitemapsGrid({
  client,
  projectId,
  domain,
  overview,
  drills,
  run,
  busy
}: {
  client: StructureClient
  projectId: string
  domain: string
  overview: SitemapOverview
  drills: StructureDrills
  run: RunAction
  busy: string | null
}): JSX.Element {
  const inputId = useId()
  const [url, setUrl] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const rows = useMemo(() => orderSitemaps(overview.sitemaps, []), [overview.sitemaps])
  const fromRobots = overview.sitemaps.some((record) => record.source === 'robots')
  const disabled = busy !== null

  async function onAdd(event: FormEvent): Promise<void> {
    event.preventDefault()
    const value = url.trim()
    try {
      const parsed = new URL(value)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('scheme')
    } catch {
      setFormError('Enter the sitemap’s full address, starting with https://')
      return
    }
    setFormError(null)
    const done = await run('Add sitemap', () => client['sitemaps:add']({ projectId, url: value }))
    if (done) setUrl('')
  }

  const columns: ListColumn<SitemapRow>[] = [
    {
      id: 'include',
      label: 'Include',
      width: 56,
      render: ({ record }) => {
        const file = sitemapFile(record.url)
        const isIndex = record.kind === 'index'
        return (
          <input
            type="checkbox"
            className="ui-check"
            checked={isIndex ? true : record.included}
            disabled={isIndex || disabled}
            aria-label={isIndex ? 'The sitemap index is always read' : `Include ${file}`}
            onChange={(event) => {
              const included = event.currentTarget.checked
              void run('Update sitemap', () =>
                client['sitemaps:setIncluded']({ projectId, sitemapId: record.id, included })
              )
            }}
          />
        )
      }
    },
    {
      id: 'file',
      label: 'Sitemap',
      width: 'fill',
      minWidth: 150,
      cellClassName: 'str-cell-mono',
      render: ({ record, depth }) => (
        <span
          className={record.included ? 'str-file' : 'str-file str-off'}
          style={{ paddingLeft: depth * 20 }}
        >
          <UrlText url={record.url} label={sitemapFile(record.url)} />
        </span>
      )
    },
    {
      id: 'urls',
      label: 'URLs',
      width: 88,
      numeric: true,
      render: ({ record }) => <UrlCount record={record} overview={overview} drills={drills} />
    },
    {
      id: 'changed',
      label: 'Last changed',
      width: 96,
      render: ({ record }) => lastmodDay(record.lastChangedAt)
    },
    {
      id: 'status',
      label: 'Status',
      width: 132,
      render: ({ record }) => <SitemapStatus record={record} />
    }
  ]

  function rowMenu({ record }: SitemapRow): MenuItem[] {
    const file = sitemapFile(record.url)
    const items: MenuItem[] = [
      {
        id: 'open',
        label: 'Open in your browser',
        icon: 'external',
        onSelect: () => openTarget({ kind: 'url', url: record.url })
      }
    ]
    if (record.source === 'user') {
      items.push({
        id: 'remove',
        label: `Remove ${file}`,
        icon: 'trash',
        tone: 'danger',
        disabled,
        onSelect: () =>
          void run('Remove sitemap', () =>
            client['sitemaps:remove']({ projectId, sitemapId: record.id })
          )
      })
    }
    return items
  }

  return (
    <>
      <ListGrid
        label="Sitemaps"
        noun={['sitemap', 'sitemaps']}
        rows={rows}
        rowKey={({ record }) => record.id}
        rowLabel={({ record }) => sitemapFile(record.url)}
        columns={columns}
        toolbar={
          <span className="str-bar-note">
            {fromRobots ? `Found through ${domain}/robots.txt. ` : ''}Untick a sitemap to leave its
            pages out.
          </span>
        }
        rowMenu={rowMenu}
        pageSize={PAGE_ROWS}
        maxBodyHeight={FULL_PAGE_BODY}
        summary={() => sitemapTotal(overview.sitemaps)}
        empty={
          <EmptyState
            icon="compass"
            title="No sitemaps yet"
            body={`CiteFox reads ${domain}/robots.txt, then tries /sitemap.xml and /sitemap_index.xml.`}
            action={
              <Button
                size="sm"
                busy={busy === 'Find sitemaps'}
                disabled={disabled}
                onClick={() =>
                  void run('Find sitemaps', () =>
                    client['sitemaps:discover']({ projectId, url: null })
                  )
                }
              >
                {busy === 'Find sitemaps' ? 'Finding sitemaps…' : 'Find sitemaps'}
              </Button>
            }
          />
        }
      />
      <form className="str-add" onSubmit={(event) => void onAdd(event)}>
        <label htmlFor={inputId} className="str-field-label">
          Add sitemap URL
        </label>
        <div className="str-add-row">
          <input
            id={inputId}
            className="ui-input"
            type="url"
            placeholder={`https://${domain}/news-sitemap.xml`}
            value={url}
            onChange={(event) => setUrl(event.currentTarget.value)}
            aria-describedby={formError ? `${inputId}-error` : undefined}
          />
          <Button type="submit" disabled={disabled || url.trim() === ''}>
            Add sitemap
          </Button>
        </div>
        {formError ? (
          <p id={`${inputId}-error`} className="str-error" role="alert">
            {formError}
          </p>
        ) : null}
      </form>
    </>
  )
}

function SitemapStatus({ record }: { record: SitemapEntry }): JSX.Element {
  const text = sitemapStatus(record)
  if (record.state === 'error') return <Chip tone="bad">{text}</Chip>
  if (!record.included) return <Chip tone={record.lowValue ? 'warn' : 'neutral'}>{text}</Chip>
  return <span className="str-muted">{text}</span>
}

/** A sitemap's URL count opens its pages; an index opens the sitemaps it lists. */
function UrlCount({
  record,
  overview,
  drills
}: {
  record: SitemapEntry
  overview: SitemapOverview
  drills: StructureDrills
}): JSX.Element {
  const file = sitemapFile(record.url)
  if (record.kind === 'index') {
    const drill = childSitemapsDrill(record, overview.sitemaps)
    if (drill.items.length === 0) return <>{sitemapUrlCount(record)}</>
    return (
      <DrillButton
        drill={drill}
        className="drill-num"
        label={`${file} lists ${pluralize(drill.items.length, 'sitemap')}`}
      >
        index · <DrillFigure drill={drill} />
      </DrillButton>
    )
  }
  if (record.state === 'pending' || record.pageCount === 0) return <>{sitemapUrlCount(record)}</>
  return (
    <AsyncDrill
      label={`${pluralize(record.pageCount, 'URL')} in ${file}`}
      load={async () => sitemapPagesDrill(record, (await drills.candidates()).rows)}
    >
      {sitemapUrlCount(record)}
    </AsyncDrill>
  )
}
