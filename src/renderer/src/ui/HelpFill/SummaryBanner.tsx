import type { JSX } from 'react'
import { helpFillSummary } from '@shared/helpfill'
import type { HelpFillResult } from '@shared/ipc'
import { UiIcon } from '../UiIcon'

/**
 * "✓ Read 15 rows. 2 were close to questions you track and were merged. 1 named
 * Example Co and was set aside. 12 are ready." (panel 3). An answer with nothing
 * ready shows the reader's warning instead, in the warning tone.
 */
export function SummaryBanner({
  result,
  testId = 'hf-summary'
}: {
  result: HelpFillResult
  testId?: string
}): JSX.Element {
  if (result.text !== undefined) return <TextBanner result={result} testId={testId} />
  const text = helpFillSummary(result.counts, result.noun, result.brand)
  const cut = text.indexOf('.') + 1
  const nothing = result.counts.ready === 0
  return (
    <div className={`hf-banner${nothing ? ' warn' : ''}`} role="status" data-testid={testId}>
      <UiIcon name={nothing ? 'warning' : 'check'} size={16} />
      <p>
        {result.counts.read === 0 && result.warnings.length > 0 ? (
          result.warnings.join(' ')
        ) : (
          <>
            <strong>{text.slice(0, cut)}</strong>
            {text.slice(cut)}
            {nothing && result.warnings.length > 0 ? ` ${result.warnings.join(' ')}` : ''}
          </>
        )}
      </p>
    </div>
  )
}

/**
 * A text kind's banner: "✓ Read the answer: 86 words." and any warning from the
 * kind's check ("Took out 1 sentence with a number not in the report: 47."), in
 * the warning tone when there is one.
 */
function TextBanner({ result, testId }: { result: HelpFillResult; testId: string }): JSX.Element {
  const text = result.text ?? ''
  const words = text.split(/\s+/u).filter(Boolean).length
  const warn = text.length === 0 || result.warnings.length > 0
  return (
    <div className={`hf-banner${warn ? ' warn' : ''}`} role="status" data-testid={testId}>
      <UiIcon name={warn ? 'warning' : 'check'} size={16} />
      <p>
        {text.length > 0 ? (
          <strong>{`Read the answer: ${words} ${words === 1 ? 'word' : 'words'}.`}</strong>
        ) : null}
        {result.warnings.length > 0
          ? `${text.length > 0 ? ' ' : ''}${result.warnings.join(' ')}`
          : ''}
      </p>
    </div>
  )
}
