import { useMemo, useState, type JSX } from 'react'
import type { FunnelStep, FunnelStepId, PageResults } from '@shared/domain'
import { REPORT_KPI_LABELS } from '@shared/report-copy'
import { DrillButton, DrillNumber } from '../../drill'
import { ListGrid, SectionHead, type ListColumn } from '../../ui'
import { Dotted, ViewToggle } from '../bits'
import { dropText } from '../deltas'
import { countNoun, funnelPrompts, funnelStep, percent } from '../model'
import type { ResultsDrills } from './drills'

function stepLabel(id: FunnelStepId, domain: string): string {
  switch (id) {
    case 'checked':
      return 'Questions checked'
    case 'aio_shown':
      return REPORT_KPI_LABELS.aio
    case 'own_domain':
      return `${domain} cited`
    case 'this_page':
      return REPORT_KPI_LABELS.pageCited
    case 'cited_and_named':
      return 'Cited and named in the text'
  }
}

function funnelColor(id: FunnelStepId): string {
  if (id === 'this_page') return 'var(--info)'
  if (id === 'own_domain') return 'var(--info-tint)'
  if (id === 'cited_and_named') return 'var(--fox-ink)'
  if (id === 'aio_shown') return 'var(--ink-3)'
  return 'var(--ink-2)'
}

/** "Where visibility falls away". Every step and drop opens its prompts, in chart and table. */
export function FunnelCard({
  results,
  drills
}: {
  results: PageResults
  drills: ResultsDrills
}): JSX.Element {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const domain = drills.scope.domain
  const total = funnelStep(results, 'checked')?.count ?? results.scope.promptCount
  return (
    <section
      className="card stack-tight"
      id="m3-funnel"
      aria-labelledby="m3-fun-h"
      data-nfr-chart="funnel"
    >
      <SectionHead
        id="m3-fun-h"
        title="Where visibility falls away"
        description="Counts are questions (one AI Overview each), not links. Select a step or a drop to see the questions behind it."
        actions={<ViewToggle view={view} onView={setView} />}
      />
      {view === 'chart' ? (
        <ol className="m3-funnel">
          {results.funnel.map((step, index) => {
            const stepDrill = drills.get(`funnel:${step.id}`)
            const dropDrill = step.drop ? drills.get(`drop:${step.id}`) : null
            const value =
              index === 0
                ? countNoun(step.count, 'question', 'questions')
                : funnelPrompts(step.count, total, percent(step.count, total))
            return (
              <li key={step.id}>
                {step.drop && dropDrill ? (
                  <DrillButton drill={dropDrill} className="m3-lost">
                    <span className="sr-only" data-nfr-figure={dropDrill.id}>
                      {dropDrill.rows.length}
                    </span>
                    <Dotted text={dropText(step.drop.count, step.drop.reason)} />
                  </DrillButton>
                ) : null}
                {stepDrill ? (
                  <DrillButton drill={stepDrill} className="m3-bar-btn">
                    <span className="sr-only" data-nfr-figure={stepDrill.id}>
                      {stepDrill.rows.length}
                    </span>
                    <span className="m3-bar-top">
                      <span>{stepLabel(step.id, domain)}</span>
                      <span className="mono">
                        <Dotted text={value} />
                      </span>
                    </span>
                    <span className="m3-track">
                      <span
                        className="m3-fill"
                        style={{
                          width: `${Math.max(percent(step.count, total), step.count > 0 ? 1 : 0)}%`,
                          background: funnelColor(step.id)
                        }}
                      />
                    </span>
                  </DrillButton>
                ) : null}
              </li>
            )
          })}
        </ol>
      ) : (
        <FunnelTable results={results} drills={drills} domain={domain} />
      )}
      <p className="faint">
        Each step is a subset of the one above, so every drop equals the difference between two
        bars.
      </p>
      <FunnelParts results={results} />
    </section>
  )
}

type FunnelRow = { step: FunnelStep }

/** The funnel as a list grid: each step and drop opens its prompts. */
function FunnelTable({
  results,
  drills,
  domain
}: {
  results: PageResults
  drills: ResultsDrills
  domain: string
}): JSX.Element {
  const rows = useMemo<FunnelRow[]>(
    () => results.funnel.map((step) => ({ step })),
    [results.funnel]
  )
  const columns = useMemo<ListColumn<FunnelRow>[]>(
    () => [
      {
        id: 'step',
        label: 'Step',
        width: 'fill',
        render: ({ step }) => stepLabel(step.id, domain)
      },
      {
        id: 'prompts',
        label: 'Questions',
        width: 96,
        numeric: true,
        render: ({ step }) => {
          const drill = drills.get(`funnel:${step.id}`)
          return drill ? <DrillNumber drill={drill} /> : step.count
        }
      },
      {
        id: 'drop',
        label: 'Drop',
        width: 96,
        numeric: true,
        render: ({ step }) => {
          if (!step.drop) return '—'
          const drill = drills.get(`drop:${step.id}`)
          return drill ? <DrillNumber drill={drill} /> : step.drop.count
        }
      }
    ],
    [drills, domain]
  )
  return (
    <ListGrid
      label="Funnel counts. Each drop equals the difference between the two steps."
      noun={['step', 'steps']}
      rows={rows}
      rowKey={({ step }) => step.id}
      rowLabel={({ step }) => stepLabel(step.id, domain)}
      columns={columns}
      className="m3-inner-grid"
      empty={<p className="muted">No funnel for this check.</p>}
    />
  )
}

/**
 * The funnel's parts for screen readers and the NFR-14 check: each step and
 * its drop add up to the step above.
 */
function FunnelParts({ results }: { results: PageResults }): JSX.Element {
  return (
    <ul className="sr-only">
      {results.funnel.map((step, index) => {
        const previous = results.funnel[index - 1]
        if (!previous || !step.drop) return null
        return (
          <li key={step.id} data-nfr-chart-row="parts">
            <span data-nfr-segment="">{step.count}</span> kept and{' '}
            <span data-nfr-segment="">{step.drop.count}</span> dropped of{' '}
            <span data-nfr-total="">{previous.count}</span>
          </li>
        )
      })}
    </ul>
  )
}
