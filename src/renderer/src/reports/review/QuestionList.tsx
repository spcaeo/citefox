import { useState, type JSX, type KeyboardEvent } from 'react'
import type { EngineId } from '@shared/domain'
import type { MetricResult } from '@shared/metrics'
import { pathOf, positionMove, type QuestionItem } from '@shared/report/review'
import { EngineLogo } from '../../engines/EngineLogo'
import { engineLabel } from '../../engines/model'
import { Button } from '../../ui'
import { useQuerySortChoice } from '../../utils/queryState'
import { ReportPage, ReportText } from './copyCells'
import { openReportDetail, questionDetail } from './drill'
import { ResultTag } from './Figures'

/** Rows shown before "Show all": long tables stay quick to scroll. */
const FIRST_ROWS = 100

export interface QuestionListOptions {
  /** Target page column (Primary + "+N"). */
  targets?: boolean
  /** Funnel and Intent columns. */
  funnel?: boolean
  /** Brand named before → now. */
  named?: boolean
  /** "You in the same answer" (site lists). */
  withYou?: boolean
  /** Under All engines: each engine's result now, by question id. */
  engines?: {
    list: readonly EngineId[]
    byId: Readonly<Record<string, Partial<Record<EngineId, MetricResult>>>>
  }
  /** Pages the report knows, by page key: those open the page drawer. */
  knownPages?: ReadonlySet<string>
  /** Keeps the sort in the URL under this key (`?qsort=now:desc`); without it the sort is local. */
  sortKey?: string
}

type SortKey =
  'text' | 'topic' | 'target' | 'funnel' | 'intent' | 'before' | 'now' | 'position' | 'page'

const SORT_KEYS: readonly SortKey[] = [
  'text',
  'topic',
  'target',
  'funnel',
  'intent',
  'before',
  'now',
  'position',
  'page'
]

const RESULT_ORDER: Readonly<Record<MetricResult, number>> = {
  target: 0,
  other: 1,
  not_cited: 2,
  no_answer: 3,
  failed: 4
}

function sortValue(row: QuestionItem, key: SortKey): string | number {
  switch (key) {
    case 'text':
      return row.text.toLowerCase()
    case 'topic':
      return row.topic.toLowerCase()
    case 'target':
      return row.targets[0] === undefined ? '~' : pathOf(row.targets[0])
    case 'funnel':
      return row.funnel ?? '~'
    case 'intent':
      return row.intent ?? '~'
    case 'before':
      return row.before === null ? 9 : RESULT_ORDER[row.before]
    case 'now':
      return row.now === null ? 9 : RESULT_ORDER[row.now]
    case 'position':
      return row.positionNow ?? 99
    case 'page': {
      const url = row.pageNow ?? row.pageBefore
      return url === null ? '~' : pathOf(url)
    }
  }
}

function rowKeys(open: () => void): {
  onClick: () => void
  onKeyDown: (event: KeyboardEvent) => void
  tabIndex: number
} {
  return {
    onClick: open,
    tabIndex: 0,
    onKeyDown: (event) => {
      if (event.target !== event.currentTarget) return
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        open()
      }
    }
  }
}

function named(value: boolean | null): string {
  return value === null ? '—' : value ? 'Yes' : 'No'
}

/** "#3 → #1" with a ▲▼ pill; "#2" without a comparison. */
export function PositionCell({
  before,
  now,
  comparing
}: {
  before: number | null
  now: number | null
  comparing: boolean
}): JSX.Element {
  const at = (value: number | null): string => (value === null ? '—' : `#${value}`)
  const move = comparing ? positionMove(before, now) : null
  return (
    <span className="rv-posc">
      <span className="num">{comparing ? `${at(before)} → ${at(now)}` : at(now)}</span>
      {move !== null && move.tone !== 'flat' ? (
        <span className={`rv-pill rv-pill-${move.tone}`}>{move.text}</span>
      ) : null}
    </span>
  )
}

/** A page of yours: Copy + Open, and a link that opens its drawer when the report knows it. */
function PageCell({
  url,
  known
}: {
  url: string | null
  known?: ReadonlySet<string>
}): JSX.Element {
  if (url === null) return <span className="rv-muted">—</span>
  return <ReportPage url={url} known={known} />
}

/**
 * Questions with their result at both ends: sortable headers, the target page, position
 * before → now, the page cited and, in drawers, brand named, "you in the same answer" and
 * one column per engine. A row opens its answers; a page cell opens the page.
 */
