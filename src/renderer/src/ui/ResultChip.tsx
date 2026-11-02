import type { JSX } from 'react'
import { Chip } from './Chip'
import { DEFAULT_RESULT_LABEL, RESULT_TONES, type ResultKind } from './resultTones'

export interface ResultChipProps {
  result: ResultKind
  /** The text, when the screen words it its own way ("Page cited"). Default: the shared word. */
  label?: string
  /** Google's place for a cited page: "Cited #2". Ignored with `label`. */
  position?: number | null
  className?: string
}

/** The one status pill for check results (no dot, small). Not interactive. */
export function ResultChip({ result, label, position, className }: ResultChipProps): JSX.Element {
  const text =
    label ??
    (result === 'cited' && position !== null && position !== undefined
      ? `Cited #${position}`
      : DEFAULT_RESULT_LABEL[result])
  if (result === 'no_overview' || result === 'not_checked') {
    return (
      <span className={['faint', 'ui-result-quiet', className ?? ''].filter(Boolean).join(' ')}>
        {text}
      </span>
    )
  }
  const tone = RESULT_TONES[result]
  return (
    <Chip
      size="sm"
      tone={tone.tone}
      className={['ui-result', tone.className ?? '', className ?? ''].filter(Boolean).join(' ')}
    >
      {text}
    </Chip>
  )
}
