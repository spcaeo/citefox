import type { JSX, ReactNode } from 'react'
import type { GridSortKey, Market } from '@shared/domain'
import type { HistorySubject, ProjectCheck } from '@shared/ipc'
import { AiSelection } from '../../../assistant/context/AiSelection'
import { askColumn } from '../../../assistant/sparkle/askColumn'
import { pluralize } from '@shared/pluralize'
import { marketLabel } from '../../../shell/model'
import { formatDay, formatMoment } from '../../../utils/dates'
import { formatCount } from '../../../keys/serpUsage'
import { costText } from '../../../engines/model'
import { EngineLogos } from '../../../engines/EngineLogo'
import {
  ToolButton,
  Button,
  Chip,
  EmptyState,
  ListGrid,
  type ChipTone,
  type FilterGroup,
  type ListBulkContext,
  type ListColumn,
  type ListEngineFilter,
  type ListTree,
  type MenuItem
} from '../../../ui'
import {
  CHECK_STATES,
  KIND_ORDER,
  changeText,
  changeTone,
  checkState,
  compareBlock,
  dayKey,
  durationText,
  enginesText,
  kindLabel,
  stateCounts,
  stateLabel,
  type CheckState,
  type ColumnId,
  type StatusFilter
} from '../model'
import type { LoadRunResults } from '../hooks/useRunResults'
import { CountCell } from './CountCell'
import { CountTotal } from './CountTotal'
import { SubjectCell } from './SubjectCell'

const STATE_TONE: Record<CheckState, ChipTone> = {
  finished: 'ok',
  partial: 'info',
  running: 'fox',
  cancelled: 'neutral',
  error: 'bad'
}

/**
 * Every check in the project in the one list grid: when it ran, what it covered,
 * who started it, its score and change, and what it found. A row opens that
 * check's results; its `⋯` menu holds the rest (compare, re-run, retry, stop,
 * copy link, delete). Ticking checks offers Compare (exactly two of the same
 * page or topic), Export CSV and Delete. The selection is the screen's (in the URL).
 */
