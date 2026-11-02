import type { JSX } from 'react'
import { Icon } from '../../components/Icon'
import { UrlText } from '../../ui'
import { describedBy } from '../../onboarding/copy'
import { FieldError } from '../../onboarding/parts'
import { providerSummary, type ProviderGuide } from '../guides'

/** How to set up one provider: steps, links, note and warning. */
export function ProviderGuideBlock({ guide }: { guide: ProviderGuide }): JSX.Element {
  return (
    <div className="guide">
      <div className="sec-head">
        <h3>How to set it up · {guide.name}</h3>
        <span className="mono faint">{providerSummary(guide.provider)}</span>
      </div>
      <ol className="steps">
        {guide.steps.map((item) => (
          <li key={item.text}>
            {item.text}
            {item.url && item.linkText ? (
              <>
                {' '}
                <UrlText url={item.url} label={item.linkText} plain />
              </>
            ) : null}
            {item.after}
          </li>
        ))}
      </ol>
      {guide.note ? (
        <div className="note">
          <Icon name="info" />
          <p className="muted">{guide.note}</p>
        </div>
      ) : null}
      {guide.warn ? (
        <div className="note note-warn">
          <Icon name="warning" />
          <p>
            <span className="warn-ink">Heads-up:</span> {guide.warn}
          </p>
        </div>
      ) : null}
      <p className="faint">
        Links open in your browser. Links and settings checked Oct 2026; providers change them.
      </p>
    </div>
  )
}

export function TextField({
  id,
  label,
  value,
  onChange,
  error,
  type = 'text',
  mono = false,
  optional = false,
  placeholder,
  hint,
  spellCheck,
  autoComplete,
  inputMode
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  type?: 'text' | 'email'
  mono?: boolean
  optional?: boolean
  placeholder?: string
  hint?: string
  spellCheck?: boolean
  autoComplete?: string
  inputMode?: 'numeric'
}): JSX.Element {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
        {optional ? <span className="opt"> (optional)</span> : null}
      </label>
      <input
        id={id}
        className={mono ? 'ob-input mono' : 'ob-input'}
        type={type}
        inputMode={inputMode}
        placeholder={placeholder}
        spellCheck={spellCheck}
        autoComplete={autoComplete}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy([hintId, errorId])}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? (
        <span className="hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </div>
  )
}
