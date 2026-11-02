import { useMemo, useState, type JSX } from 'react'
import type { ProjectFix } from '@shared/ipc'
import {
  PAGE_FIX_KIND_COPY,
  PAGE_FIX_KINDS,
  type PageFix,
  type PageFixRollup,
  type ProjectSearches
} from '@shared/page-fixes'
import { winOddsLevel } from '@shared/topic-scoring'
import { useAiContext } from '../../assistant/context/useAiContext'
import { DrillButton, useDrill } from '../../drill'
import { GOOGLE_ONLY, useEngineFilter } from '../../engines/useEngineFilter'
import {
  Button,
  Chip,
  Dropdown,
  ListGrid,
  UrlText,
  type ListColumn,
  type ListTree,
  type ListTreeGroup
} from '../../ui'
import { pathOf } from '../model'
import { usePageFixBriefs } from '../hooks/usePageFixBriefs'
import type { ProjectFixesSource } from '../source'
import { viewPatch, type ScreenKey, type SetScreenQuery } from '../views'
import {
  TODO_VIEW_LABEL,
  TODO_VIEWS,
  fixDrill,
  searchesDrill,
  sourcesLabel,
  todoGroups,
  type TodoView
} from './model'
import { NothingToDo } from './NothingToDo'
import { PageFixDrawer } from './PageFixDrawer'
import { pageFixTab } from './pageFixTab'
import {
  FIX_STATUS_LABEL,
  FIX_STATUS_TONE,
  FIX_STATUSES,
  fixStatusOf,
  statusFilter,
  type FixStatus
} from './status'

/** One grid row: a page fix, in the group the view puts it in. */
interface TodoRow {
  key: string
  group: { key: string; label: string; todo: string | null } | null
  fix: PageFix
  status: FixStatus
}

const ALL_STATUSES = 'all'

const ODDS_TONE = { high: 'ok', medium: 'warn', low: 'neutral' } as const

function todoView(value: string | null): TodoView {
  return TODO_VIEWS.find((view) => view === value) ?? 'kind'
}

/**
 * What to fix (Fixes.dc.html): the searches that need work rolled up into page
 * fixes, the grid grouped by kind, page or topic (`?by=`; each kind's group header
 * carries its count and a short line), each fix's button, and "Nothing to do now"
 * folded at the end. Every count opens the searches it counts. Each fix has a
 * Status (New, Brief ready, Logged), a filter kept in the URL (`?state=`).
 */
