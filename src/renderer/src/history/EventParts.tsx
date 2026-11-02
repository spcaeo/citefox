import type { JSX } from 'react'
import type { HistoryCheck, HistoryEvent } from '@shared/domain'
import { DrillLink, DrillNumber } from '../drill'
import {
  changedDrill,
  checkedDrill,
  checkTarget,
  fixPromptsDrill,
  fixTarget,
  promptSetCount,
  promptsTarget,
  type HistoryDrillContext
} from './historyDrills'
import { changeText, changeTone, fullDay, scoreText } from './model'
import { pluralize } from '@shared/pluralize'

/**
 * The drillable parts of a History event, shared by the timeline and the
 * table so both views open the same things (REPORT-SPEC "Interaction model").
 * A score is not a count, so it links to Results for that check; counts are
 * `DrillNumber`s whose drawer total equals the number shown (NFR-14).
 */

/** The check's score, linking to Results pinned to that check. */
export function ScoreLink({
  check,
  event,
  context,
  bare = false
}: {
  check: HistoryCheck
  event: HistoryEvent
  context: HistoryDrillContext
  /** Table cell: the number alone. */
  bare?: boolean
}): JSX.Element {
  const text = bare ? (check.score === null ? '—' : String(check.score)) : scoreText(check.score)
  return (
    <DrillLink
      target={checkTarget(context, check)}
      className={bare ? 'm3-link' : 'chip hist-score hist-chip-link'}
      label={`${scoreText(check.score)}: open the results of the ${fullDay(event)} check`}
    >
      {text}
    </DrillLink>
  )
}

/** "Partial check · x of y prompts", where x opens the prompts that check ran. */
export function PartialTag({
  check,
  context
}: {
  check: HistoryCheck
  context: HistoryDrillContext
}): JSX.Element {
  const drill = checkedDrill(context, check)
  return (
    <span className="tag">
      Partial check ·{' '}
      {drill ? (
        <DrillNumber
          drill={drill}
          label={`${drill.rows.length} of ${pluralize(check.promptsTotal, 'question')} checked: show them`}
        />
      ) : (
        check.promptsChecked
      )}{' '}
      of {pluralize(check.promptsTotal, 'question')}
    </span>
  )
}

/** The score change chip, plus "N prompts changed" opening those prompts. */
export function ChangeParts({
  check,
  context,
  bare = false
}: {
  check: HistoryCheck
  context: HistoryDrillContext
  /** Table cell: no chip background. */
  bare?: boolean
}): JSX.Element | null {
  if (check.partial || check.scoreChange === null) {
    return bare ? <span>{changeText(null)}</span> : null
  }
  const change = check.scoreChange
  const drill = changedDrill(context, check)
  return (
    <span className="hist-change-parts">
      <span
        className={
          bare ? `hist-${changeTone(change)}` : `chip hist-change hist-${changeTone(change)}`
        }
        aria-label={`Change since the previous check ${changeText(change)}`}
      >
        {changeText(change)}
      </span>
      {drill ? (
        <span className="faint hist-changed">
          <DrillNumber
            drill={drill}
            label={`${promptSetCount(drill.rows.length)} changed since the previous check: show them`}
          />{' '}
          changed
        </span>
      ) : null}
    </span>
  )
}

/**
 * The table's Change cell: the score change alone (R2). No change is a faint
 * "—" (R8); how many questions changed has its own column ({@link ChangedCount}).
 */
export function ChangeValue({ check }: { check: HistoryCheck }): JSX.Element {
  const change = check.partial ? null : check.scoreChange
  if (change === null || change === 0) return <span className="faint">—</span>
  return (
    <span
      className={`hist-${changeTone(change)}`}
      aria-label={`Change since the previous check ${changeText(change)}`}
    >
      {changeText(change)}
    </span>
  )
}

/** The table's "Questions changed" cell: the count that opens those questions, or "—". */
export function ChangedCount({
  check,
  context
}: {
  check: HistoryCheck
  context: HistoryDrillContext
}): JSX.Element {
  const drill = check.partial || check.scoreChange === null ? null : changedDrill(context, check)
  if (!drill || drill.rows.length === 0) return <span className="faint">—</span>
  return (
    <DrillNumber
      drill={drill}
      label={`${promptSetCount(drill.rows.length)} changed since the previous check: show them`}
    />
  )
}

/** Fix tag (to its card on Progress), verdict, and the targeted prompts. */
export function FixParts({
  event,
  context
}: {
  event: HistoryEvent
  context: HistoryDrillContext
}): JSX.Element | null {
  const fix = event.fix
  if (!fix) return null
  const drill = fixPromptsDrill(context, fix)
  return (
    <>
      <DrillLink
        target={fixTarget(context, fix)}
        className="tag hist-tag-fix hist-chip-link"
        label={`Open fix ${fix.number} on the Progress tab`}
      >
        {fix.planned ? 'Planned fix' : 'Fix'} {fix.number}
      </DrillLink>
      {fix.verdict ? <span className="tag">{fix.verdict}</span> : null}
      {drill.items.length > 0 ? (
        <span className="faint">
          <DrillNumber
            drill={drill}
            label={`${promptSetCount(drill.items.length)} fix ${fix.number} targeted: show them`}
          />{' '}
          targeted
        </span>
      ) : null}
    </>
  )
}

/** A prompt-set event links to the Prompts tab, where its sets are listed. */
export function PromptSetLink({
  event,
  context
}: {
  event: HistoryEvent
  context: HistoryDrillContext
}): JSX.Element | null {
  const set = event.promptSet
  if (!set) return null
  return (
    <DrillLink
      target={promptsTarget(context)}
      className="hist-link"
      label={`Open questions: question set v${set.version}, ${promptSetCount(set.promptCount)}`}
    >
      Open questions ({promptSetCount(set.promptCount)})
    </DrillLink>
  )
}

/** "View results" for a check: Results pinned to that check, not the latest. */
export function ViewResults({
  event,
  context
}: {
  event: HistoryEvent
  context: HistoryDrillContext
}): JSX.Element | null {
  const check = event.check
  if (!check) return null
  return (
    <DrillLink
      target={checkTarget(context, check)}
      className="hist-link"
      label={`View results of the ${fullDay(event)} check`}
    >
      View results
    </DrillLink>
  )
}
