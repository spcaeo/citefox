import { useId, type JSX, type ReactNode } from 'react'
import type { CompetitorGapQuestion } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { promptHash, topicHash } from '../../shell/routes'
import {
  Button,
  EmptyState,
  ListGrid,
  PICKER_NEW_VALUE,
  PickerSelect,
  ResultChip,
  UrlText,
  type ListColumn,
  type ListTree
} from '../../ui'
import type { GapActions } from '../hooks/useGapActions'
import {
  GAP_VIEWS,
  GAP_VIEW_LABEL,
  bareUrl,
  inView,
  pathOf,
  viewCounts,
  type GapView,
  type RivalSearch,
  type YouState
} from './rivalSearches'

const YOU: Readonly<Record<YouState, ReactNode>> = {
  not_cited: <ResultChip result="not_cited" label="Not cited" />,
  target: <ResultChip result="cited" label="Target page" />,
  other_page: <ResultChip result="own_page" label="Your other page" />,
  cited: <ResultChip result="cited" label="Cited" />
}

const YOU_ORDER: Readonly<Record<YouState, number>> = {
  not_cited: 0,
  other_page: 1,
  cited: 2,
  target: 3
}

/**
 * Every search a site is cited for, in the shared grid: search, sort, Columns,
 * and the view on the URL (They win, Both cited, All, Their pages). Their pages
 * groups the rows by the site's cited page, closed, so a site cited on hundreds
 * of pages stays a short list. Picked rows go to a topic or a logged fix.
 */
