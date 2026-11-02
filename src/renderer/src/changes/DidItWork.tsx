import type { JSX } from 'react'
import {
  controlLine,
  VERDICT_WAIT_DAYS,
  verdictSummary,
  type FixVerdictView
} from '@shared/fix-verdict'
import type { ChangeLedger, ChangeRow } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { DrillButton, DrillNumber } from '../drill'
import { DrawerSection, MarkerDot } from '../ui'
import { formatDay } from '../utils/dates'
import { fixQuestionsDrill } from './drills'
import { citedQuestions, measuredQuestions, questionsIn, updateLine } from './verdict'
import { VerdictPill } from './VerdictCells'

/**
 * The change drawer's "Did it work?": the fix's searches citing the page before
 * go-live → now (each number opens its searches), what was won and lost, how
 * untouched searches moved, and any Google update in the window.
 */
export function DidItWork({
  ledger,
  row,
  view
}: {
  ledger: ChangeLedger
  row: ChangeRow
  view: FixVerdictView
}): JSX.Element {
  const measured = fixQuestionsDrill(ledger, row, 'measured', measuredQuestions(row.measure))
  const before = fixQuestionsDrill(ledger, row, 'before', citedQuestions(row.measure, 'before'))
  const now = fixQuestionsDrill(ledger, row, 'now', citedQuestions(row.measure, 'now'))
  const won = fixQuestionsDrill(ledger, row, 'won', questionsIn(row.measure, view.won))
  const lost = fixQuestionsDrill(ledger, row, 'lost', questionsIn(row.measure, view.lost))
  const beforeAt = latest(row.measure.questions.map((question) => question.before?.checkedAt))
  const nowAt = latest(row.measure.questions.map((question) => question.now?.checkedAt))
  const google = updateLine(view)
  const control = controlLine(view)
  return (
    <DrawerSection
      title="Did it work?"
      guide="did-it-work"
      actions={<VerdictPill view={view} size="md" />}
    >
      <div className="chg-work" data-testid="did-it-work">
        {view.measured === 0 ? (
          <p className="chg-work-line">
            {view.state === 'planned'
              ? 'It goes live later. CiteFox measures it from then.'
              : `No check of these ${pluralize(row.measure.questions.length, 'search', 'searches')} since it went live yet. The next scheduled check measures it.`}
          </p>
        ) : (
          <div className="chg-work-boxes">
            <div className="chg-work-box">
              <span className="chg-work-when">
                {beforeAt ? `Before · ${formatDay(beforeAt, { year: false })}` : 'Before'}
              </span>
              <span className="chg-work-count">
                <DrillNumber drill={before} />
                <span>
                  of <DrillNumber drill={measured} /> searches cite this page
                </span>
              </span>
            </div>
            <span className="chg-work-arrow" aria-hidden="true">
              →
            </span>
            <div className="chg-work-box">
              <span className="chg-work-when">
                {nowAt ? `Now · ${formatDay(nowAt, { year: false })}` : 'Now'}
              </span>
              <span className="chg-work-count">
                <DrillNumber drill={now} />
                <span>
                  of <DrillNumber drill={measured} /> searches cite this page
                </span>
              </span>
            </div>
          </div>
        )}
        {view.measured > 0 ? (
          <p className="chg-work-line">
            {verdictSummary(view)}
            {view.state === 'too_early'
              ? ` CiteFox waits ${VERDICT_WAIT_DAYS} days before it says if a fix worked.`
              : ''}
            {control ? ` ${control}` : ''}
          </p>
        ) : null}
        {google ? (
          <p className="chg-work-google">
            <MarkerDot kind="google" label="G" small />
            <span>{google}</span>
          </p>
        ) : null}
        {view.won.length > 0 || view.lost.length > 0 ? (
          <div className="chg-work-actions">
            {view.won.length > 0 ? (
              <DrillButton drill={won} className="ui-btn ui-btn-sm ui-btn-secondary">
                Open the {pluralize(view.won.length, 'won search', 'won searches')}
              </DrillButton>
            ) : null}
            {view.lost.length > 0 ? (
              <DrillButton drill={lost} className="ui-btn ui-btn-sm ui-btn-secondary">
                Open the {pluralize(view.lost.length, 'lost search', 'lost searches')}
              </DrillButton>
            ) : null}
          </div>
        ) : null}
      </div>
    </DrawerSection>
  )
}

function latest(values: readonly (string | undefined)[]): string | null {
  return values.reduce<string | null>(
    (best, value) => (value !== undefined && (best === null || value > best) ? value : best),
    null
  )
}
