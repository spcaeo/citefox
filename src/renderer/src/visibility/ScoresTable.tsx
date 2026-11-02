import type { JSX, ReactNode } from 'react'
import { pluralize } from '@shared/pluralize'
import { LINK_COUNT_LABELS } from '@shared/report-copy'
import { Markdown } from '../components/Markdown'
import { DrillNumber, ownLinksDrill } from '../drill'
import { formatMonthDay } from '../m3/model'
import { ListGrid, type ListColumn } from '../ui'
import { checkedIds, overviewIds, runScope } from './progressDrills'
import { FixJump, RunDrillButton, RunFigure } from './progressRuns'
import { useProgressRuns, type ProgressRuns } from './progressRunsContext'
import type { RateTableRow, TrendBar } from './trends'

/**
 * The rate chart as a table. Every number in a check row opens what it
 * counts in that check, the same drawers as the chart; a fix row jumps to
 * its fix card.
 */
export function ScoresTable({
  rows,
  bars,
  name,
  footnote
}: {
  rows: readonly RateTableRow[]
  bars: readonly TrendBar[]
  name: string
  footnote: string
}): JSX.Element {
  const runs = useProgressRuns()
  const cellsOf = (row: RateTableRow): CheckCells | null => {
    const bar = bars.find((item) => item.runId === row.id)
    return runs && bar ? checkCells(runs, bar) : null
  }
  // A check row whose parts add up (NFR-14): its numbers carry the chart markers.
  const parts = (row: RateTableRow): boolean =>
    row.shown !== '—' && row.cited !== '—' && row.notCited !== '—'
  const mark = (row: RateTableRow, attr: string, value: ReactNode): ReactNode =>
    parts(row) ? <span {...{ [attr]: '' }}>{value}</span> : value
  const columns: readonly ListColumn<RateTableRow>[] = [
    {
      id: 'date',
      label: 'Date',
      width: 80,
      sort: (row) => row.at,
      render: (row) => formatMonthDay(row.at)
    },
    {
      id: 'event',
      label: 'Event',
      width: 'fill',
      minWidth: 180,
      render: (row) =>
        row.fixNumber !== null ? (
          <FixJump number={row.fixNumber} label={`${row.event}, go to Fix ${row.fixNumber}`}>
            {row.event}
          </FixJump>
        ) : (
          <span className="vis-clip" title={row.event}>
            {row.event}
          </span>
        )
    },
    { id: 'set', label: 'Question set', width: 120, render: (row) => row.promptSet },
    {
      id: 'prompts',
      label: 'Questions checked',
      width: 128,
      render: (row) => cellsOf(row)?.prompts ?? row.prompts
    },
    {
      id: 'shown',
      label: 'Overviews shown',
      width: 128,
      numeric: true,
      render: (row) => mark(row, 'data-nfr-total', cellsOf(row)?.shown ?? row.shown)
    },
    {
      id: 'cited',
      label: 'Page cited',
      width: 96,
      numeric: true,
      render: (row) => mark(row, 'data-nfr-segment', cellsOf(row)?.cited ?? row.cited)
    },
    {
      id: 'not-cited',
      label: 'Not page cited',
      width: 120,
      numeric: true,
      render: (row) => mark(row, 'data-nfr-segment', cellsOf(row)?.notCited ?? row.notCited)
    },
    {
      id: 'rate',
      label: 'Rate',
      width: 72,
      numeric: true,
      render: (row) => <span className="vis-rate">{row.rate}</span>
    },
    { id: 'trend', label: 'In trend line', width: 144, render: (row) => row.inTrend },
    {
      id: 'score',
      label: 'Score',
      width: 72,
      numeric: true,
      render: (row) => mark(row, 'data-nfr-score', row.score)
    },
    {
      id: 'links',
      label: LINK_COUNT_LABELS.ownDomain,
      width: 136,
      numeric: true,
      render: (row) => cellsOf(row)?.citations ?? row.citations
    }
  ]
  return (
    <div className="stack-tight">
      <ListGrid<RateTableRow>
        label={name}
        noun={['row', 'rows']}
        rows={rows}
        rowKey={(row) => row.id}
        rowLabel={(row) => `${formatMonthDay(row.at)} · ${row.event}`}
        columns={columns}
        pageSize="all"
        // NFR-14: a check row whose parts add up is one chart row of its own.
        rowProps={(row) => ({ 'data-nfr-chart-row': parts(row) ? 'parts' : undefined })}
        empty={<p className="muted">No check in this market yet.</p>}
      />
      <Markdown className="faint" baseLevel={3}>
        {footnote}
      </Markdown>
    </div>
  )
}

interface CheckCells {
  prompts: ReactNode
  shown: ReactNode
  cited: ReactNode
  notCited: ReactNode
  citations: ReactNode
}

/** Drill buttons for one check row. Null when that check is not loaded. */
function checkCells(runs: ProgressRuns, bar: TrendBar): CheckCells | null {
  const results = runs.cached(runs.marketId, bar.runId)
  if (!results) return null
  const day = formatMonthDay(bar.finishedAt)
  const marketId = runs.marketId
  const button = (
    id: string,
    title: string,
    description: string,
    ids: readonly string[],
    label: string,
    after: ReactNode = null
  ): ReactNode => (
    <RunDrillButton
      label={label}
      copy={{ id, title, description }}
      ids={ids}
      marketId={marketId}
      runId={bar.runId}
    >
      <RunFigure id={id} ids={ids} />
      {after}
    </RunDrillButton>
  )
  const checked = checkedIds(results)
  const shown = overviewIds(results)
  const segment = (id: 'page_cited' | 'not_page_cited'): ReactNode => {
    const part = bar.segments.find((item) => item.id === id)
    if (!part) return '—'
    return button(
      `segment:${bar.runId}:${id}`,
      part.label,
      `${part.label} on ${day}.`,
      part.promptIds,
      `${part.promptIds.length} ${part.label.toLowerCase()} on ${day}, show the questions`
    )
  }
  const links = ownLinksDrill(
    results,
    runScope(results, {
      pageId: runs.pageId,
      marketId,
      runId: bar.runId,
      marketLabel: runs.placeOf(marketId),
      meta: runs.meta
    }),
    { id: `links:${bar.runId}` }
  )
  return {
    prompts: button(
      `checked:${bar.runId}`,
      'Questions checked',
      `Every question this ${bar.partial ? 'partial ' : ''}check measured on ${day}.`,
      checked,
      `${checked.length} of ${pluralize(bar.promptsTotal, 'question')} checked on ${day}, show them`,
      ` of ${bar.promptsTotal}`
    ),
    shown: button(
      `aio:${bar.runId}`,
      'AI Overview shown',
      `Questions where Google showed an AI Overview on ${day}.`,
      shown,
      `${pluralize(shown.length, 'AI Overview')} shown on ${day}, show the questions`
    ),
    cited: segment('page_cited'),
    notCited: segment('not_page_cited'),
    citations: (
      <DrillNumber
        drill={links}
        label={`${pluralize(links.items.length, 'link')} to this site on ${day}`}
      />
    )
  }
}
