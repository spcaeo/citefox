import { useState, type JSX } from 'react'
import type { FixMarketOutcome, FixPromptOutcome, LoggedFix, Market } from '@shared/domain'
import { Markdown } from '../components/Markdown'
import { DrillLink, openTarget, type DrillTarget } from '../drill'
import { Button, ListGrid, SectionHead, type ListColumn, type MenuItem } from '../ui'
import { formatMonthDay } from '../m3/model'
import { marketLabel } from '../shell/model'
import { fixAnchorId } from '../visibility/progressRunsContext'
import type { ProgressAssists } from './assists'
import { FixComparison, FixSummary, FixVerdict } from './FixDrills'
import { outcomeFor, outcomeLabel, resultLabel, stateLabel, type FixFilter } from './model'

/** One logged fix and what happened (FR-14.7). Never claims the edit caused a move. */
export function FixCard({
  fix,
  pageId,
  marketId,
  markets,
  filter,
  now,
  busy,
  assists,
  onRunFollowUp,
  onDelete
}: {
  fix: LoggedFix
  /** Prompt links open Prompt detail on this page. */
  pageId: string
  marketId: string | null
  markets: readonly Market[]
  filter: FixFilter
  now: Date
  busy: boolean
  assists?: ProgressAssists
  onRunFollowUp: (fix: LoggedFix) => void
  onDelete: (fix: LoggedFix) => void
}): JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const outcome = outcomeFor(fix, marketId)
  const place = placeOf(markets, outcome?.marketId ?? null)
  const waiting = outcome === undefined || outcome.verdict === 'waiting'
  const rows = (outcome?.prompts ?? []).filter((prompt) => matches(prompt, filter, waiting))
  const others = fix.markets.filter((item) => item.marketId !== outcome?.marketId)
  const title = `Fix ${fix.number}`
  const outcomeMarket = outcome?.marketId ?? marketId
  const target = (promptId: string, runId: string | null): DrillTarget => ({
    kind: 'prompt',
    pageId,
    promptId,
    marketId: outcomeMarket,
    runId
  })
  const link = (
    promptId: string,
    runId: string | null,
    children: JSX.Element | string
  ): JSX.Element => (
    <DrillLink className="vis-link" target={target(promptId, runId)}>
      {children}
    </DrillLink>
  )
  const columns: readonly ListColumn<FixPromptOutcome>[] = [
    {
      id: 'n',
      label: '#',
      width: 56,
      numeric: true,
      sort: (prompt) => prompt.promptPosition,
      render: (prompt) => prompt.promptPosition
    },
    {
      id: 'prompt',
      label: 'Targeted question',
      width: 'fill',
      minWidth: 200,
      render: (prompt) => (
        <span className="vis-clip" title={(prompt.text || prompt.label).split('**').join('')}>
          {link(
            prompt.promptId,
            null,
            <Markdown inline baseLevel={4}>
              {prompt.text || prompt.label}
            </Markdown>
          )}
        </span>
      )
    },
    {
      id: 'before',
      label: `Before · ${formatMonthDay(outcome?.beforeAt ?? null)}`,
      width: 160,
      render: (prompt) =>
        prompt.before && outcome?.beforeRunId
          ? link(prompt.promptId, outcome.beforeRunId, stateLabel(prompt.before))
          : stateLabel(prompt.before)
    },
    {
      id: 'after',
      label: `After · ${waiting ? 'not yet' : formatMonthDay(outcome?.afterAt ?? null)}`,
      width: 160,
      render: (prompt) =>
        waiting
          ? '—'
          : prompt.after && outcome?.afterRunId
            ? link(prompt.promptId, outcome.afterRunId, stateLabel(prompt.after))
            : stateLabel(prompt.after)
    },
    {
      id: 'result',
      label: 'Result',
      width: 120,
      render: (prompt) =>
        waiting ? (
          <span className="faint">Waiting</span>
        ) : (
          <DrillLink
            className={`vis-link fx-result-${prompt.result}`}
            label={`${resultLabel(prompt.result)}: question ${prompt.promptPosition}, open the follow-up result`}
            target={target(prompt.promptId, outcome?.afterRunId ?? null)}
          >
            {resultLabel(prompt.result)}
          </DrillLink>
        )
    }
  ]
  const rowMenu = (prompt: FixPromptOutcome): MenuItem[] => [
    {
      id: 'prompt',
      label: 'Open Question detail',
      icon: 'eye',
      onSelect: () => openTarget(target(prompt.promptId, null))
    },
    ...(prompt.before && outcome?.beforeRunId
      ? [
          {
            id: 'before',
            label: `Open the result before (${formatMonthDay(outcome.beforeAt)})`,
            onSelect: () => openTarget(target(prompt.promptId, outcome.beforeRunId))
          }
        ]
      : []),
    ...(!waiting && outcome?.afterRunId
      ? [
          {
            id: 'after',
            label: `Open the follow-up result (${formatMonthDay(outcome.afterAt)})`,
            onSelect: () => openTarget(target(prompt.promptId, outcome.afterRunId))
          }
        ]
      : [])
  ]
  return (
    <article
      className="card fx-card"
      id={fixAnchorId(fix.number)}
      tabIndex={-1}
      aria-label={`${title} · ${firstLine(fix.description)}`}
    >
      <div className="fx-card-top">
        <span className="fx-num">{title}</span>
        <FixVerdict fix={fix} outcome={outcome} />
      </div>
      <Markdown className="fx-desc" baseLevel={4}>
        {fix.description}
      </Markdown>
      <FixSummary
        fix={fix}
        outcome={outcome}
        pageId={pageId}
        marketId={outcomeMarket}
        place={place}
        now={now}
      />
      {rows.length > 0 ? (
        <ListGrid<FixPromptOutcome>
          label={`Questions ${title} targeted in ${place}, before and after it went live`}
          noun={['question', 'questions']}
          rows={rows}
          rowKey={(prompt) => prompt.promptId}
          rowLabel={(prompt) => `Question ${prompt.promptPosition}`}
          columns={columns}
          rowMenu={rowMenu}
          empty={null}
        />
      ) : null}
      {others.length > 0 ? (
        <div className="stack-tight">
          <SectionHead level={3} title="Other markets in this fix" />
          <ul className="fx-markets">
            {others.map((item) => (
              <li key={item.marketId} className="ui-chip ui-chip-sm">
                <DrillLink
                  target={{ kind: 'page', pageId, tab: 'progress', marketId: item.marketId }}
                  label={`${placeOf(markets, item.marketId)} · ${outcomeLabel(item)}, show Progress in that market`}
                >
                  {placeOf(markets, item.marketId)} · {outcomeLabel(item)}
                </DrillLink>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {assists?.otherMarkets?.({ fix }) ?? null}
      {waiting ? null : (
        <div className="stack-tight">
          <SectionHead level={3} title="For comparison" />
          <FixComparison others={outcome?.others ?? null} marketId={outcomeMarket} />
        </div>
      )}
      <FollowUpActions
        fix={fix}
        outcome={outcome}
        busy={busy}
        confirming={confirming}
        onConfirm={setConfirming}
        onRunFollowUp={onRunFollowUp}
        onDelete={onDelete}
      />
    </article>
  )
}

function FollowUpActions({
  fix,
  outcome,
  busy,
  confirming,
  onConfirm,
  onRunFollowUp,
  onDelete
}: {
  fix: LoggedFix
  outcome: FixMarketOutcome | undefined
  busy: boolean
  confirming: boolean
  onConfirm: (open: boolean) => void
  onRunFollowUp: (fix: LoggedFix) => void
  onDelete: (fix: LoggedFix) => void
}): JSX.Element | null {
  if (fix.status === 'started') {
    return <p className="muted">The follow-up check for this fix is running.</p>
  }
  if (fix.status === 'completed' && outcome?.verdict !== 'waiting') return null
  if (confirming) {
    return (
      <div className="fx-actions" role="group" aria-label={`Delete Fix ${fix.number}?`}>
        <span>Delete Fix {fix.number}? Its planned follow-up is dropped too.</span>
        <Button variant="danger" disabled={busy} onClick={() => onDelete(fix)}>
          Delete fix
        </Button>
        <Button onClick={() => onConfirm(false)}>Keep it</Button>
      </div>
    )
  }
  return (
    <div className="fx-actions">
      {fix.status === 'planned' ? (
        <Button
          disabled={busy}
          onClick={() => onRunFollowUp(fix)}
          aria-describedby={`fx-run-${fix.id}`}
        >
          Run follow-up now
        </Button>
      ) : null}
      <span id={`fx-run-${fix.id}`} className="faint">
        Checks just the {fix.promptIds.length === 1 ? 'targeted question' : 'targeted questions'} in
        this fix&apos;s markets, as a partial check that stays out of the trend line.
      </span>
      {fix.status === 'planned' ? (
        <Button variant="ghost" onClick={() => onConfirm(true)}>
          Delete
        </Button>
      ) : null}
    </div>
  )
}

function matches(prompt: FixPromptOutcome, filter: FixFilter, waiting: boolean): boolean {
  if (filter === 'all') return true
  if (filter === 'planned') return waiting
  return !waiting && prompt.result === filter
}

function placeOf(markets: readonly Market[], marketId: string | null): string {
  const market = markets.find((item) => item.id === marketId)
  return market ? marketLabel(market) : 'This market'
}

function firstLine(text: string): string {
  const line = text.split('\n')[0]?.trim() ?? ''
  return line.length > 60 ? `${line.slice(0, 59)}…` : line
}