export function ChecksGrid({
  rows,
  all,
  subjects,
  markets,
  status,
  sort,
  search,
  columns: shown,
  drops,
  filterControls,
  engine,
  actions,
  selection,
  compareIds,
  load,
  rowMenu,
  onSelection,
  onStatus,
  onSort,
  onSearch,
  onOpen,
  onCompare,
  onDelete,
  onExport
}: {
  /** The checks the filters keep. */
  rows: readonly ProjectCheck[]
  /** The checks before the status filter, for its counts. */
  all: readonly ProjectCheck[]
  subjects: ReadonlyMap<string, HistorySubject>
  markets: ReadonlyMap<string, Market>
  status: StatusFilter
  sort: readonly GridSortKey[]
  search: string
  /** The columns to show, in grid order. */
  columns: readonly ColumnId[]
  /** The order a narrow grid leaves columns out in (`dropOrder`). */
  drops: readonly ColumnId[]
  /** The Page or topic and Market pickers: in the toolbar while there is room, else in Filter ▾. */
  filterControls: readonly FilterGroup[]
  /** The engine filter, in its fixed toolbar spot (audit #4). */
  engine?: ListEngineFilter
  /** Right-hand toolbar actions: Export CSV and Columns. */
  actions: ReactNode
  /** Ticked run ids. */
  selection: readonly string[]
  /** The two checks open in Compare, marked in the list. */
  compareIds: readonly string[]
  load: LoadRunResults
  rowMenu: (check: ProjectCheck) => readonly MenuItem[]
  onSelection: (runIds: readonly string[]) => void
  onStatus: (status: StatusFilter) => void
  onSort: (sort: readonly GridSortKey[]) => void
  onSearch: (text: string) => void
  onOpen: (check: ProjectCheck) => void
  onCompare: (left: ProjectCheck, right: ProjectCheck) => void
  onDelete: (checks: readonly ProjectCheck[]) => void
  onExport: (checks: readonly ProjectCheck[]) => void
}): JSX.Element {
  const counts = stateCounts(all)
  const count = (
    kind: 'aio' | 'cited' | 'named',
    label: string,
    width: number,
    value: (check: ProjectCheck) => number
  ): ListColumn<ProjectCheck> => ({
    id: kind,
    label,
    width,
    numeric: true,
    sort: value,
    // A day's total and the "All checks" total open their questions too (audit #3).
    total: (checks, group) => (
      <CountTotal
        checks={checks}
        kind={kind}
        count={value}
        groupId={group?.id ?? null}
        groupLabel={group?.label ?? null}
        subjects={subjects}
        markets={markets}
        load={load}
      />
    ),
    totalSort: (checks) => sumOf(checks, value),
    render: (check) => (
      <CountCell
        check={check}
        kind={kind}
        value={value(check)}
        subject={subjects.get(check.pageId)}
        market={markets.get(check.marketId)}
        load={load}
      />
    )
  })
  const byId: Readonly<Record<ColumnId, ListColumn<ProjectCheck>>> = {
    date: {
      id: 'date',
      label: 'Day › Check',
      width: 172,
      sort: (check) => check.startedAt,
      // Day groups sort newest or oldest first by their latest check.
      totalSort: (checks) => latestStart(checks),
      // The market, questions, searches and duration are in the tooltip.
      render: (check) => (
        <span className="num" title={checkTip(check, markets)}>
          {formatMoment(check.startedAt)}
        </span>
      )
    },
    subject: {
      id: 'subject',
      label: 'Page or topic',
      width: 'fill',
      // Wide enough to read the name (audit #10); the default columns leave it the room.
      minWidth: 220,
      sort: (check) => subjects.get(check.pageId)?.label.toLowerCase() ?? null,
      // The name to paste elsewhere; a page shown by its path alone has UrlText's copy.
      copy: (check) => subjectCopy(subjects.get(check.pageId)),
      render: (check) => <SubjectCell subject={subjects.get(check.pageId)} />
    },
    market: {
      id: 'market',
      label: 'Market',
      width: 72,
      sort: (check) => marketName(markets, check.marketId),
      render: (check) => marketName(markets, check.marketId)
    },
    kind: {
      id: 'kind',
      label: 'Type',
      width: 76,
      sort: (check) => KIND_ORDER.indexOf(check.kind),
      render: (check) => <span className="hp-kind">{kindLabel(check.kind)}</span>
    },
    engines: {
      id: 'engines',
      label: 'Engines',
      width: 116,
      sort: (check) => enginesText(check.engines),
      // Each engine's logo, named in the tooltip and for screen readers (audit #4).
      render: (check) => <EngineLogos engines={check.engines} />
    },
    questions: {
      id: 'questions',
      label: 'Questions',
      width: 72,
      numeric: true,
      sort: (check) => check.questionsChecked,
      total: (checks) => sumOf(checks, (check) => check.questionsChecked),
      totalSort: (checks) => sumOf(checks, (check) => check.questionsChecked),
      render: (check) => (
        <span title={`${check.questionsChecked} of ${check.questionsTotal} questions checked`}>
          {check.questionsChecked}
          <span className="faint"> / {check.questionsTotal}</span>
        </span>
      )
    },
    score: {
      id: 'score',
      label: 'Score',
      width: 52,
      numeric: true,
      sort: (check) => check.score,
      render: (check) =>
        check.score === null ? (
          <span className="faint" title={noScoreTip(check)}>
            —
          </span>
        ) : (
          <span className="num">{check.score}</span>
        )
    },
    change: {
      id: 'change',
      label: 'Change',
      width: 60,
      numeric: true,
      sort: (check) => check.scoreChange,
      render: (check) => (
        <span
          className={`num hist-${changeTone(check.scoreChange)}`}
          aria-label={`Change since the previous check ${changeText(check.scoreChange)}`}
        >
          {changeText(check.scoreChange)}
        </span>
      )
    },
    aio: count('aio', 'Overviews', 76, (check) => check.aiOverviews),
    cited: count('cited', 'Cited', 48, (check) => check.cited),
    named: count('named', 'Named', 60, (check) => check.named),
    searches: {
      id: 'searches',
      label: 'Searches',
      width: 68,
      numeric: true,
      sort: (check) => check.searchesUsed,
      total: (checks) => sumOf(checks, (check) => check.searchesUsed),
      totalSort: (checks) => sumOf(checks, (check) => check.searchesUsed),
      render: (check) => <span className="num">{check.searchesUsed}</span>
    },
    credits: {
      id: 'credits',
      label: 'Credits',
      hint: 'Search credits this check used',
      width: 64,
      numeric: true,
      sort: (check) => check.credits ?? 0,
      total: (checks) => creditsText(sumOf(checks, (check) => check.credits ?? 0)),
      totalSort: (checks) => sumOf(checks, (check) => check.credits ?? 0),
      render: (check) =>
        (check.credits ?? 0) > 0 ? (
          <span className="num">{formatCount(check.credits ?? 0)}</span>
        ) : (
          <span className="faint" title={noCreditsTip(check)}>
            —
          </span>
        )
    },
    cost: {
      id: 'cost',
      label: 'Cost',
      width: 64,
      numeric: true,
      sort: (check) => check.costMicros ?? 0,
      total: (checks) => moneyText(sumOf(checks, (check) => check.costMicros ?? 0)),
      totalSort: (checks) => sumOf(checks, (check) => check.costMicros ?? 0),
      render: (check) =>
        (check.costMicros ?? 0) > 0 ? (
          <span className="num" title={costTip(check)}>
            {costText(check.costMicros ?? 0)}
          </span>
        ) : (
          <span className="faint" title="No cost was recorded for this check.">
            —
          </span>
        )
    },
    status: {
      id: 'status',
      label: 'Status',
      width: 72,
      sort: (check) => CHECK_STATES.findIndex((state) => state.id === checkState(check)),
      render: (check) => (
        <span className="hp-state" title={failedTip(check)}>
          <Chip size="sm" tone={STATE_TONE[checkState(check)]}>
            {stateLabel(checkState(check))}
          </Chip>
        </span>
      )
    }
  }
  const columns = [
    ...shown.map((id) => byId[id]),
    askColumn<ProjectCheck>((check) => ({
      kind: 'check',
      id: check.runId,
      label: checkName(check, subjects, markets)
    }))
  ]

  function bulk({ selected, clear }: ListBulkContext<ProjectCheck>): JSX.Element {
    const blocked = compareBlock(selected)
    const deletable = selected.filter((check) => check.status !== 'running')
    return (
      <>
        <AiSelection
          items={selected.map((check) => ({
            kind: 'check',
            id: check.runId,
            label: checkName(check, subjects, markets)
          }))}
        />
        <Button
          size="sm"
          icon="layers"
          disabled={blocked !== null}
          aria-describedby={blocked === null ? undefined : 'hp-compare-why'}
          onClick={() => {
            const [left, right] = selected
            if (left && right) onCompare(left, right)
          }}
        >
          Compare
        </Button>
        <ToolButton kind="csv" label="Export CSV" onClick={() => onExport(selected)} />
        <Button
          size="sm"
          variant="danger"
          icon="trash"
          disabled={deletable.length === 0}
          onClick={() => {
            onDelete(deletable)
            if (deletable.length === 0) clear()
          }}
        >
          Delete
        </Button>
        {blocked === null || selected.length < 2 ? null : (
          <span id="hp-compare-why" className="faint hp-compare-why">
            {blocked}
          </span>
        )}
      </>
    )
  }

  const shownStates = CHECK_STATES.filter((state) => counts[state.id] > 0 || state.id === status)
  return (
    <ListGrid<ProjectCheck>
      label="Check history"
      noun={['check', 'checks']}
      rows={rows}
      rowKey={(check) => check.runId}
      rowLabel={(check) => checkName(check, subjects, markets)}
      columns={columns}
      narrowDrops={drops}
      search={{
        text: (check) => {
          const subject = subjects.get(check.pageId)
          return `${subject?.label ?? ''} ${subject?.url ?? ''} ${marketName(markets, check.marketId)} ${kindLabel(check.kind)}`
        },
        placeholder: 'Search checks'
      }}
      searchValue={search}
      onSearchChange={onSearch}
      sort={sort}
      onSortChange={onSort}
      filter={{
        label: 'Show checks by status',
        options: [
          { value: 'all', label: 'All', count: counts.all },
          ...shownStates.map((state) => ({
            value: state.id,
            label: state.label,
            count: counts[state.id]
          }))
        ],
        value: status,
        onChange: (value) => onStatus(value as StatusFilter)
      }}
      filterControls={filterControls}
      {...(engine ? { engine } : {})}
      actions={actions}
      bulk={bulk}
      selection={selection}
      onSelectionChange={onSelection}
      rowMenu={rowMenu}
      tree={rows.length <= OPEN_FULLY_UP_TO ? DAY_TREE_OPEN : DAY_TREE}
      urlKey="hp"
      onActivate={onOpen}
      isRowCurrent={(check) => compareIds.includes(check.runId)}
      empty={
        <EmptyState
          title="No checks match these filters."
          body="Pick All pages and topics, every market and All statuses to see every check."
        />
      }
    />
  )
}

