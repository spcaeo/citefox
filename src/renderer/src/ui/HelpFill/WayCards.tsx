import { useId, type JSX } from 'react'
import type { HelpFillWay } from '@shared/helpfill'
import { UiIcon } from '../UiIcon'
import type { HelpFillWaysCopy } from './types'

/**
 * The two choice cards (HelpFill.dc.html panels 1 and 2): "✦ Describe it" and
 * "Use your own ChatGPT". A radio group, so arrow keys move between them. With
 * no Claude key the Describe card says so and cannot be picked.
 */
export function WayCards({
  way,
  noun,
  available,
  reason,
  disabled,
  copy,
  onWay
}: {
  way: HelpFillWay | null
  noun: string
  /** False: no Claude connection. Null: not known yet. */
  available: boolean | null
  reason: string | null
  disabled: boolean
  /** A place's own card words ("✦ Draft it for me"). */
  copy?: HelpFillWaysCopy | undefined
  onWay: (way: HelpFillWay) => void
}): JSX.Element {
  const name = useId()
  const noKey = available === false
  return (
    <div className="hf-ways" role="radiogroup" aria-label="How to fill it">
      <label
        className={`hf-way${way === 'describe' ? ' on' : ''}${noKey ? ' off' : ''}`}
        data-testid="hf-way-describe"
      >
        <input
          type="radio"
          className="sr-only"
          name={name}
          checked={way === 'describe'}
          disabled={disabled || noKey}
          onChange={() => onWay('describe')}
        />
        <span className="hf-way-title">
          <span className="hf-spark" aria-hidden="true">
            <UiIcon name="sparkle" size={14} />
          </span>
          {copy?.describe?.title ?? 'Describe it'}
        </span>
        <span className="hf-way-text">
          {noKey
            ? `${reason ?? 'Needs CiteFox AI connected.'} Use your own ChatGPT instead (free).`
            : (copy?.describe?.text ??
              `Tell us in your words. CiteFox writes the ${noun} with CiteFox AI.`)}
        </span>
      </label>
      <label className={`hf-way${way === 'chatbot' ? ' on' : ''}`} data-testid="hf-way-chatbot">
        <input
          type="radio"
          className="sr-only"
          name={name}
          checked={way === 'chatbot'}
          disabled={disabled}
          onChange={() => onWay('chatbot')}
        />
        <span className="hf-way-title">{copy?.chatbot?.title ?? 'Use your own ChatGPT'}</span>
        <span className="hf-way-text">
          {copy?.chatbot?.text ??
            'Copy a ready prompt into ChatGPT, Perplexity, Gemini… and paste the answer back. Free.'}
        </span>
      </label>
    </div>
  )
}
