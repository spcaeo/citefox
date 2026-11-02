import { useId, useState, type JSX, type ReactNode } from 'react'
import { INSTRUCTION_PLACEHOLDER } from '../assist/model'
import { AssistProgress } from './AssistProgress'
import { Button } from './Button'
import { ClaudeStatusLine } from './ClaudeStatusChip'
import { usePermissions } from './permissionsContext'
import { useAssistProgress, type AssistProgressView } from './useAssistProgress'
import { IconButton } from './IconButton'
import { UiIcon } from './UiIcon'

/** One proposed change. `label` is a small line above, such as the section ("Triggers"). */
export interface SuggestionItem {
  id: string
  label?: string
  text: string
  detail?: string | null
}

export type SuggestionStatus = 'running' | 'ready' | 'error'

export interface SuggestionCardProps {
  /** Such as "Fill gaps from your site". */
  title: string
  /** One line under the title, such as "7 additions across 5 sections · 2 shown". */
  meta?: ReactNode
  /** A short paragraph above the items. */
  body?: ReactNode
  items?: readonly SuggestionItem[]
  /** Controlled selection. Omit to let the card keep it (all items start selected). */
  selected?: readonly string[]
  onSelectedChange?: (ids: string[]) => void
  /** "N facts to re-check before you rely on them", shown as a warning row. */
  recheckCount?: number
  /** Replaces the default re-check sentence. */
  recheck?: ReactNode
  /** Default `ready`. `running` shows a status line in place of the content. */
  status?: SuggestionStatus
  /** The foot line of the live panel while running, until Claude names its connection. */
  runningText?: ReactNode
  /**
   * The live steps (owner feedback #1). Omitted: the card follows every
   * `assist:progress` run that starts while it is running.
   */
  progress?: AssistProgressView
  /** What the call reads, for the panel's connection line ("no searches"). */
  reads?: string
  /** Typical run time in seconds, shown before the first step arrives. */
  expectedSeconds?: number
  error?: string | null
  /** Bottom-right line, such as "30 s · no searches". */
  footnote?: ReactNode
  /** Shows Apply. Receives the selected item ids (all ids when there are no items). */
  onApply?: (ids: string[]) => void
  applyLabel?: string
  /** Shows Undo after an apply. */
  onUndo?: () => void
  /** Shows "Try again" and the instruction box. Receives the typed instruction, if any. */
  onRetry?: (instruction?: string) => void
  onClose: () => void
}

function recheckText(count: number): string {
  return `${count} ${count === 1 ? 'fact' : 'facts'} to re-check before you rely on ${count === 1 ? 'it' : 'them'}`
}

/**
 * One AI suggestion (Theme "Suggestion", Seed-Profile.png "Fill gaps from your
 * site"). Nothing changes until Apply; unconfirmed facts are flagged in a
 * warning row; "Tell Claude what to change…" reruns with an instruction.
 */
export function SuggestionCard(props: SuggestionCardProps): JSX.Element {
  const { title, items = [], status = 'ready', onApply, onUndo, onRetry, onClose } = props
  const headingId = useId()
  const showClaude = usePermissions() !== null
  // Uncontrolled: remember what was unticked, so items that arrive later start ticked.
  const [unticked, setUnticked] = useState<readonly string[]>([])
  const [instruction, setInstruction] = useState('')
  const [applied, setApplied] = useState(false)
  const selected =
    props.selected ?? items.map((item) => item.id).filter((id) => !unticked.includes(id))
  const recheck = props.recheck ?? (props.recheckCount ? recheckText(props.recheckCount) : null)
  // A card without its own progress listens for any run while it is running.
  const followed = useAssistProgress(props.progress === undefined && status === 'running')
  const progress = props.progress ?? followed
  const panel = (
    <AssistProgress
      progress={progress}
      {...(props.reads ? { reads: props.reads } : {})}
      {...(props.expectedSeconds ? { expectedSeconds: props.expectedSeconds } : {})}
      {...(props.runningText ? { note: props.runningText } : {})}
    />
  )

  function toggle(id: string): void {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
    if (props.selected === undefined) {
      setUnticked(items.map((item) => item.id).filter((x) => !next.includes(x)))
    }
    props.onSelectedChange?.(next)
  }

  function apply(): void {
    onApply?.(items.length > 0 ? [...selected] : [])
    setApplied(true)
  }

  return (
    <section
      className="ui-suggest ui-tint"
      data-tint="ai"
      aria-labelledby={headingId}
      aria-busy={status === 'running'}
    >
      <div className="ui-suggest-head">
        <span className="ui-suggest-mark" aria-hidden="true">
          <UiIcon name="sparkle" size={14} />
        </span>
        <div className="ui-suggest-titles">
          <h3 id={headingId}>{title}</h3>
          {props.meta ? <p className="ui-suggest-meta num">{props.meta}</p> : null}
        </div>
        <IconButton icon="x" size="sm" label="Dismiss suggestion" onClick={onClose} />
      </div>
      {status === 'running' ? (
        panel
      ) : status === 'error' ? (
        <>
          <p className="ui-suggest-error" role="alert">
            {props.error ?? 'CiteFox AI could not finish this. Try again.'}
          </p>
          {panel}
        </>
      ) : (
        <>
          {panel}
          {props.body ? <div className="ui-suggest-body">{props.body}</div> : null}
          {items.length > 0 ? (
            <ul className="ui-suggest-items">
              {items.map((item) => (
                <li key={item.id}>
                  <label className="ui-suggest-item">
                    <input
                      type="checkbox"
                      className="ui-check"
                      checked={selected.includes(item.id)}
                      onChange={() => toggle(item.id)}
                    />
                    <span className="ui-suggest-copy">
                      {item.label ? <span className="ui-suggest-label">{item.label}</span> : null}
                      <span className="ui-suggest-text">{item.text}</span>
                      {item.detail ? (
                        <span className="ui-suggest-detail">{item.detail}</span>
                      ) : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
          {recheck ? (
            <p className="ui-suggest-recheck">
              <UiIcon name="warning" size={16} />
              <span>{recheck}</span>
            </p>
          ) : null}
        </>
      )}
      {onRetry && status !== 'running' ? (
        <label className="ui-suggest-instruct">
          <span className="sr-only">Tell CiteFox AI what to change</span>
          <input
            type="text"
            className="ui-input ui-input-sm"
            placeholder={INSTRUCTION_PLACEHOLDER}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && instruction.trim()) onRetry(instruction.trim())
            }}
          />
        </label>
      ) : null}
      <div className="ui-suggest-foot">
        <div className="ui-suggest-actions">
          {onApply && status === 'ready' && !applied ? (
            <Button size="sm" onClick={apply} disabled={items.length > 0 && selected.length === 0}>
              {props.applyLabel ?? 'Apply'}
            </Button>
          ) : null}
          {onUndo && applied ? (
            <Button
              size="sm"
              onClick={() => {
                onUndo()
                setApplied(false)
              }}
            >
              Undo
            </Button>
          ) : null}
          {onRetry && status !== 'running' ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onRetry(instruction.trim() || undefined)}
            >
              Try again
            </Button>
          ) : null}
        </div>
        {props.footnote || showClaude ? (
          <p className="ui-suggest-note num">
            {props.footnote ? <span>{props.footnote}</span> : null}
            <ClaudeStatusLine size="sm" setupHref="#/permissions" />
          </p>
        ) : null}
      </div>
    </section>
  )
}
