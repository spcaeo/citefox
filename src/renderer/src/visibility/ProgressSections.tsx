import type { JSX } from 'react'
import { Markdown } from '../components/Markdown'
import { PromptQuestion } from '../components/PromptQuestion'
import { promptQuestionName } from '../components/promptText'
import { DrillLink, DrillNumber, openTarget, useDrill, type DrillTarget } from '../drill'
import { countNoun } from '../m3/model'
import { EmptyState, LinkButton, ListGrid, SectionHead, Sparkline, type ListColumn } from '../ui'
import { marketChecksDrill } from './progressDrills'
import { FixJump, RunDrillButton } from './progressRuns'
import type { DerivedPromptRow, LiveMarketRow, PromptColumn } from './promptHistory'

const NO_CHECK = 'No check in this market yet.'

export function EmptyWhatChanged({
  note,
  checkHref
}: {
  note: string
  /** Where "Check now" goes when the market has no check yet. */
  checkHref?: string
}): JSX.Element {
  const noRun = note === NO_CHECK
  return (
    <section className="vis-panel stack-tight" aria-labelledby="chg-h">
      <SectionHead id="chg-h" title="What changed since the last check" />
      <Markdown className="faint" baseLevel={3}>
        {note}
      </Markdown>
      {noRun && checkHref ? (
        <p>
          <LinkButton href={checkHref} variant="primary">
            Check now
          </LinkButton>
        </p>
      ) : null}
    </section>
  )
}

/** FR-14.8. Fix numbers per prompt: `planned` while that fix's go-live is still ahead. */
export type PromptFixMarks = ReadonlyMap<string, readonly { number: number; planned: boolean }[]>

export function DerivedPromptHistory({
  columns,
  rows,
  place,
  pageId,
  marketId,
  marks
}: {
  columns: readonly PromptColumn[]
  rows: readonly DerivedPromptRow[]
  place: string
  /** Prompts and cells open Prompt detail on this page, in this market. */
  pageId: string
  marketId: string | null
  marks?: PromptFixMarks
}): JSX.Element {
  const withFixes = marks !== undefined && marks.size > 0
  const gridColumns: ListColumn<DerivedPromptRow>[] = [
    {
      id: 'n',
      label: '#',
      width: 56,
      numeric: true,
      sort: (row) => row.n,
      render: (row) => <span className="faint">{row.n}</span>
    },
    {
      id: 'prompt',
      label: 'Question',
      width: 'fill',
      minWidth: 200,
      sort: (row) => row.full.toLowerCase(),
      render: (row) => (
        <DrillLink
          className="vis-link vis-hist-prompt"
          label={`Question ${row.n}, ${promptQuestionName({ text: row.full, label: row.label })}`}
          target={{ kind: 'prompt', pageId, promptId: row.id, marketId }}
        >
          <PromptQuestion text={row.full} label={row.label} />
        </DrillLink>
      )
    },
    ...columns.map((column, index): ListColumn<DerivedPromptRow> => ({
      id: `run:${column.runId}`,
      label: column.label,
      width: 150,
      sort: (row) => row.cells[index]?.text ?? null,
      render: (row) => {
        const cell = row.cells[index]
        if (!cell || cell.text === '—') return <span className="faint">—</span>
        return (
          <DrillLink
            className="vis-link"
            label={`Question ${row.n} on ${column.label}: ${cell.text}, open that result`}
            target={{ kind: 'prompt', pageId, promptId: row.id, marketId, runId: cell.runId }}
          >
            {cell.text}
          </DrillLink>
        )
      }
    })),
    ...(withFixes
      ? [
          {
            id: 'fixes',
            label: 'Fixes',
            width: 190,
            render: (row: DerivedPromptRow) => (
              <span className="vis-hist-fixes">
                {(marks.get(row.id) ?? []).map((mark) => (
                  <FixJump
                    key={mark.number}
                    number={mark.number}
                    className={
                      mark.planned ? 'fx-mark fx-mark-planned fx-mark-btn' : 'fx-mark fx-mark-btn'
                    }
                    label={`Fix ${mark.number} · ${mark.planned ? 'Planned' : 'Targeted'}, go to the fix`}
                  >
                    Fix {mark.number} · {mark.planned ? 'Planned' : 'Targeted'}
                  </FixJump>
                ))}
              </span>
            )
          }
        ]
      : [])
  ]
  return (
    <section className="stack-tight" aria-labelledby="hist-h">
      <SectionHead
        id="hist-h"
        title="Each question across checks"
        description={`${place} · each question’s result in every full check${withFixes ? ', with the fixes that target it' : ''}`}
      />
      {columns.length === 0 ? (
        <EmptyState title="No check in this market yet." />
      ) : (
        <>
          <ListGrid<DerivedPromptRow>
            label="Each question across checks"
            noun={['question', 'questions']}
            rows={rows}
            rowKey={(row) => row.id}
            rowLabel={(row) => `Question ${row.n}`}
            columns={gridColumns}
            search={{ text: (row) => `${row.n} ${row.full}`, placeholder: 'Search questions' }}
            initialSort={[{ key: 'n', dir: 'asc' }]}
            empty={<EmptyState title="No check in this market yet." />}
          />
          <p className="faint">
            Numbers in cells are the page&apos;s position in the overview&apos;s sources.
            {withFixes
              ? ' “Targeted” marks questions a live fix was meant to help; “Planned” marks questions picked for a fix that has not gone live yet.'
              : ''}
          </p>
        </>
      )}
    </section>
  )
}

