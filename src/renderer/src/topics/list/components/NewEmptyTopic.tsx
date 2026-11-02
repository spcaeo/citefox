import { useId, useState, type FormEvent, type JSX } from 'react'
import { errorText } from '../../../components/errorText'
import { Button } from '../../../ui'

/**
 * "+ New empty topic" (`#/topics?new=empty`): a name now, questions later.
 * Nothing is checked until the topic has a question. Escape or Cancel closes it.
 */
export function NewEmptyTopic({
  onCreate,
  onCancel
}: {
  /** Resolves when the topic is made; rejects with the reason to show. */
  onCreate: (name: string) => Promise<void>
  onCancel: () => void
}): JSX.Element {
  const id = useId()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    const value = name.trim().replace(/\s+/gu, ' ')
    if (value.length === 0) {
      setError('Give the topic a name.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onCreate(value)
    } catch (cause) {
      setError(errorText(cause, 'Could not create the topic.'))
      setSaving(false)
    }
  }

  return (
    <form
      className="tl-new-empty"
      aria-label="New empty topic"
      onSubmit={(event) => void submit(event)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel()
      }}
    >
      <div className="tl-new-empty-field">
        <label htmlFor={id} className="tl-new-empty-label">
          New empty topic
        </label>
        <input
          id={id}
          className="ui-input"
          value={name}
          maxLength={120}
          placeholder="Such as Pricing questions"
          aria-describedby={`${id}-hint`}
          aria-invalid={error !== null || undefined}
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />
        {error ? (
          <p id={`${id}-hint`} className="tl-error" role="alert">
            {error}
          </p>
        ) : (
          <p id={`${id}-hint`} className="tl-new-empty-hint">
            A name now, questions later. Nothing is checked until it has a question.
          </p>
        )}
      </div>
      <div className="tl-new-empty-actions">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" icon="plus" busy={saving}>
          Create topic
        </Button>
      </div>
    </form>
  )
}
