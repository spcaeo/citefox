import { useCallback, useContext, useMemo, type JSX } from 'react'
import { useAiContext } from '../assistant/context/useAiContext'
import { askColumn } from '../assistant/sparkle/askColumn'
import { Markdown } from '../components/Markdown'
import { safeExternalUrl } from '../drill'
import { DrillContext } from '../drill/context'
import type { ResultsDrills } from '../m3/results/drills'
import { siteColumns } from '../sites/siteColumns'
import { siteGroup, siteLine, siteLines, siteTypeName, type SiteGroup } from '../sites/siteRows'
import { useSiteTypeSettings } from '../sites/useSiteTypeSettings'
import { ListGrid, UrlText, type ListColumn, type MenuItem } from '../ui'
import { useHashQuery } from '../utils/hashQuery'
import type { CitationListRow } from './citations'

type SourceFilter = 'all' | 'target' | SiteGroup

/** The type filter, in the words of every list of sites. */
const FILTERS: readonly { id: SourceFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'target', label: 'This page' },
  { id: 'yours', label: 'Your site' },
  { id: 'competitor', label: 'Competitors' },
  { id: 'platform', label: 'Platforms' },
  { id: 'neutral', label: 'Neutral sites' }
]

const SOURCES_QUERY = ['sourceType'] as const

/**
 * "Sources Google listed": one row per cited source, as the v2 list grid. The
 * site shows as every list of sites shows it: its icon, name, website and type.
 * A row (click or Enter) opens its prompt; the site's name opens every overview
 * that cites it; the page opens in the browser; the type filter (`sourceType` in the
 * URL) narrows it. Types follow the project's hand-picked choices.
 */
export function CitationGrid({
  rows,
  onOpen,
  drills,
  projectId = null
}: {
  rows: readonly CitationListRow[]
  onOpen: (row: CitationListRow) => void
  drills?: ResultsDrills
  /** The project, so the types follow its hand-picked choices. Null: automatic types. */
  projectId?: string | null
}): JSX.Element {
  const [query, setQuery] = useHashQuery(SOURCES_QUERY)
  const kind = FILTERS.find((item) => item.id === query.sourceType)?.id ?? 'all'
  const setKind = (value: SourceFilter): void =>
    setQuery({ sourceType: value === 'all' ? null : value })
  const types = useSiteTypeSettings(projectId)
  const drillApi = useContext(DrillContext)
  useAiContext({
    filters:
      kind === 'all'
        ? {}
        : { 'source type': FILTERS.find((item) => item.id === kind)?.label ?? kind }
  })
  const lines = useMemo(
    () =>
      new Map(
        siteLines(
          rows.map((row) => ({
            key: row.id,
            domain: row.domain,
            classification: row.classification
          })),
          types.competitors,
          types.settings
        ).map((line) => [line.key, line])
      ),
    [rows, types]
  )
  const lineOf = useCallback(
    (row: CitationListRow) =>
      lines.get(row.id) ??
      siteLine({ key: row.id, domain: row.domain, classification: row.classification }),
    [lines]
  )
  const matches = useCallback(
    (row: CitationListRow, filter: SourceFilter): boolean => {
      if (filter === 'all') return true
      if (filter === 'target') return row.classification === 'target'
      // "Your site" is your other pages; this page has its own filter.
      if (filter === 'yours') return row.classification === 'own'
      return siteGroup(lineOf(row)) === filter
    },
    [lineOf]
  )
  const shown = useMemo(() => rows.filter((row) => matches(row, kind)), [rows, kind, matches])

  const columns = useMemo(
    (): ListColumn<CitationListRow>[] => [
      {
        id: 'prompt',
        label: 'Question',
        width: 'fill',
        minWidth: 200,
        sort: (row) => row.promptPosition,
        render: (row) => (
          <span className="vis-prompt" title={row.promptLabel.split('**').join('')}>
            <span className="vis-prompt-n">{row.promptPosition}.</span>{' '}
            <Markdown inline baseLevel={3}>
              {row.promptLabel}
            </Markdown>
          </span>
        )
      },
      {
        id: 'position',
        label: 'Position',
        width: 72,
        numeric: true,
        sort: (row) => row.position,
        render: (row) => row.position
      },
      ...siteColumns<CitationListRow>({
        site: (row) => ({
          domain: row.domain,
          own: row.classification !== 'competitor' && row.classification !== 'other'
        }),
        drill: (row) => drills?.get(`domain:${row.domain}`) ?? null,
        drillLabel: (row) => `${row.domain}: show the questions that cite it`,
        line: lineOf,
        nameMinWidth: 128,
        websiteWidth: 152,
        typeWidth: 120
      }).map((column) => (column.id === 'name' ? { ...column, width: 168 } : column)),
      {
        id: 'url',
        label: 'Page',
        width: 200,
        sort: (row) => row.url,
        render: (row) => {
          const href = safeExternalUrl(row.href)
          // The page's path; the Website column already names the site.
          return href ? <UrlText url={href} label={pagePath(row.url)} icon={false} /> : row.url
        }
      }
    ],
    [drills, lineOf]
  )

  const rowMenu = useCallback(
    (row: CitationListRow): MenuItem[] => {
      const items: MenuItem[] = [
        { id: 'open', label: 'Open the question', icon: 'eye', onSelect: () => onOpen(row) }
      ]
      const domain = drills?.get(`domain:${row.domain}`) ?? null
      if (domain && drillApi) {
        items.push({
          id: 'domain',
          label: `Questions that cite ${row.domain}`,
          icon: 'layers',
          onSelect: () => drillApi.open(domain)
        })
      }
      const href = safeExternalUrl(row.href)
      if (href) {
        items.push({
          id: 'url',
          label: 'Open the page in your browser',
          icon: 'external',
          onSelect: () => {
            window.open(href, '_blank', 'noopener,noreferrer')
          }
        })
      }
      return items
    },
    [drillApi, drills, onOpen]
  )

  return (
    <ListGrid<CitationListRow>
      label="Sources Google listed"
      noun={['source', 'sources']}
      rows={shown}
      rowKey={(row) => row.id}
      rowLabel={(row) => `${row.domain} in question ${row.promptPosition}`}
      columns={[
        ...columns,
        askColumn<CitationListRow>((row) => ({
          kind: 'domain',
          label: row.domain,
          detail: `${siteTypeName(lineOf(row))} · ${row.promptLabel}`
        }))
      ]}
      search={{
        text: (row) => `${row.domain} ${row.url} ${row.promptLabel}`,
        placeholder: 'Search questions or cited domains'
      }}
      filter={{
        label: 'Source type',
        options: FILTERS.map((item) => ({
          value: item.id,
          label: item.label,
          count: rows.filter((row) => matches(row, item.id)).length
        })),
        value: kind,
        onChange: (value) => setKind(value as SourceFilter),
        resetValue: 'all'
      }}
      rowMenu={rowMenu}
      onActivate={onOpen}
      pageSize="all"
      maxBodyHeight={440}
      empty={<p className="muted">No sources in this check.</p>}
    />
  )
}

/** "/blog/att-email-to-text" from "example.com/blog/att-email-to-text"; "/" for a home page. */
function pagePath(url: string): string {
  const at = url.indexOf('/')
  return at === -1 ? '/' : url.slice(at)
}