export function LiveMarkets({
  rows,
  pageId
}: {
  rows: readonly LiveMarketRow[]
  /** Market names open Progress in that market; scores open that check's prompts. */
  pageId: string
}): JSX.Element {
  const { open } = useDrill()
  const headers: string[] = []
  for (const row of rows) {
    for (const column of row.columns) {
      if (!headers.includes(column.label)) headers.push(column.label)
    }
  }
  const anyCheck = rows.some((row) => row.checks.length > 0)
  const progressIn = (row: LiveMarketRow): DrillTarget => ({
    kind: 'page',
    pageId,
    tab: 'progress',
    marketId: row.id
  })
  const columns: ListColumn<LiveMarketRow>[] = [
    {
      id: 'market',
      label: 'Market',
      width: 'fill',
      minWidth: 160,
      sort: (row) => row.name,
      render: (row) => (
        <DrillLink
          className="vis-link"
          target={progressIn(row)}
          label={`${row.name}, show Progress in this market`}
        >
          {row.name}
        </DrillLink>
      )
    },
    ...headers.map((header): ListColumn<LiveMarketRow> => ({
      id: `check:${header}`,
      label: header,
      width: 96,
      numeric: true,
      render: (row) => {
        const column = row.columns.find((item) => item.label === header)
        const value = column?.value ?? '—'
        if (!column || value === '—') return <span className="faint">—</span>
        return (
          <span data-nfr-series-value="">
            <RunDrillButton
              untracked
              label={`${row.name}, ${header}: visibility score ${value}, show the questions behind it`}
              copy={{
                id: `market-check:${row.id}:${column.runId}`,
                title: `Questions behind the score · ${header}`,
                description: `Every question checked in ${row.name} on ${header}. The visibility score is built from these results.`
              }}
              ids={(results) => results.prompts.map((prompt) => prompt.promptId)}
              marketId={row.id}
              runId={column.runId}
            >
              {value}
            </RunDrillButton>
          </span>
        )
      }
    })),
    {
      id: 'trend',
      label: 'Trend',
      width: 120,
      render: (row) => <Sparkline values={row.scores} label={row.aria} />
    },
    {
      id: 'change',
      label: 'Change',
      width: 88,
      numeric: true,
      render: (row) => (row.checks.length === 0 ? '—' : row.delta)
    },
    {
      id: 'checks',
      label: 'Checks',
      width: 88,
      numeric: true,
      sort: (row) => row.checks.length,
      render: (row) =>
        row.checks.length === 0 ? (
          '—'
        ) : (
          <DrillNumber
            drill={marketChecksDrill(row, pageId)}
            label={`${row.name}, ${countNoun(row.checks.length, 'check', 'checks')}`}
          />
        )
    }
  ]
  return (
    <section className="stack-tight" aria-labelledby="mkt-h">
      <SectionHead id="mkt-h" title="All markets" description="Visibility score by market." />
      {!anyCheck ? (
        <EmptyState title="No check in this market yet." />
      ) : (
        <ListGrid<LiveMarketRow>
          label="Visibility score by market"
          noun={['market', 'markets']}
          rows={rows}
          rowKey={(row) => row.id}
          rowLabel={(row) => row.name}
          columns={columns}
          // NFR-14: the row is the series; its values and trend drawing are its cells.
          rowProps={(row) => ({ 'data-nfr-series': row.checks.length > 0 ? row.id : undefined })}
          rowMenu={(row) => [
            {
              id: 'progress',
              label: `Show Progress in ${row.name}`,
              icon: 'arrow-right',
              onSelect: () => openTarget(progressIn(row))
            },
            ...(row.checks.length > 0
              ? [
                  {
                    id: 'checks',
                    label: `Show the ${countNoun(row.checks.length, 'check', 'checks')}`,
                    icon: 'layers' as const,
                    onSelect: () => open(marketChecksDrill(row, pageId))
                  }
                ]
              : [])
          ]}
          empty={<EmptyState title="No check in this market yet." />}
        />
      )}
    </section>
  )
}
