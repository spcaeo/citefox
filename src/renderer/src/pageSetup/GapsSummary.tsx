import type { JSX } from 'react'
import type { CoverageLevel } from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { DrillButton, DrillLink, DrillNumber, type DrillScope } from '../drill'
import { KpiStrip, KpiTile, SectionHead } from '../ui'
import { coverageDrill, coverageTotalDrill, gapTarget, workDrill } from './gapsDrills'
import { coverageLabel } from './labels'
import {
  COVERAGE_LEVELS,
  chartSegments,
  coverageTally,
  segmentsSum,
  tallySums,
  workOf,
  type GapListRow
} from './model'

/**
 * The Content gaps KPI strip (v2 `KpiStrip`, four tiles): one tile per coverage
 * level. Every count opens the drawer of exactly the prompts it counts
 * (NFR-14). A tile's "Show only" pill toggles the matrix filter; its prompt
 * numbers open Prompt detail.
 */
export function GapsTiles({
  population,
  coverage,
  scope,
  onToggleCoverage
}: {
  /** The rows the summary counts: the search and filters applied, any coverage. */
  population: readonly GapListRow[]
  coverage: readonly CoverageLevel[]
  scope: DrillScope
  onToggleCoverage: (level: CoverageLevel) => void
}): JSX.Element {
  return (
    <KpiStrip className="gp-tiles" label="Coverage summary">
      {COVERAGE_LEVELS.map((level) => {
        const drill = coverageDrill(level, population, scope)
        const count = drill.items.length
        const levelRows = population.filter((row) => row.coverage === level)
        const pressed = coverage.length === 1 && coverage[0] === level
        return (
          <KpiTile
            key={level}
            className={pressed ? 'gp-tile gp-tile-on' : 'gp-tile'}
            label={coverageLabel(level)}
            value={
              <DrillNumber
                drill={drill}
                label={`${count} ${count === 1 ? 'question' : 'questions'} with ${coverageLabel(level)} coverage`}
              />
            }
            suffix={count === 1 ? 'question' : 'questions'}
            chip={
              <button
                type="button"
                className={`gp-level gp-level-${level} gp-level-sm`}
                aria-pressed={pressed}
                aria-label={`${coverageLabel(level)}: show only these questions in the matrix`}
                onClick={() => onToggleCoverage(level)}
              >
                Show only
              </button>
            }
            sub={
              levelRows.length === 0 ? null : (
                <span className="gp-tile-ids">
                  {levelRows.map((row, index) => {
                    const target = gapTarget(scope, row.promptId)
                    return (
                      <span key={row.id}>
                        {index > 0 ? ', ' : null}
                        {target ? (
                          <DrillLink
                            target={target}
                            className="gx-id"
                            label={`Question ${row.position}: open Question detail`}
                          >
                            {row.position}
                          </DrillLink>
                        ) : (
                          row.position
                        )}
                      </span>
                    )
                  })}
                </span>
              )
            }
          />
        )
      })}
    </KpiStrip>
  )
}

/**
 * "The work": new FAQs to add and sections to edit, one line beside the source
 * note. Every number opens exactly the prompts behind it (NFR-14).
 */
export function GapsWork({
  population,
  scope
}: {
  population: readonly GapListRow[]
  scope: DrillScope
}): JSX.Element {
  const work = workOf(population)
  const newFaqs = workDrill('new_faq', population, scope)
  const faqs = workDrill('faqs', population, scope)
  const sections = workDrill('sections', population, scope)
  return (
    <p className="gp-work num">
      <span className="gp-work-label">The work</span>{' '}
      <DrillNumber drill={newFaqs} label={`${work.newFaqs} new FAQs to add`} />
      {work.optionalFaqs > 0 ? (
        <>
          –
          <DrillNumber drill={faqs} label={`${work.faqRangeHigh} new and optional FAQs`} />
        </>
      ) : null}{' '}
      {work.optionalFaqs === 0 && work.newFaqs === 1 ? 'new FAQ' : 'new FAQs'} and edits to{' '}
      <DrillNumber drill={sections} label={`${pluralize(work.sectionEdits, 'section')} to edit`} />{' '}
      {work.sectionEdits === 1 ? 'section' : 'sections'}
    </p>
  )
}

/** The coverage bar and its counts, every count a drill (NFR-14). */
export function GapsChart({
  population,
  scope
}: {
  population: readonly GapListRow[]
  scope: DrillScope
}): JSX.Element {
  const tally = coverageTally(population)
  const segments = chartSegments(tally)
  const chartName = `Coverage chart. Strong ${tally.strong}, Partial ${tally.partial}, Weak ${tally.weak}, None ${tally.none}. Total ${tally.total}.`
  return (
    <section className="ui-panel gp-chart-panel" aria-labelledby="gp-chart-h">
      <SectionHead id="gp-chart-h" title="How well the page answers each question" />
      <div className="gp-chart-row">
        {tally.total > 0 && tallySums(tally) && segmentsSum(segments, tally.total) ? (
          <div className="gp-chart" role="group" aria-label={chartName}>
            {segments.map((segment) => (
              <DrillButton
                key={segment.level}
                drill={coverageDrill(segment.level, population, scope)}
                className={`gp-seg gp-seg-${segment.level}`}
                style={{ flexGrow: segment.count }}
                label={`${segment.count} ${segment.count === 1 ? 'question' : 'questions'} with ${coverageLabel(segment.level)} coverage`}
              >
                <span className="sr-only">{coverageLabel(segment.level)}</span>
              </DrillButton>
            ))}
          </div>
        ) : (
          <p className="gp-muted">No questions match this search and these filters.</p>
        )}
        <ul className="gp-counts num" aria-label="Coverage counts">
          {COVERAGE_LEVELS.map((level) => (
            <li key={level}>
              <span className="gp-counts-name">
                <span className={`gp-dot gp-dot-${level}`} aria-hidden="true" />
                {coverageLabel(level)}
              </span>
              <DrillNumber
                drill={coverageDrill(level, population, scope)}
                label={`${tally[level]} ${tally[level] === 1 ? 'question' : 'questions'} with ${coverageLabel(level)} coverage`}
              />
            </li>
          ))}
          <li>
            <span className="gp-counts-name">Total</span>
            <DrillNumber
              drill={coverageTotalDrill(population, scope)}
              label={`${tally.total} ${tally.total === 1 ? 'question' : 'questions'} in total`}
            />
          </li>
        </ul>
      </div>
    </section>
  )
}