export function RivalSearchGrid({
  name,
  rows,
  view,
  onView,
  marketName,
  actions
}: {
  /** The site's name, for the empty views. */
  name: string
  rows: readonly RivalSearch[]
  view: GapView
  onView: (view: GapView) => void
  marketName: (id: string) => string
  actions: GapActions
}): JSX.Element {
  const counts = viewCounts(rows)
  const shown = inView(rows, view)
  const columns: ListColumn<RivalSearch>[] = [
    {
      id: 'search',
      label: 'Search',
      width: 'fill',
      minWidth: 200,
      wrap: true,
      sort: (row) => row.promptText.toLowerCase(),
      copy: (row) => row.promptText,
      render: (row) => (
        <a
          className="cmp-rs-q"
          href={promptHash(row.pageId, row.promptId, { marketId: row.marketId, runId: row.runId })}
        >
          {row.promptText}
        </a>
      )
    },
    {
      id: 'topic',
      label: 'Topic',
      width: 180,
      priority: 'low',
      hideWhenSame: (row) => row.pageId,
      sort: (row) => row.pageLabel.toLowerCase(),
      render: (row) =>
        row.pageKind === 'topic' ? (
          <a className="cmp-rs-clip" href={topicHash(row.pageId)}>
            {row.pageLabel}
          </a>
        ) : row.pageUrl ? (
          <UrlText url={row.pageUrl} label={pathOf(row.pageUrl)} />
        ) : (
          <span className="cmp-rs-clip">{row.pageLabel}</span>
        )
    },
    {
      id: 'market',
      label: 'Market',
      width: 110,
      priority: 'low',
      hideWhenSame: (row) => row.marketIds.join(','),
      sort: (row) => row.marketIds.map(marketName).join(', '),
      render: (row) => (
        <span className="cmp-rs-clip">{row.marketIds.map(marketName).join(', ')}</span>
      )
    },
    {
      id: 'their-page',
      label: 'Their page',
      width: 200,
      sort: (row) => bareUrl(row.url),
      render: (row) => (row.url ? <UrlText url={row.url} label={bareUrl(row.url)} /> : null)
    },
    {
      id: 'them',
      label: 'Them',
      hint: "Their place in Google's list of sources: 1 = shown first",
      width: 68,
      numeric: true,
      sort: (row) => row.position,
      render: (row) => (row.position > 0 ? `#${row.position}` : '—')
    },
    {
      id: 'you',
      label: 'You',
      width: 132,
      sort: (row) => YOU_ORDER[row.you],
      render: (row) => YOU[row.you]
    },
    {
      id: 'odds',
      label: 'Win odds',
      hint: 'How likely your page can win this search (0–100), from What to fix',
      width: 92,
      numeric: true,
      hideWhenEmpty: (row) => row.winOdds,
      sort: (row) => row.winOdds,
      render: (row) => (row.winOdds === null ? '—' : row.winOdds)
    }
  ]

  // Their pages groups by their page, so the column would only repeat the group; win
  // odds only when What to fix has some (a closed tree cannot tell an empty column).
  const hasOdds = shown.some((row) => row.winOdds !== null)
  const visible = columns.filter(
    (column) =>
      !(view === 'pages' && column.id === 'their-page') && (hasOdds || column.id !== 'odds')
  )

  const tree: ListTree<RivalSearch> | undefined =
    view === 'pages'
      ? {
          path: (row) => [
            { key: row.url || '—', label: row.url ? bareUrl(row.url) : 'Page not known' }
          ],
          defaultOpen: () => false,
          totalRow: false,
          renderGroup: (group) => (
            <span className="cmp-rs-group">
              {group.key === '—' ? group.label : <UrlText url={group.key} label={group.label} />}
              <span className="muted">{pluralize(group.rows.length, 'search', 'searches')}</span>
            </span>
          )
        }
      : undefined

  return (
    <ListGrid
      key={view === 'pages' ? 'pages' : 'rows'}
      label={`Searches that cite ${name}`}
      noun={['search', 'searches']}
      rows={shown}
      rowKey={(row) => row.id}
      rowLabel={(row) => row.promptLabel || row.promptText}
      columns={visible}
      urlKey="gap"
      saveKey="competitor-searches"
      columnsMenu
      narrowDrops={['market', 'topic', 'odds']}
      search={{
        text: (row) => `${row.promptText} ${row.pageLabel} ${row.url}`,
        placeholder: `Search ${pluralize(shown.length, 'search', 'searches')}`
      }}
      filter={{
        label: 'Show',
        stay: true,
        options: GAP_VIEWS.map((item) => ({
          value: item,
          label: GAP_VIEW_LABEL[item],
          count: counts[item]
        })),
        value: view,
        resetValue: 'win',
        onChange: (value) => onView(GAP_VIEWS.find((item) => item === value) ?? 'win')
      }}
      {...(tree ? { tree } : {})}
      initialSort={[
        { key: view === 'win' ? 'odds' : 'them', dir: view === 'win' ? 'desc' : 'asc' }
      ]}
      actions={
        <TopicPicker rows={shown} actions={actions} label="Add these questions to a topic" />
      }
      bulk={({ selected }) => (
        <>
          <TopicPicker
            rows={selected}
            actions={actions}
            label="Add the picked questions to a topic"
          />
          <Button size="sm" variant="primary" icon="pencil" onClick={() => actions.logFix(selected)}>
            Log a fix
          </Button>
        </>
      )}
      empty={
        <EmptyState
          title={
            view === 'win'
              ? `No search cites ${name} without you.`
              : view === 'both'
                ? `No search cites you both.`
                : `No search cites ${name} yet.`
          }
          body={
            view === 'win'
              ? 'Every overview that cites this site in the latest checks also cites your site.'
              : 'The latest checks have none.'
          }
        />
      }
    />
  )
}

/** "Add to a topic": the rows' questions go to a topic, or to a new one. */
function TopicPicker({
  rows,
  actions,
  label
}: {
  rows: readonly CompetitorGapQuestion[]
  actions: GapActions
  label: string
}): JSX.Element | null {
  const id = useId()
  if (rows.length === 0) return null
  return (
    <label className="cmp-field" htmlFor={id}>
      <span className="sr-only">{label}</span>
      <PickerSelect
        id={id}
        className="select"
        value=""
        disabled={actions.adding}
        placeholder={actions.adding ? 'Adding…' : 'Add to a topic'}
        options={actions.topics.map((topic) => ({ value: topic.id, label: topic.name }))}
        createLabel="+ New topic…"
        onCreate={() => actions.addToNewTopic(rows)}
        onChange={(value) => {
          if (value && value !== PICKER_NEW_VALUE) void actions.addToTopic(value, rows)
        }}
      />
    </label>
  )
}
