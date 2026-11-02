import { useId, type JSX } from 'react'
import { UiIcon } from '../../ui'
import type { SetupWay } from './url'

/**
 * The three ways to set a new project up (HelpFill.dc.html panel 4), as the
 * helper's choice cards: "✦ Read my website" (in-app Claude, cost shown), "Use my
 * own ChatGPT" (one prompt, one paste, free) and "I'll fill it in" (the form as
 * it is). A radio group, so arrow keys move between them. With no Claude key the
 * website card says so and cannot be picked.
 */
export function SetupWays({
  way,
  domain,
  available,
  costText,
  reason,
  disabled,
  onWay
}: {
  way: SetupWay | null
  /** The domain typed so far, or '' for none. */
  domain: string
  /** False: no Claude connection. Null: not known yet. */
  available: boolean | null
  costText: string | null
  reason: string | null
  disabled: boolean
  onWay: (way: SetupWay) => void
}): JSX.Element {
  const name = useId()
  const noKey = available === false
  const site = domain.length > 0 ? domain : 'your site'
  const card = (id: SetupWay, extra = ''): string =>
    `hf-way su-way${way === id ? ' on' : ''}${extra}`
  return (
    <div className="hf-ways su-ways" role="radiogroup" aria-label="How to set it up">
      <label className={card('website', noKey ? ' off' : '')} data-testid="su-way-website">
        <input
          type="radio"
          className="sr-only"
          name={name}
          checked={way === 'website'}
          disabled={disabled || noKey}
          onChange={() => onWay('website')}
        />
        <span className="hf-way-title">
          <span className="hf-spark" aria-hidden="true">
            <UiIcon name="sparkle" size={14} />
          </span>
          Read my website
        </span>
        <span className="hf-way-text">
          {noKey
            ? `${reason ?? 'Needs CiteFox AI connected.'} Use your own ChatGPT instead (free).`
            : `CiteFox reads ${site} and drafts it with CiteFox AI.`}
        </span>
        {!noKey && costText ? <span className="hf-way-text num">{costText}</span> : null}
      </label>
      <label className={card('chatbot')} data-testid="su-way-chatbot">
        <input
          type="radio"
          className="sr-only"
          name={name}
          checked={way === 'chatbot'}
          disabled={disabled}
          onChange={() => onWay('chatbot')}
        />
        <span className="hf-way-title">Use my own ChatGPT</span>
        <span className="hf-way-text">One prompt, one paste. Free, no key needed.</span>
      </label>
      <label className={card('form')} data-testid="su-way-form">
        <input
          type="radio"
          className="sr-only"
          name={name}
          checked={way === 'form'}
          disabled={disabled}
          onChange={() => onWay('form')}
        />
        <span className="hf-way-title">I’ll fill it in</span>
        <span className="hf-way-text">The form, as today.</span>
      </label>
    </div>
  )
}