export function WhatToFix({
  data,
  rollup,
  projectId,
  client,
  query,
  setQuery,
  reload,
  logged = []
}: {
  data: ProjectSearches
  rollup: PageFixRollup
  projectId: string
  client: ProjectFixesSource
  query: Readonly<Record<ScreenKey, string | null>>
  setQuery: SetScreenQuery
  reload: () => void
  /** Changes logged in the project (Changes made): a fix logged since its last check reads Logged. */
  logged?: readonly ProjectFix[]
}): JSX.Element {
  const view = todoView(query.by)
  const state = statusFilter(query.state)
  const briefs = usePageFixBriefs(client, projectId)
  // Page fixes come from Google AI Overview checks only: its logo holds the engine spot.
  const engine = useEngineFilter(GOOGLE_ONLY)
  const briefIds = useMemo(() => new Set(briefs.byFix.keys()), [briefs.byFix])
  const [autoStart, setAutoStart] = useState<string | null>(null)
  const drill = useDrill()
  const groups = useMemo(
    () => todoGroups(rollup, view, data.sources, null),
    [rollup, view, data.sources]
  )
  const allRows = useMemo<TodoRow[]>(
    () =>
      groups.flatMap((group) =>
        group.fixes.map((fix) => ({
          key: view === 'topic' ? `${group.key}:${fix.id}` : fix.id,
          group: view === 'page' ? null : { key: group.key, label: group.label, todo: group.todo },
          fix,
          status: fixStatusOf(fix, briefIds, logged)
        }))
      ),
    [groups, view, briefIds, logged]
  )
  const rows = useMemo(
    () => (state === null ? allRows : allRows.filter((row) => row.status === state)),
    [allRows, state]
  )
  const statusCount = (status: FixStatus): number =>
    new Set(allRows.filter((row) => row.status === status).map((row) => row.fix.id)).size
  const open = rollup.fixes.find((fix) => fix.id === query.pf) ?? null
  // The fix a link came in with: its group opens until someone opens or closes groups.
  const [linkedFix] = useState(query.pf)
  useAiContext({
    filters: view !== 'kind' ? { group: TODO_VIEW_LABEL[view] } : {},
    numbers: [
      { label: 'Page fixes', value: String(rollup.fixes.length) },
      { label: 'Searches that need work', value: String(rollup.needWork) },
      ...PAGE_FIX_KINDS.map((item) => ({
        label: PAGE_FIX_KIND_COPY[item].title,
        value: String(rollup.byKind[item].fixes)
      }))
    ]
  })

  function openFix(fix: PageFix, start: boolean): void {
    setAutoStart(start ? fix.id : null)
    setQuery({ pf: fix.id })
  }

  const columns: ListColumn<TodoRow>[] = [
    {
      id: 'page',
      label: 'Page',
      width: 'fill',
      minWidth: 220,
      sort: (row) => (row.fix.page?.url ?? row.fix.proposed ?? '').toLowerCase(),
      render: (row) => <FixName fix={row.fix} domain={data.domain} />
    },
    {
      id: 'status',
      label: 'Status',
      hint: 'New · Brief ready (CiteFox AI wrote its brief) · Logged (in Changes made)',
      width: 112,
      // "New" on every fix says nothing; the column comes back once one moves on.
      hideWhenSame: true,
      sort: (row) => FIX_STATUSES.indexOf(row.status),
      drill: (row) => {
        const pageId = row.fix.page?.pageId ?? null
        return row.status === 'logged' && pageId !== null
          ? {
              label: 'Logged: open it in Changes made',
              onOpen: () => setQuery({ ...viewPatch('log'), page: pageId })
            }
          : null
      },
      render: (row) => (
        <Chip tone={FIX_STATUS_TONE[row.status]} size="sm">
          {FIX_STATUS_LABEL[row.status]}
        </Chip>
      )
    },
    {
      id: 'topic',
      label: 'Topic',
      width: 200,
      hideWhenSame: true,
      sort: (row) => sourcesLabel(row.fix).toLowerCase(),
      copy: (row) => row.fix.sources.map((item) => item.name).join(', ') || null,
      render: (row) => (
        <span className="fxt-clamp" title={row.fix.sources.map((item) => item.name).join(', ')}>
          {sourcesLabel(row.fix)}
        </span>
      )
    },
    {
      id: 'searches',
      label: 'Searches',
      width: 96,
      numeric: true,
      sort: (row) => row.fix.searches.length,
      drill: (row) => ({
        label: `${row.fix.searches.length} searches: open the list`,
        nfrId: `fix:${row.fix.id}`,
        onOpen: () => drill.open(fixDrill(row.fix, projectId, data.domain))
      }),
      render: (row) => row.fix.searches.length.toLocaleString('en-US'),
      total: (list, group) => {
        const searches = list.flatMap((row) => row.fix.searches)
        const count = searches.length.toLocaleString('en-US')
        return searches.length === 0 ? (
          count
        ) : (
          <DrillButton
            className="dg-drill"
            label={`${count} searches${group ? ` in ${group.label}` : ''}: open the list`}
            drill={searchesDrill({
              id: `fixes:${group?.key ?? 'all'}`,
              title: group ? group.label : 'Searches that need work',
              description: 'Every search in these page fixes, highest win odds first.',
              searches: [...searches].sort(
                (a, b) => (b.winOdds?.score ?? -1) - (a.winOdds?.score ?? -1)
              ),
              projectId,
              domain: data.domain
            })}
          >
            {count}
          </DrillButton>
        )
      },
      totalSort: (list) => list.reduce((sum, row) => sum + row.fix.searches.length, 0)
    },
    {
      id: 'odds',
      label: 'Win odds',
      width: 96,
      numeric: true,
      sort: (row) => row.fix.bestOdds,
      render: (row) =>
        row.fix.bestOdds === null ? (
          '—'
        ) : (
          <span
            className="fxt-odds"
            title={`Best ${row.fix.bestOdds} · average ${row.fix.avgOdds ?? '—'}. Win odds are a ranking aid.`}
          >
            <Chip tone={ODDS_TONE[winOddsLevel(row.fix.bestOdds)]} size="sm">
              {row.fix.bestOdds}
            </Chip>
          </span>
        )
    },
    {
      id: 'action',
      label: 'Action',
      hideLabel: true,
      width: 148,
      rowAction: true,
      render: (row) => (
        <Button
          size="sm"
          variant="ghost"
          data-guide={`fix-open:${row.fix.id}`}
          onClick={() => openFix(row.fix, true)}
        >
          {PAGE_FIX_KIND_COPY[row.fix.kind].action}
        </Button>
      )
    }
  ]

  const tree: ListTree<TodoRow> | undefined =
    view === 'page'
      ? undefined
      : {
          path: (row) => (row.group ? [{ key: row.group.key, label: row.group.label }] : []),
          order: view === 'kind' ? PAGE_FIX_KINDS : data.sources.map((source) => source.id),
          // Groups start closed (owner 2026-10-30); a link to one fix opens its group.
          ...(linkedFix === null
            ? {}
            : {
                defaultOpen: (group: ListTreeGroup<TodoRow>) =>
                  group.rows.some((row) => row.fix.id === linkedFix)
              }),
          renderGroup: (group) => {
            const todo = rows.find((row) => row.group?.key === group.key)?.group?.todo ?? null
            return (
              <span className="fxt-group">
                <span className="fxt-group-label">{group.label}</span>
                <span className="fxt-group-count num">{group.rows.length}</span>
                {todo ? <span className="fxt-group-todo">{todo}</span> : null}
              </span>
            )
          },
          totalRow: false
        }

  return (
    <div className="fxt-view">
      <div className="fxt-grid" data-guide="fixes-todo">
        <ListGrid
          label="What to fix"
          noun={['fix', 'fixes']}
          rows={rows}
          rowKey={(row) => row.key}
          rowLabel={(row) => row.fix.page?.url ?? row.fix.proposed ?? row.fix.id}
          columns={columns}
          // A narrow window drops these first, so the grid never scrolls sideways.
          narrowDrops={['odds', 'topic']}
          engine={engine.slot}
          urlKey="todo"
          columnsMenu
          filter={{
            label: 'Status',
            value: state ?? ALL_STATUSES,
            onChange: (next) => setQuery({ state: next === ALL_STATUSES ? null : next, pf: null }),
            options: [
              { value: ALL_STATUSES, label: 'All' },
              ...FIX_STATUSES.map((item) => ({
                value: item,
                label: FIX_STATUS_LABEL[item],
                count: statusCount(item)
              }))
            ]
          }}
          search={{
            text: (row) =>
              [
                row.fix.page?.url ?? '',
                row.fix.citedUrl ?? '',
                row.fix.proposed ?? '',
                ...row.fix.sources.map((item) => item.name)
              ].join(' '),
            placeholder: `Search ${rollup.fixes.length.toLocaleString('en-US')} fixes`
          }}
          toolbar={
            <Dropdown
              size="sm"
              prefix="Group"
              value={view}
              onChange={(next) => setQuery({ by: next === 'kind' ? null : next })}
              options={TODO_VIEWS.map((item) => ({ value: item, label: TODO_VIEW_LABEL[item] }))}
            />
          }
          {...(tree ? { tree } : {})}
          isRowCurrent={(row) => row.fix.id === query.pf}
          onActivate={(row) => openFix(row.fix, false)}
          // Groups keep the kind (or topic) order; the model already lists each group's
          // fixes most searches first. The flat page list starts sorted the same way.
          {...(tree ? {} : { initialSort: [{ key: 'searches', dir: 'desc' as const }] })}
          footer="always"
          empty={
            state ? (
              <p className="muted">No fixes are {FIX_STATUS_LABEL[state].toLowerCase()} here.</p>
            ) : (
              <p className="muted">Nothing to fix right now.</p>
            )
          }
        />
      </div>
      <NothingToDo
        rollup={rollup}
        projectId={projectId}
        domain={data.domain}
        open={query.nothing === 'open'}
        onToggle={() => setQuery({ nothing: query.nothing === 'open' ? null : 'open' })}
      />
      {query.pf !== null && open === null ? (
        <p className="muted" role="status">
          That fix is done or no longer needed.
        </p>
      ) : null}
      {open ? (
        <PageFixDrawer
          fix={open}
          projectId={projectId}
          domain={data.domain}
          source={client}
          autoStart={autoStart === open.id}
          saved={briefs.byFix.get(open.id)?.brief ?? null}
          onSaved={briefs.put}
          onClose={() => {
            setAutoStart(null)
            setQuery({ pf: null, pft: null })
          }}
          onChanged={reload}
          tab={pageFixTab(query.pft)}
          onTab={(next) => setQuery({ pft: next === 'brief' ? null : next })}
        />
      ) : null}
    </div>
  )
}

