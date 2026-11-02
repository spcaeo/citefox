import { useEffect, useId, useRef, type JSX } from 'react'
import { Button, IconButton, UiIcon } from '../../ui'

/**
 * ✦ Redo this section (mock-up panel 5): an inline box, not a dialog. The
 * user's words steer the redo; the cost line sits under it. Without Claude
 * the button becomes the ChatGPT way, with the same words.
 */
export function RedoBox({
  title,
  redoLabel,
  value,
  onChange,
  saveRule,
  onSaveRule,
  costText,
  available,
  reason,
  busy,
  onRedo,
  onChatbot,
  onEditPrompt,
  onClose
}: {
  title: string
  redoLabel: string
  value: string
  onChange: (value: string) => void
  /** "Save as a project rule": the words then go in every later AI prompt for the project. */
  saveRule: boolean
  onSaveRule: (value: boolean) => void
  costText: string
  available: boolean
  reason: string | null
  busy: boolean
  onRedo: () => void
  onChatbot: () => void
  onEditPrompt: () => void
  onClose: () => void
}): JSX.Element {
  const inputId = useId()
  const hintId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
  }, [])

  function submit(): void {
    if (busy) return
    if (available) onRedo()
    else onChatbot()
  }

  return (
    <div className="osc-panel osc-redo" data-testid="redo-box">
      <div className="osc-panel-head">
        <label htmlFor={inputId} className="osc-panel-title">
          <span className="osc-spark" aria-hidden="true">
            <UiIcon name="sparkle" size={14} />
          </span>
          Redo this section
        </label>
        <span className="osc-hint">
          · only {title} changes; your edits, own items and ticks are kept
        </span>
        <span className="osc-grow" />
        <IconButton icon="x" size="sm" label="Close Redo" onClick={onClose} />
      </div>
      <div className="osc-row">
        <input
          ref={inputRef}
          id={inputId}
          className="ui-input osc-grow"
          value={value}
          placeholder={
            available
              ? 'Tell CiteFox AI what to change, e.g. "don\'t call us a cloud service"'
              : 'Say what to change; your words go into the ChatGPT prompt'
          }
          aria-describedby={hintId}
          disabled={busy}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            }
          }}
        />
        {available ? (
          <Button size="sm" icon="sparkle" busy={busy} busyLabel="Redoing…" onClick={submit}>
            {redoLabel}
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={onChatbot}>
            Use my own ChatGPT
          </Button>
        )}
      </div>
      <label className="osc-rule">
        <input
          type="checkbox"
          checked={saveRule}
          disabled={busy}
          onChange={(event) => onSaveRule(event.target.checked)}
        />
        Save as a project rule
        <span className="osc-hint">
          · CiteFox AI follows it every time; change it in Project settings › Project rules
        </span>
      </label>
      <p className="osc-hint" id={hintId}>
        {available ? costText : (reason ?? 'No AI is connected.')}
        {available
          ? null
          : ' Your own ChatGPT is free: copy the prompt, paste the answer back.'} ·{' '}
        <button type="button" className="osc-link" onClick={onEditPrompt}>
          Edit the prompt instead
        </button>
      </p>
    </div>
  )
}
