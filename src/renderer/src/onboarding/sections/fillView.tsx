import type { JSX } from 'react'
import type { SetupItem } from '@shared/ipc'
import { FILL_MARK, manualDetailText } from './fillText'

/** The row's second line while CiteFox AI writes it: calm, one line, no jump. */
export function FillingText(): JSX.Element {
  return (
    <span className="osc-filling" data-testid="row-filling">
      <span className="osc-fill-mark" aria-hidden="true">
        {FILL_MARK}
      </span>{' '}
      Filling in…
    </span>
  )
}

/**
 * A row's second-line words: AI-written text with the ✦ mark, the person's own detail,
 * or "Added by you" for a row they typed with nothing more.
 */
export function ManualDetail({ item }: { item: SetupItem }): JSX.Element {
  if (item.aiFilled === true && item.detail.length > 0) {
    return (
      <span data-testid="row-ai-filled" title="Written by CiteFox AI. Edit it any time.">
        <span className="osc-fill-mark" aria-hidden="true">
          {FILL_MARK}
        </span>
        <span className="sr-only">Written by CiteFox AI: </span> {item.detail}
      </span>
    )
  }
  return <>{manualDetailText(item)}</>
}

/** The tiny "✦ Fill in" link on a hand-added row with nothing after its name. */
export function FillRetry({
  item,
  onClick
}: {
  item: SetupItem
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className="osc-link osc-fill-retry"
      aria-label={`Fill in ${item.name} with CiteFox AI`}
      onClick={onClick}
    >
      {FILL_MARK} Fill in
    </button>
  )
}
