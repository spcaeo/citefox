import { useMemo, type JSX } from 'react'
import type { PageResults } from '@shared/domain'
import { DrillButton, type DrillRequest } from '../../drill'
import { pageHash } from '../../shell/routes'
import { ListGrid, SectionHead, type ListColumn } from '../../ui'
import { Dotted } from '../bits'
import { comparisonViews, type ComparisonViewRow } from '../comparison'
import { formatDay } from '../model'
import type { ResultsDrills } from './drills'

type Column = 'baseline' | 'previous' | 'current'

/** The current column's drill for each comparison metric. */
function currentDrill(metric: string, drills: ResultsDrills): DrillRequest | null {
  switch (metric) {
    case 'score':
      return drills.get('kpi:score')
    case 'page_cited':
      return drills.get('kpi:page')
    case 'own_cited':
      return drills.get('funnel:own_domain')
    case 'aio_shown':
      return drills.get('kpi:aio')
    case 'links_page':
      return drills.links('this_page')
    case 'links_other':
      return drills.links('other_own')
    case 'brand_mentioned':
      return drills.get('bucket:named_not_linked')
    default:
      return null
  }
}

/**
 * Baseline, previous and current check. A current value opens its prompts
 * (or links); an earlier value opens that check's Results; Change opens History.
 */
export function BaselineSection({
  pageId,
  results,
  drills
}: {
  pageId: string
  results: PageResults
  drills: ResultsDrills
}): JSX.Element {
  const historyHref = pageHash(pageId, 'history')
  const rows = useMemo(() => comparisonViews(results, historyHref), [results, historyHref])

  const columns = useMemo<ListColumn<ComparisonViewRow>[]>(() => {
    const runs = {
      baseline: results.comparison.find((item) => item.which === 'baseline'),
      previous: results.comparison.find((item) => item.which === 'previous'),
      current: results.comparison.find((item) => item.which === 'current')
    }
    const marketId = drills.scope.marketId

    function cell(which: Column, metric: string, text: string): JSX.Element {
      if (text === '—') return <Dotted text={text} />
      const run = runs[which]
      if (which === 'current') {
        const drill = currentDrill(metric, drills)
        if (drill) {
          return (
            <DrillButton drill={drill} untracked label={`${text}: open what this counts`}>
              <Dotted text={text} />
            </DrillButton>
          )
        }
        return <Dotted text={text} />
      }
      if (!run?.runId || run.runId === results.run?.runId) return <Dotted text={text} />
      return (
        <a
          href={pageHash(pageId, 'results', { runId: run.runId, marketId })}
          aria-label={`${text}: open the results of the check on ${formatDay(run.finishedAt)}`}
        >
          <Dotted text={text} />
        </a>
      )
    }

    const checkColumn = (
      which: Column,
      label: string,
      at: number
    ): ListColumn<ComparisonViewRow> => ({
      id: which,
      label: `${label} · ${formatDay(results.comparison[at]?.finishedAt ?? null)}`,
      width: 152,
      numeric: true,
      sort: (row) => row.sort[which],
      render: (row) => cell(which, row.id, row[which])
    })

    return [
      {
        id: 'metric',
        label: 'Metric',
        width: 'fill',
        minWidth: 200,
        sort: (row) => row.sort.metric,
        render: (row) => row.metric
      },
      checkColumn('baseline', 'Baseline', 0),
      checkColumn('previous', 'Previous', 1),
      checkColumn('current', 'Current', 2),
      {
        id: 'change',
        label: 'Change',
        width: 120,
        numeric: true,
        sort: (row) => row.sort.change,
        render: (row) =>
          row.change === '—' ? (
            row.change
          ) : (
            <a
              className={row.tone === 'up' ? 'm3-up' : row.tone === 'down' ? 'm3-down' : 'm3-flat'}
              href={row.historyHref ?? historyHref}
              aria-label={`${row.change}: compare checks in History`}
            >
              {row.change}
            </a>
          )
      }
    ]
  }, [results, drills, pageId, historyHref])

  return (
    <section className="m3-section" id="m3-baseline" aria-labelledby="m3-base-h">
      <SectionHead id="m3-base-h" title="Baseline, previous and current check" />
      <ListGrid
        label="Metrics by check"
        noun={['metric', 'metrics']}
        rows={rows}
        rowKey={(row) => row.id}
        rowLabel={(row) => row.metric}
        columns={columns}
        empty={<p className="muted">No checks to compare yet.</p>}
      />
    </section>
  )
}