/**
 * Day › check: one group per day the checks started (the computer's own day),
 * newest first, each adding up its checks in the count columns. Small
 * histories open fully (`DAY_TREE_OPEN`, a log rather than a tree to explore);
 * longer ones start folded by day.
 */
const DAY_TREE: ListTree<ProjectCheck> = {
  path: (check) => [{ key: dayKey(check.startedAt), label: formatDay(check.startedAt) }],
  renderGroup: (group) => (
    <span className="ui-lg-tree-label">
      {group.label}
      {/* A flex row drops a span's leading space, so the gap is a no-break space. */}
      <span className="faint">
        {'\u00a0· '}
        {pluralize(group.rows.length, 'check')}
      </span>
    </span>
  ),
  // The day and its checks' times share the Date column; the page keeps the wide one.
  column: 'date',
  totalRow: 'All checks'
}

/** Histories up to this many checks open every day. */
const OPEN_FULLY_UP_TO = 30
const DAY_TREE_OPEN: ListTree<ProjectCheck> = { ...DAY_TREE, defaultOpen: () => true }

/** A page or topic's name to copy, or null when the cell shows only its path. */
function subjectCopy(subject: HistorySubject | undefined): string | null {
  if (subject === undefined) return null
  const topic = subject.kind === 'topic' || subject.url === null
  return topic || subject.label !== subject.url ? subject.label : null
}

