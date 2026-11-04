import type { JSX } from 'react'
import type { LoggedFix } from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { formatMoment } from '../m3/model'
import type { WhatChangedModel } from '../progress/changes'
import { outcomeFor } from '../progress/model'
import { KpiStrip, KpiTile, type KpiTrend } from '../ui'
import { uniqueIds } from './progressDrills'
import { RunDrillButton, RunFigure } from './progressRuns'
import { citedPromptIds, type TrendBar } from './trends'

function trendOf(change: number | null, unit: string, since: string): KpiTrend | undefined {
  if (change === null) return undefined
  if (change === 0) return { direction: 'flat', text: `No change since ${since}` }
  return {
    direction: change > 0 ? 'up' : 'down',
    text: `${change > 0 ? '+' : '−'}${Math.abs(change)}${unit} since ${since}`
  }
}

/**
 * The Progress KPI row (v2 "Results: KPI row, tabs, grid"): page cited in the
 * latest full check, the visibility score, fixes logged and how they did, and
 * the prompts that changed between the last two full checks. Counts open the
 * prompts behind them in that check.
 */
export function ProgressKpis({
  latest,
  previous,
  score,
  fixes,
  marketId,
  changed
}: {
  /** The latest full check in the trend line. Null before the first check. */
  latest: TrendBar | null
  /** The full check before it, for the change lines. */
  previous: TrendBar | null
  /** The score shown for the latest check (the page score when it is the latest). */
  score: number | null | undefined
  fixes: readonly LoggedFix[]
  marketId: string | null
  changed: WhatChangedModel | null
}): JSX.Element {
  const since = previous ? formatMoment(previous.finishedAt) : ''
  const cited = latest ? citedPromptIds(latest) : []
  const rate = latest?.rate ?? null
  const ratePts =
    latest && previous && latest.rate !== null && previous.rate !== null
      ? Math.round(latest.rate * 100) - Math.round(previous.rate * 100)
      : null
  const scoreChange =
    previous && score != null && previous.score !== null ? score - previous.score : null
  const outcomes = fixes.map((fix) => outcomeFor(fix, marketId))
  const worked = outcomes.filter(
    (outcome) => outcome?.verdict === 'worked' || outcome?.verdict === 'partly'
  ).length
  const waiting = outcomes.filter(
    (outcome) => outcome === undefined || outcome.verdict === 'waiting'
  ).length
  const changedIds = changed
    ? uniqueIds(changed.groups.flatMap((group) => group.items.map((item) => item.id)))
    : []
  return (
    <KpiStrip className="vis-kpis" label="Progress numbers">
      <KpiTile
        label="Page cited"
        value={
          latest && cited.length > 0 ? (
            <RunDrillButton
              className="drill-num"
              label={`Page cited in ${pluralize(cited.length, 'question')}: show them`}
              copy={{
                id: `kpi:cited:${latest.runId}`,
                title: 'Page cited',
                description: `${latest.citedLine} on ${formatMoment(latest.finishedAt)}.`
              }}
              ids={cited}
              marketId={marketId}
              runId={latest.runId}
            >
              <RunFigure id={`kpi:cited:${latest.runId}`} ids={cited} />
            </RunDrillButton>
          ) : latest ? (
            '0'
          ) : (
            '—'
          )
        }
        suffix={latest ? `of ${latest.aiosShown}` : undefined}
        trend={trendOf(ratePts, ' pts', since)}
        sub={
          latest
            ? `${rate === null ? 'No AI Overview' : `${Math.round(rate * 100)}%`} of AI Overviews · ${formatMoment(latest.finishedAt)}`
            : 'No check in this market yet'
        }
      />
      <KpiTile
        label="Visibility score"
        value={score ?? '—'}
        suffix={score != null ? '/ 100' : undefined}
        trend={trendOf(scoreChange, '', since)}
        sub={latest ? `Latest full check · ${formatMoment(latest.finishedAt)}` : 'No score yet'}
      />
      <KpiTile
        label="Fixes logged"
        value={fixes.length}
        sub={
          fixes.length === 0
            ? 'Log what you change on the page'
            : `${worked} worked · ${waiting} waiting for a follow-up`
        }
      />
      <KpiTile
        label="Questions that changed"
        value={
          changed && latest && changedIds.length > 0 ? (
            <RunDrillButton
              className="drill-num"
              label={`${pluralize(changedIds.length, 'question')} changed: show them`}
              copy={{
                id: `kpi:changed:${latest.runId}`,
                title: 'Questions that changed',
                description: `Questions whose result changed between ${since} and ${formatMoment(latest.finishedAt)}.`
              }}
              ids={changedIds}
              marketId={marketId}
              runId={latest.runId}
            >
              <RunFigure id={`kpi:changed:${latest.runId}`} ids={changedIds} />
            </RunDrillButton>
          ) : changed ? (
            '0'
          ) : (
            '—'
          )
        }
        sub={
          changed && latest
            ? `${since} → ${formatMoment(latest.finishedAt)}`
            : 'Needs two full checks'
        }
      />
    </KpiStrip>
  )
}
