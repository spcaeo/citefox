import type { JSX } from 'react'
import type { Market } from '@shared/domain'
import { targetHref } from '../../drill'
import { marketLabel } from '../../shell/model'
import { CopyText, IconButton } from '../../ui'
import { questionSource, questionTarget } from '../drills'
import type { CitedListRow } from '../model'

/**
 * A row's detail: the questions whose latest AI Overview cites it, each a link to
 * its prompt detail in the market and check it was cited in. On another site's
 * page, a question where Google cites a competitor next to it and not you offers
 * "✦ Draft a pitch" (the `pitch` drawer).
 */
export function CitedQuestions({
  row,
  markets,
  pitchable,
  onPitch
}: {
  row: CitedListRow
  markets: ReadonlyMap<string, Market>
  /** Question ids to offer a pitch for. */
  pitchable?: ReadonlySet<string> | undefined
  onPitch?: (question: CitedListRow['questions'][number]) => void
}): JSX.Element {
  const ordered = [...row.questions].sort(
    (left, right) =>
      left.position - right.position || left.promptText.localeCompare(right.promptText)
  )
  return (
    <ul className="cit-questions" aria-label="Searches citing it">
      {ordered.map((item) => {
        const where = item.marketIds
          .map((id) => {
            const market = markets.get(id)
            return market ? marketLabel(market) : id
          })
          .join(', ')
        return (
          <li key={item.id} className="cit-question">
            <span className="cit-question-body">
              <CopyText
                text={item.promptText}
                interactiveLabel
                className="cit-question-copy"
                label={
                  <a
                    className="cit-question-text"
                    href={targetHref(questionTarget(item)) ?? undefined}
                  >
                    {item.promptText}
                  </a>
                }
              />
              <span className="cit-question-meta faint">
                {questionSource(item)} · {where} · best #{item.position}
              </span>
            </span>
            {onPitch && pitchable?.has(item.id) ? (
              <IconButton
                size="sm"
                icon="sparkle"
                tip
                label={`Draft a pitch to ${row.domain} for “${item.promptText}”`}
                data-testid="cit-pitch"
                onClick={() => onPitch(item)}
              />
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
