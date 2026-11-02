import type { JSX } from 'react'
import type { PageResults } from '@shared/domain'
import { pluralize, pluralWord } from '@shared/pluralize'
import { LINK_COUNT_LABELS, REPORT_DEFINITIONS, REPORT_KPI_LABELS } from '@shared/report-copy'
import { DrillButton, DrillNumber } from '../../drill'
import { pageHash } from '../../shell/routes'
import { KpiStrip, KpiTile } from '../../ui'
import { countDelta, rateDelta, scoreDelta, type DeltaLine } from '../deltas'
import { ofPrompts, percent } from '../model'
import type { ResultsDrills } from './drills'

/** A change line under a tile. It opens Progress, where the change is drawn over time. */
function Delta({ line, href }: { line: DeltaLine; href: string }): JSX.Element {
  return (
    <a className={`m3-kpi-delta ${line.className}`} href={href}>
      {line.text}
      <span className="sr-only"> (open Progress)</span>
    </a>
  )
}

/**
 * The four headline tiles (v2 KPI row). Each big number opens what it
 * counts: scored prompts, page-cited prompts, own-domain links (one row per
 * link), and prompts with an AI Overview. The change line opens Progress.
 */
export function KpiTiles({
  pageId,
  results,
  drills,
  since
}: {
  pageId: string
  results: PageResults
  drills: ResultsDrills
  since: string
}): JSX.Element | null {
  const run = results.run
  const score = drills.get('kpi:score')
  const page = drills.get('kpi:page')
  const aioDrill = drills.get('kpi:aio')
  if (!run || !score || !page || !aioDrill) return null
  const links = drills.links('all', undefined, 'kpi:links')
  const thisPage = drills.links('this_page')
  const otherOwn = drills.links('other_own')
  const aio = aioDrill.rows.length
  const previous = results.comparison.find((column) => column.which === 'previous')
  const current = results.comparison.find((column) => column.which === 'current')
  const progress = pageHash(pageId, 'progress')
  const scoreLine = scoreDelta(
    results.scoreChange.sincePrevious,
    results.scoreChange.sinceBaseline,
    since
  )
  const pageLine = rateDelta(
    percent(current?.pageCited ?? 0, current?.aiosShown ?? 0),
    previous?.runId ? percent(previous.pageCited ?? 0, previous.aiosShown ?? 0) : null,
    since
  )
  const aioChange = (current?.aiosShown ?? 0) - (previous?.aiosShown ?? 0)
  const aioDelta = countDelta(aioChange, Boolean(previous?.runId), since)
  const checkedDrill = drills.get('funnel:checked')
  const checked = checkedDrill?.rows.length ?? results.scope.promptCount
  const scoreValue = run.visibilityScore

  return (
    <KpiStrip className="m3-kpis" label="Headline numbers">
      <KpiTile
        label={REPORT_KPI_LABELS.score}
        value={
          <DrillButton
            drill={score}
            untracked
            className="drill-num"
            label={`${REPORT_KPI_LABELS.score} ${scoreValue ?? 'not scored'}: see the ${pluralize(score.rows.length, 'scored question')}`}
          >
            <span data-nfr-headline="score">{scoreValue ?? '—'}</span>
          </DrillButton>
        }
        suffix=" / 100"
        goal={{ value: scoreValue ?? 0, valueLabel: `Visibility score ${scoreValue ?? 0} of 100` }}
        sub={
          <>
            <DrillNumber drill={score} /> scored {pluralWord(score.rows.length, 'question')} ·{' '}
            <Delta line={scoreLine} href={progress} />
            <span className="sr-only"> {REPORT_DEFINITIONS.score}</span>
          </>
        }
      />
      <KpiTile
        label={REPORT_KPI_LABELS.pageCited}
        value={<DrillNumber drill={page} headline="page-cited" />}
        suffix={` of ${pluralize(aio, 'AI Overview')}`}
        goal={{
          value: percent(page.rows.length, aio),
          valueLabel: `${percent(page.rows.length, aio)}% of AI Overviews cite this page`
        }}
        sub={
          <>
            <Delta line={pageLine} href={progress} />
            <span className="sr-only"> {REPORT_DEFINITIONS.pageCited}</span>
          </>
        }
      />
      <KpiTile
        label={LINK_COUNT_LABELS.ownDomain}
        value={<DrillNumber drill={links} headline="links" />}
        suffix={` ${pluralWord(links.items.length, 'link')}`}
        sub={
          <>
            <DrillNumber
              drill={thisPage}
              label={`${pluralize(thisPage.items.length, 'link')} to this page`}
            />{' '}
            to this page ·{' '}
            <DrillNumber
              drill={otherOwn}
              label={`${pluralize(otherOwn.items.length, 'link')} to other ${drills.scope.domain} pages`}
            />{' '}
            to other {drills.scope.domain} pages
          </>
        }
      />
      <KpiTile
        label={REPORT_KPI_LABELS.aio}
        value={<DrillNumber drill={aioDrill} headline="aio" />}
        suffix={
          checkedDrill ? (
            <>
              {' '}
              of{' '}
              <DrillNumber
                drill={checkedDrill}
                suffix={checked === 1 ? ' question' : ' questions'}
                label={`${ofPrompts(checked)} checked`}
              />
            </>
          ) : (
            ` ${ofPrompts(checked)}`
          )
        }
        goal={{
          value: percent(aio, checked),
          valueLabel: `${percent(aio, checked)}% of questions show an AI Overview`
        }}
        sub={
          <>
            <Delta line={aioDelta} href={progress} />
            <span className="sr-only"> {REPORT_DEFINITIONS.aio}</span>
          </>
        }
      />
      <div className="sr-only" data-nfr-chart="own-domain-links">
        <p>Own-domain citations. Counts are links; the two parts add up to the total.</p>
        <ul>
          <li>
            This page: <span data-nfr-segment="">{thisPage.items.length}</span>
          </li>
          <li>
            Other own pages: <span data-nfr-segment="">{otherOwn.items.length}</span>
          </li>
          <li>
            Total: <span data-nfr-total="">{links.items.length}</span>
          </li>
        </ul>
      </div>
    </KpiStrip>
  )
}