/** The page path (with copy and open), the cited page, or the page to write. */
function FixName({ fix, domain }: { fix: PageFix; domain: string }): JSX.Element {
  if (fix.kind === 'new') {
    return (
      <span className="fxt-name">
        <span className="fxt-name-lead">New page:</span>{' '}
        <span className="fxt-clamp">{fix.proposed}</span>
      </span>
    )
  }
  if (fix.kind === 'owner' && fix.citedUrl) {
    // Two paths on two lines, each named, so they never read as one: the page Google
    // cites now over the target page the searches were aimed at.
    return (
      <span className="fxt-name-owner">
        <span className="fxt-name">
          <span className="fxt-name-lead">Owner now:</span>
          <UrlText url={fix.citedUrl} label={pathOf(fix.citedUrl)} site={domain} />
        </span>
        <span className="fxt-name">
          <span className="fxt-name-lead">Target:</span>
          {fix.page ? (
            <UrlText url={fix.page.url} label={pathOf(fix.page.url)} site={domain} />
          ) : (
            <span className="fxt-name-note">no target page yet</span>
          )}
        </span>
      </span>
    )
  }
  return fix.page ? (
    <UrlText url={fix.page.url} label={pathOf(fix.page.url)} site={domain} />
  ) : (
    <span className="muted">No target page yet</span>
  )
}
