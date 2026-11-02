import type { JSX } from 'react'
import type { LoggedFix } from '@shared/domain'
import {
  controlLine,
  VERDICT_WAIT_DAYS,
  verdictSummary,
  type FixMeasure
} from '@shared/fix-verdict'
import { DrillNumber } from '../../drill'
import { fixQuestionsDrill } from '../../changes/drills'
import { citedQuestions, measuredQuestions, updateLine, verdictOf } from '../../changes/verdict'
import { VerdictPill } from '../../changes/VerdictCells'
import { openDrawer } from '../../shell/drawers'
import { Button, DrawerSection, MarkerDot } from '../../ui'
import { viewFixValues } from '../drawer/model'
import { liveLine } from './publish'
import '../../changes/changes.css'

const NO_MEASURE: FixMeasure = { url: null, questions: [], control: null, trend: [] }

/**
 * A page fix that was published: when it went live, the verdict (Did it work?) with
 * the fix's searches citing the page before → now (each number opens its searches
 * over this drawer), and the logged fix itself.
 */
export function PublishedSection({
  fix,
  domain,
  now
}: {
  fix: LoggedFix
  domain: string
  now: Date
}): JSX.Element {
  const measure = fix.measure ?? NO_MEASURE
  const view = verdictOf(measure, fix.goLiveAt, now)
  const context = { markets: [], brand: '', domain }
  const row = { fixId: fix.id, url: measure.url ?? fix.url ?? `https://${domain}/` }
  const google = updateLine(view)
  const control = controlLine(view)
  return (
    <DrawerSection
      title={liveLine(view, fix.goLiveAt)}
      // The title already says how long until the verdict; the pill shows once there is one.
      {...(view.state === 'too_early' || view.state === 'planned'
        ? {}
        : { actions: <VerdictPill view={view} size="md" /> })}
      testId="fxt-published"
    >
      <div className="chg-work">
        {view.measured > 0 ? (
          <p className="chg-work-line">
            <DrillNumber
              drill={fixQuestionsDrill(context, row, 'before', citedQuestions(measure, 'before'))}
            />{' '}
            →{' '}
            <DrillNumber
              drill={fixQuestionsDrill(context, row, 'now', citedQuestions(measure, 'now'))}
            />{' '}
            of{' '}
            <DrillNumber
              drill={fixQuestionsDrill(context, row, 'measured', measuredQuestions(measure))}
            />{' '}
            searches cite this page. {verdictSummary(view)}
            {control ? ` ${control}` : ''}
          </p>
        ) : (
          <p className="chg-work-line">
            {view.state === 'planned'
              ? 'CiteFox measures it from the day it goes live.'
              : `CiteFox checks its ${fix.promptIds.length === 1 ? 'search' : `${fix.promptIds.length} searches`} on schedule and waits ${VERDICT_WAIT_DAYS} days before it says if the fix worked.`}
          </p>
        )}
        {google ? (
          <p className="chg-work-google">
            <MarkerDot kind="google" label="G" small />
            <span>{google}</span>
          </p>
        ) : null}
        <div className="chg-work-actions">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => openDrawer('fix', viewFixValues(fix.id))}
          >
            Open Fix {fix.number}
          </Button>
        </div>
      </div>
    </DrawerSection>
  )
}