export function QuestionList({
  rows,
  fromLabel,
  toLabel,
  label,
  options = {}
}: {
  rows: readonly QuestionItem[]
  fromLabel: string | null
  toLabel: string
  label: string
  options?: QuestionListOptions
}): JSX.Element {
  const [localSort, setLocalSort] = useState<{ key: SortKey; down: boolean } | null>(null)
  const [urlSort, setUrlSort] = useQuerySortChoice(options.sortKey ?? 'qsort.local', SORT_KEYS)
  const sort = options.sortKey ? urlSort : localSort
  const setSort = options.sortKey ? setUrlSort : setLocalSort
  const [all, setAll] = useState(false)
  if (rows.length === 0) return <p className="rv-muted">Nothing here.</p>
  const comparing = fromLabel !== null
  const sorted =
    sort === null
      ? rows
      : [...rows].sort((a, b) => {
          const left = sortValue(a, sort.key)
          const right = sortValue(b, sort.key)
          const order = left < right ? -1 : left > right ? 1 : 0
          return sort.down ? -order : order
        })
  const shown = all || sorted.length <= FIRST_ROWS ? sorted : sorted.slice(0, FIRST_ROWS)
  const head = (key: SortKey, text: string, className?: string): JSX.Element => {
    const on = sort?.key === key
    return (
      <th
        className={className}
        aria-sort={on ? (sort?.down ? 'descending' : 'ascending') : undefined}
      >
        <button
          type="button"
          className="rv-sort"
          onClick={() => setSort(on && sort ? { key, down: !sort.down } : { key, down: false })}
        >
          {text}
          <span aria-hidden="true">{on ? (sort?.down ? ' ▼' : ' ▲') : ''}</span>
        </button>
      </th>
    )
  }
  const engines = options.engines
  return (
    <div className="rv-tbl">
      <table aria-label={label}>
        <thead>
          <tr>
            <th className="rv-n">#</th>
            {head('text', 'Question')}
            {head('topic', 'Topic')}
            {options.targets ? head('target', 'Target page') : null}
            {options.funnel ? head('funnel', 'Funnel') : null}
            {options.funnel ? head('intent', 'Intent') : null}
            {comparing ? head('before', fromLabel) : null}
            {head('now', toLabel)}
            {options.named ? <th>{comparing ? 'Named before → now' : 'Named'}</th> : null}
            {head('position', comparing ? 'Position before → now' : 'Position')}
            {head('page', 'Cited through')}
            {options.withYou ? <th>You in the same answer</th> : null}
            {engines?.list.map((engine) => (
              <th key={engine} className="rv-eng-col" title={engineLabel(engine)}>
                <EngineLogo engine={engine} size={16} />
                <span className="sr-only">{engineLabel(engine)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, index) => (
            <tr
              key={row.id}
              className="rv-click"
              data-row={row.id}
              {...rowKeys(() => openReportDetail(questionDetail(row.id)))}
            >
              <td className="rv-n num">{index + 1}</td>
              <td className="rv-q">
                <ReportText text={row.text} inRow />
                {comparing && row.change === null && row.now !== null ? (
                  <span className="rv-pill rv-nc">Not compared</span>
                ) : null}
              </td>
              <td className="rv-muted">{row.topic}</td>
              {options.targets ? (
                <td>
                  {row.targets.length === 0 ? (
                    <span className="rv-muted">Not set</span>
                  ) : (
                    <>
                      <PageCell url={row.targets[0] ?? null} known={options.knownPages} />
                      {row.targets.length > 1 ? (
                        <span
                          className="rv-muted"
                          title={row.targets.slice(1).map(pathOf).join(', ')}
                        >
                          {' '}
                          +{row.targets.length - 1}
                        </span>
                      ) : null}
                    </>
                  )}
                </td>
              ) : null}
              {options.funnel ? <td className="rv-muted">{row.funnel ?? '—'}</td> : null}
              {options.funnel ? <td className="rv-muted">{row.intent ?? '—'}</td> : null}
              {comparing ? (
                <td>
                  <ResultTag result={row.before} />
                </td>
              ) : null}
              <td>
                <ResultTag result={row.now} />
              </td>
              {options.named ? (
                <td className="rv-muted">
                  {comparing
                    ? `${named(row.namedBefore)} → ${named(row.namedNow)}`
                    : named(row.namedNow)}
                </td>
              ) : null}
              <td>
                <PositionCell
                  before={row.positionBefore}
                  now={row.positionNow}
                  comparing={comparing}
                />
              </td>
              <td>
                <PageCell url={row.pageNow ?? row.pageBefore} known={options.knownPages} />
              </td>
              {options.withYou ? (
                <td>{row.now === 'target' || row.now === 'other' ? 'Yes' : 'No'}</td>
              ) : null}
              {engines?.list.map((engine) => (
                <td key={engine} className="rv-eng-col">
                  <ResultDot result={engines.byId[row.id]?.[engine] ?? null} engine={engine} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length < sorted.length ? (
        <div className="rv-more">
          <span className="rv-muted">
            Showing {shown.length} of {sorted.length}
          </span>
          <Button size="sm" variant="secondary" onClick={() => setAll(true)}>
            Show all {sorted.length}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

const DOT_WORDS: Readonly<Record<MetricResult, string>> = {
  target: 'Right page cited',
  other: 'Your other page',
  not_cited: 'Not cited',
  no_answer: 'No AI answer',
  failed: 'Search failed'
}

/** One engine's result as a coloured dot with its words for screen readers. */
function ResultDot({
  result,
  engine
}: {
  result: MetricResult | null
  engine: EngineId
}): JSX.Element {
  const words = result === null ? 'Not checked' : DOT_WORDS[result]
  return (
    <span
      className={`rv-res rv-res-${result ?? 'missing'}`}
      title={`${engineLabel(engine)}: ${words}`}
    >
      <i aria-hidden="true" />
      <span className="sr-only">{`${engineLabel(engine)}: ${words}`}</span>
    </span>
  )
}