function sumOf(checks: readonly ProjectCheck[], value: (check: ProjectCheck) => number): number {
  return checks.reduce((sum, check) => sum + value(check), 0)
}

function latestStart(checks: readonly ProjectCheck[]): string | null {
  return checks.reduce<string | null>(
    (latest, check) => (latest === null || check.startedAt > latest ? check.startedAt : latest),
    null
  )
}

function creditsText(credits: number): JSX.Element {
  return credits > 0 ? (
    <span className="num">{formatCount(credits)}</span>
  ) : (
    <span className="faint">—</span>
  )
}

function moneyText(micros: number): JSX.Element {
  return micros > 0 ? (
    <span className="num">{costText(micros)}</span>
  ) : (
    <span className="faint">—</span>
  )
}

/** "Oct 19, 10:42 AM · 🇺🇸 US · EN · 3 of 3 questions · 6 searches · took 12s". */
function checkTip(check: ProjectCheck, markets: ReadonlyMap<string, Market>): string {
  const searches = pluralize(check.searchesUsed, 'search', 'searches')
  const questions = `${check.questionsChecked} of ${pluralize(check.questionsTotal, 'question')}`
  const took = check.durationMs === null ? '' : ` · took ${durationText(check.durationMs)}`
  return `${formatMoment(check.startedAt)} · ${marketName(markets, check.marketId)} · ${questions} · ${searches}${took}`
}

function noCreditsTip(check: ProjectCheck): string {
  return check.provider === 'cloro'
    ? 'No search credits were charged.'
    : 'It used searches, not credits.'
}

/** "$0.11 for 140 search credits", "$0.30 for 20 searches, at your plan's price". */
function costTip(check: ProjectCheck): string {
  const money = costText(check.costMicros ?? 0)
  const credits = check.credits ?? 0
  const searches = check.provider === 'serpapi' ? check.searchesUsed : 0
  const parts = [
    credits > 0 ? pluralize(credits, 'search credit') : null,
    searches > 0 ? pluralize(searches, 'search', 'searches') : null
  ].filter(Boolean)
  return parts.length === 0 ? money : `${money} for ${parts.join(' and ')}, at your plan's price`
}

function noScoreTip(check: ProjectCheck): string {
  if (check.status === 'running') return 'No score until the check finishes.'
  if (check.status !== 'finished') return 'A check that did not finish has no score.'
  return 'No question had an AI Overview, so there is nothing to score.'
}

function failedTip(check: ProjectCheck): string | undefined {
  const failed = check.failedPromptIds.length
  return failed === 0 ? undefined : `${pluralize(failed, 'question')} without a result`
}

function marketName(markets: ReadonlyMap<string, Market>, marketId: string): string {
  const market = markets.get(marketId)
  return market ? marketLabel(market) : 'Removed market'
}

/** "Alerts · 🇺🇸 US · EN · Oct 19, 10:42 AM", for "Select …" and screen readers. */
function checkName(
  check: ProjectCheck,
  subjects: ReadonlyMap<string, HistorySubject>,
  markets: ReadonlyMap<string, Market>
): string {
  const subject = subjects.get(check.pageId)?.label ?? 'Removed page'
  return `${subject} · ${marketName(markets, check.marketId)} · ${formatMoment(check.startedAt)}`
}
