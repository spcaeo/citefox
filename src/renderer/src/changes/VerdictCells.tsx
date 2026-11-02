import type { JSX } from 'react'
import { verdictLabel, type FixMeasure, type FixVerdictView } from '@shared/fix-verdict'
import type { ChangeLedger, ChangeRow } from '@shared/ipc'
import { DrillNumber } from '../drill'
import { Sparkline } from '../ui'
import { fixQuestionsDrill } from './drills'
import { citedQuestions, measuredQuestions, trendValues } from './verdict'

/** The verdict pill and the cells around it, shared by the ledger and the change drawer. */

/** Worked (green), Worse (orange), everything else grey. */
export function VerdictPill({
  view,
  size = 'sm'
}: {
  view: Pick<FixVerdictView, 'state' | 'tone' | 'daysLeft' | 'daysLive'>
  size?: 'sm' | 'md'
}): JSX.Element {
  return (
    <span
      className={`chg-verdict chg-verdict-${view.tone} chg-verdict-${size}`}
      data-verdict={view.state}
    >
      {verdictLabel(view)}
    </span>
  )
}

/** "2 → 5 of 7": each count opens the searches it counts. */
export function BeforeNowCell({
  ledger,
  row,
  view
}: {
  ledger: ChangeLedger
  row: ChangeRow
  view: FixVerdictView
}): JSX.Element {
  if (view.measured === 0) {
    return (
      <span className="chg-cited num faint" title="No check since it went live yet">
        —
      </span>
    )
  }
  return (
    <span className="chg-cited num">
      <DrillNumber
        drill={fixQuestionsDrill(ledger, row, 'before', citedQuestions(row.measure, 'before'))}
      />
      <span className="faint" aria-hidden="true">
        →
      </span>
      <DrillNumber
        drill={fixQuestionsDrill(ledger, row, 'now', citedQuestions(row.measure, 'now'))}
      />
      <span className="faint">of</span>
      <DrillNumber
        drill={fixQuestionsDrill(ledger, row, 'measured', measuredQuestions(row.measure))}
      />
    </span>
  )
}

/** The fix's searches citing the page at each check since the one before go-live. */
export function TrendCell({
  measure,
  label
}: {
  measure: Pick<FixMeasure, 'trend'>
  label: string
}): JSX.Element {
  if (measure.trend.length < 2) {
    return <span className="faint">—</span>
  }
  const { values, max } = trendValues(measure)
  return <Sparkline values={values} max={max} width={72} height={24} label={label} />
}
