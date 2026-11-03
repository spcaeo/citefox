import type { JSX } from 'react'
import type { EngineId } from '@shared/domain'
import type { EngineCounts } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { DrillButton, DrillNumber, type ItemDrill } from '../../drill'
import { ENGINE_PARAM, engineLabel } from '../../engines/model'
import { sectionHash } from '../../shell/routes'
import { formatMoment } from '../../utils/dates'
import { KpiStrip, KpiTile } from '../../ui'
import type { EngineSet } from '../drills'
import { kpiTrend } from '../model'

const n = (value: number): string => value.toLocaleString('en-US')

/**
 * One answer engine picked: its headline numbers from the latest answer to each question,
 * and the change against the check before. Each other widget follows its own engine filter.
 */
export function EngineSummaryKpis({
  engine,
  count,
  marketLabel,
  drillFor
}: {
  engine: EngineId
  count: EngineCounts | undefined
  marketLabel: string
  /** The questions behind each number (every number drills). */
  drillFor: (set: EngineSet) => ItemDrill
}): JSX.Element {
  const label = engineLabel(engine)
  const moved = count ? count.gained - count.lost : 0
  const questionsHref = `${sectionHash('questions')}?${ENGINE_PARAM}=${engine}`
  const number = (set: EngineSet, text: string, suffix?: string, lead = ''): JSX.Element => {
    const drill = drillFor(set)
    return (
      <DrillNumber
        drill={drill}
        label={
          // With a visible suffix ("1 gained"), the name starts with that text (WCAG 2.5.3).
          suffix
            ? `${drill.items.length}${suffix} on ${label}: ${pluralize(drill.items.length, 'question')}`
            : `${lead}${pluralize(drill.items.length, 'question')} ${text} on ${label}`
        }
        {...(suffix ? { suffix } : {})}
      />
    )
  }
  const movedDrill = drillFor('moved')
  const trend = kpiTrend(moved === 0 ? null : moved)
  return (
    <>
      <KpiStrip label={`Headline numbers on ${label}`} className="ov-kpis">
        <KpiTile
          label="Questions checked"
          value={number('checked', 'checked')}
          sub={
            count?.lastCheckedAt
              ? `Checked ${formatMoment(count.lastCheckedAt)} · ${marketLabel}`
              : `Not checked on ${label} yet`
          }
        />
        <KpiTile
          label={`${label} answered`}
          value={number('answered', 'answered')}
          suffix={<>of {number('checked', 'checked', undefined, 'of ')}</>}
          sub={
            count && count.unavailable > 0 ? (
              <>
                Unavailable for {number('unavailable', 'not answered yet')} · tried again at the
                next check
              </>
            ) : count && count.noAnswer > 0 ? (
              <>{number('no_answer', 'without an answer', ' without an answer')}</>
            ) : undefined
          }
        />
        <KpiTile
          label="You’re cited"
          value={number('cited', 'where you’re cited')}
          suffix={<>of {number('answered', 'answered', undefined, 'of ')}</>}
          {...(trend ? { trend } : {})}
          {...(trend && movedDrill.items.length > 0
            ? {
                renderTrend: (chip) => (
                  <DrillButton
                    drill={movedDrill}
                    className="ov-trend-btn"
                    label={`${trend.text} on ${label}: open the ${n(movedDrill.items.length)} that moved`}
                    untracked
                  >
                    {chip}
                  </DrillButton>
                )
              }
            : {})}
          sub={
            count && (count.gained > 0 || count.lost > 0) ? (
              <>
                {number('gained', 'gained', ' gained')} · {number('lost', 'lost', ' lost')}
              </>
            ) : undefined
          }
        />
        <KpiTile
          label="You’re named"
          value={number('named', 'where you’re named')}
          sub="In the answer, not its sources"
        />
      </KpiStrip>
      <p className="eng-note">
        <a href={questionsHref}>See each question on {label}</a>
      </p>
    </>
  )
}
