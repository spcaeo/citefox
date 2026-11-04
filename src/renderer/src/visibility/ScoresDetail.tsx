import type { JSX } from 'react'
import type { PageResults } from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { Markdown } from '../components/Markdown'
import { DrillNumber, ownLinksDrill } from '../drill'
import { aiOverviewLabel, formatMoment } from '../m3/model'
import { SegmentKey } from './ChartKey'
import { checkedIds, runScope } from './progressDrills'
import { RunDrillButton, RunFigure } from './progressRuns'
import { useProgressRuns } from './progressRunsContext'
import { citedPromptIds, pointNote, type LocalChartMarker, type TrendBar } from './trends'

/**
 * The selected point beside the rate chart. Every count opens what it
 * counts in that check: page cited, prompts checked, citations (links), and
 * each segment of the bar.
 */
export function ScoresDetail({
  bar,
  results,
  markers,
  score
}: {
  bar: TrendBar
  /** That check's `results:get`. Undefined while it is not loaded. */
  results: PageResults | undefined
  markers: readonly LocalChartMarker[]
  score: number | null | undefined
}): JSX.Element {
  const runs = useProgressRuns()
  const day = formatMoment(bar.finishedAt)
  const marketId = runs?.marketId ?? null
  const cited = citedPromptIds(bar)
  const checked = checkedIds(results)
  const links =
    runs && results
      ? ownLinksDrill(
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
      : null
  const toPage = links?.items.filter((item) => item.group === 'this_page').length ?? 0
  const toOther = (links?.items.length ?? 0) - toPage
  return (
    <div className="vis-detail" aria-live="polite">
      <span className="vis-detail-kind">{bar.kindLabel}</span>
      <span className="vis-detail-day">{day}</span>
      <span className="vis-detail-rate num">{bar.rateLabel}</span>
      {bar.rate === null || cited.length === 0 ? (
        <span className="muted">{bar.citedLine}</span>
      ) : (
        <span className="muted">
          <RunDrillButton
            label={`Page cited in ${cited.length} of ${aiOverviewLabel(bar.aiosShown)} shown on ${day}, show them`}
            copy={{
              id: `point:${bar.runId}`,
              title: 'Page cited',
              description: `${bar.citedLine} on ${day}.`
            }}
            ids={cited}
            marketId={marketId}
            runId={bar.runId}
          >
            Page cited in <RunFigure id={`point:${bar.runId}`} ids={cited} /> of{' '}
            {aiOverviewLabel(bar.aiosShown)} shown
          </RunDrillButton>
        </span>
      )}
      {results && checked.length > 0 ? (
        <span className="mono">
          <RunDrillButton
            label={`${checked.length} of ${pluralize(bar.promptsTotal, 'question')} checked on ${day}, show them`}
            copy={{
              id: `checked:${bar.runId}`,
              title: 'Questions checked',
              description: `Every question this ${bar.partial ? 'partial ' : ''}check measured on ${day}.`
            }}
            ids={checked}
            marketId={marketId}
            runId={bar.runId}
          >
            <RunFigure id={`checked:${bar.runId}`} ids={checked} /> of{' '}
            {pluralize(bar.promptsTotal, 'question')} checked
          </RunDrillButton>
        </span>
      ) : (
        <span className="mono">{bar.coverageLabel}</span>
      )}
      <span className="faint">
        {results && checked.length > 0 ? (
          <RunDrillButton
            untracked
            label={`Visibility score ${score ?? '—'} on ${day}, show the questions behind it`}
            copy={{
              id: `score:${bar.runId}`,
              title: 'Questions behind the score',
              description: `Every question checked on ${day}. Page cited is 3 points, another own page or a brand mention is 1, not cited is 0, over 3 points per AI Overview.`
            }}
            ids={checked}
            marketId={marketId}
            runId={bar.runId}
          >
            Visibility score {score ?? '—'}
          </RunDrillButton>
        ) : (
          <>Visibility score {score ?? '—'}</>
        )}{' '}
        · citations{' '}
        {links ? (
          <>
            <DrillNumber
              drill={links}
              label={`${pluralize(links.items.length, 'link')} to this site on ${day}`}
            />{' '}
            ({toPage} to this page, {toOther} to other pages)
          </>
        ) : (
          bar.citationDetail
        )}
      </span>
      <span className="muted">
        <Markdown inline baseLevel={3}>
          {pointNote(bar, markers)}
        </Markdown>
      </span>
      <div className="vis-stack" role="group" aria-label={segmentName(bar)}>
        {bar.segments.map((segment) =>
          segment.count <= 0 ? null : (
            <RunDrillButton
              key={segment.id}
              className={segment.id === 'page_cited' ? 'vis-this' : 'vis-other'}
              style={{ flex: segment.count }}
              label={`${segment.promptIds.length} ${segment.label.toLowerCase()}, show the questions`}
              copy={{
                id: `segment:${bar.runId}:${segment.id}`,
                title: segment.label,
                description: `${segment.label} on ${day}.`
              }}
              ids={segment.promptIds}
              marketId={marketId}
              runId={bar.runId}
            >
              <RunFigure id={`segment:${bar.runId}:${segment.id}`} ids={segment.promptIds} />
            </RunDrillButton>
          )
        )}
      </div>
      <SegmentKey />
    </div>
  )
}

function segmentName(bar: TrendBar): string {
  const cited = bar.segments.find((segment) => segment.id === 'page_cited')?.count ?? 0
  const rest = bar.segments.find((segment) => segment.id === 'not_page_cited')?.count ?? 0
  return `${cited} page cited and ${rest} not page cited, ${aiOverviewLabel(bar.aiosShown)}`
}
