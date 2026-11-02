import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent
} from 'react'
import type { SetupDraft, SetupSectionResult } from '@shared/ipc'
import { BusyBar, Button, IconButton } from '../../ui'
import { SectionHead, SectionPanels, SectionStatus } from './SectionChrome'
import type { TextSectionProps } from './types'
import { useSectionActions } from './useSectionActions'
import { useSectionAi, type AiMode } from './useSectionAi'
import { useSectionUrl } from './useSectionUrl'

function textOf(draft: SetupDraft, section: 'summary' | 'topic'): string {
  return section === 'summary' ? draft.summary : draft.topic
}

function withText(
  draft: SetupDraft,
  section: 'summary' | 'topic',
  text: string,
  origin: 'ai' | 'user'
): SetupDraft {
  return section === 'summary'
    ? { ...draft, summary: text, summaryOrigin: origin }
    : { ...draft, topic: text, topicOrigin: origin }
}

/** ✎ Edit for a text section: a box with Save and Cancel, in place. */
function TextEditor({
  initial,
  label,
  multiline,
  placeholder,
  onSave,
  onCancel
}: {
  initial: string
  label: string
  multiline: boolean
  placeholder: string
  onSave: (text: string) => void
  onCancel: () => void
}): JSX.Element {
  const [text, setText] = useState(initial)
  const id = useId()
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [])
  const keys = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    } else if (event.key === 'Enter' && (!multiline || event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      if (text.trim().length > 0) onSave(text.trim())
    }
  }
  return (
    <div className="osc-text-edit">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      {multiline ? (
        <textarea
          ref={ref}
          id={id}
          className="ui-input osc-textarea"
          rows={3}
          value={text}
          placeholder={placeholder}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={keys}
        />
      ) : (
        <input
          ref={ref}
          id={id}
          className="ui-input osc-grow"
          value={text}
          placeholder={placeholder}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={keys}
        />
      )}
      <div className="osc-edit-actions">
        <Button
          variant="primary"
          size="sm"
          disabled={text.trim().length === 0}
          onClick={() => onSave(text.trim())}
        >
          Save
        </Button>
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/**
 * A text section: "What <Brand> does" on step 4 (a card with ✦ Redo and ✎
 * Edit) or the topic on step 8 (a labelled line with ✎). ✦ Redo opens the
 * inline Redo box with the user's words; without Claude it goes the ChatGPT
 * way. A text the user typed is theirs (`origin: 'user'`).
 */
export function TextSection(props: TextSectionProps): JSX.Element {
  const { env, section, title } = props
  const { draft, onDraft } = env
  const look = props.look ?? 'card'
  const text = textOf(draft, section)
  const titleId = useId()
  const url = useSectionUrl(section)
  const editing = url.editId === section

  const current = useCallback(() => [], [])
  const apply = useCallback(
    (result: SetupSectionResult, mode: AiMode) => {
      const next = (result.text ?? result.rows[0]?.name ?? '').trim()
      if (next.length === 0) return 'Nothing came back, so nothing changed.'
      onDraft((now) => withText(now, section, next, 'ai'))
      return mode === 'redo' ? `${title} rewritten.` : `${title} written.`
    },
    [onDraft, section, title]
  )
  const ai = useSectionAi(env, section, current, apply)
  const actions = useSectionActions(env, section, ai, url)
  const working = ai.busy !== null || props.working === true
  const empty = text.trim().length === 0
  const redoText = empty ? 'Write it' : 'Redo'

  const save = (next: string): void => {
    onDraft((now) => withText(now, section, next, 'user'))
    url.stopEdit()
  }

  const editor = (
    <TextEditor
      initial={text}
      label={title}
      multiline={look === 'card'}
      placeholder={props.placeholder}
      onSave={save}
      onCancel={url.stopEdit}
    />
  )

  const status = (
    <SectionStatus
      section={section}
      ai={ai}
      actions={actions}
      announce={env.announce}
      runningText={`CiteFox AI is writing ${title.toLowerCase()}`}
    />
  )

  const panels = (
    <SectionPanels
      title={title}
      redoLabel={props.redoLabel}
      saved={draft.prompts[section] ?? null}
      tracked={0}
      ai={ai}
      actions={actions}
      url={url}
    />
  )

  if (look === 'field') {
    return (
      <section
        className="osc-field"
        aria-labelledby={titleId}
        aria-busy={working || undefined}
        data-testid={`section-${section}`}
      >
        <h2 className="osc-field-label" id={titleId}>
          {title}
        </h2>
        {editing ? (
          editor
        ) : (
          <div className="osc-field-line">
            <span className={empty ? 'osc-field-text osc-placeholder' : 'osc-field-text'}>
              {empty ? props.placeholder : text}
            </span>
            {empty ? (
              <Button
                size="sm"
                variant="text"
                icon="sparkle"
                className="osc-ai-btn"
                title={ai.available ? ai.costText : 'Opens your own ChatGPT'}
                busy={ai.busy !== null}
                onClick={() => url.openPanel('redo')}
              >
                Write one
              </Button>
            ) : null}
            <IconButton
              icon="pencil"
              size="sm"
              label={`Edit ${title}`}
              onClick={() => url.startEdit(section)}
            />
          </div>
        )}
        {status}
        {panels}
      </section>
    )
  }

  return (
    <section
      className="osc-card"
      aria-labelledby={titleId}
      aria-busy={working || undefined}
      data-section={section}
      data-testid={`section-${section}`}
    >
      <BusyBar active={working} />
      <SectionHead title={title} titleId={titleId} {...(props.hint ? { hint: props.hint } : {})}>
        <Button
          size="sm"
          icon="sparkle"
          className="osc-ai-btn"
          title={ai.available ? ai.costText : 'No AI is connected: opens your own ChatGPT'}
          busy={ai.busy !== null}
          aria-expanded={url.panel === 'redo'}
          onClick={() => url.togglePanel('redo')}
        >
          {redoText}
        </Button>
        <IconButton
          size="sm"
          tip
          icon="pencil"
          label="Edit"
          aria-pressed={editing}
          onClick={() => (editing ? url.stopEdit() : url.startEdit(section))}
        />
      </SectionHead>
      {status}
      {editing ? (
        <div className="osc-text-body">{editor}</div>
      ) : (
        <p className={empty ? 'osc-text-body osc-placeholder' : 'osc-text-body'}>
          {empty ? props.placeholder : text}
        </p>
      )}
      {panels}
    </section>
  )
}
