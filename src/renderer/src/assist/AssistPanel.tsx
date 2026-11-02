import { useId, useState, type JSX, type ReactNode } from 'react'
import {
  ASSIST_INSTRUCTION_MAX,
  type AssistInputs,
  type AssistItem,
  type AssistResult
} from '@shared/ipc'
import { copyText } from '../components/clipboard'
import { AssistProgress, Button, Chip, IconButton, UiIcon, suggestionFootnote } from '../ui'
import { AssistItemRow, type ActionKind, type ItemState, type Undo } from './AssistItemRow'
import type { AssistClient } from './client'
import {
  INSTRUCTION_PLACEHOLDER,
  NO_NEW_SEARCHES,
  assistErrorText,
  fallbackAssistTitle,
  itemCopyText,
  recheckText,
  resultAnnouncement
} from './model'
import { useAssist } from './useAssist'

export interface AssistActions {
  /** Shown per item as "Apply". Return an undo function to show "Undo". */
  apply?: (item: AssistItem, result: AssistResult) => Promise<Undo | void>
  /** Shown per item as "Add" (for list additions such as prompts). Same undo rule. */
  add?: (item: AssistItem, result: AssistResult) => Promise<Undo | void>
  /** Optional "Apply all" over every item. */
  applyAll?: (result: AssistResult) => Promise<Undo | void>
}

export interface AssistPanelProps {
  assistId: string
  projectId: string | null
  pageId?: string | null
  marketId?: string | null
  promptId?: string | null
  /** Assist-specific values. */
  inputs?: AssistInputs
  actions?: AssistActions
  /** Per-item Copy. Default true. */
  copy?: boolean
  /** Defaults to the assist title from `assist:describe`. */
  buttonLabel?: string
  /** Text of the per-item Apply button. Default "Apply". */
  applyLabel?: string
  /** Text of the per-item Add button. Default "Add". */
  addLabel?: string
  /** A line under the button, such as which saved checks the assist reads. */
  note?: ReactNode
  /** Disables the button, for example before the page has been read. */
  disabled?: boolean
  /** Defaults to `createAssistClient(currentClientMode())`. */
  client?: AssistClient
  onResult?: (result: AssistResult) => void
}

/**
 * One AI assist (FR-25.1 to FR-25.5) in the v2 look: a sparkle button, the
 * "Claude · about N s" line and the "No new searches" chip, and the result in
 * place as a suggestion card (Theme "Suggestion"). Nothing changes until the
 * user picks Apply or Add, which call the screen's own channels through
 * `actions`. Unconfirmed facts are flagged for re-checking.
 *
 * A section with several assists should show ONE AI menu instead
 * (`useAssistMenu` in ui/); this panel stays for single-assist placements.
 */
export function AssistPanel(props: AssistPanelProps): JSX.Element {
  const assist = useAssist(props)
  const { description, phase, result, error } = assist
  const [instruction, setInstruction] = useState('')
  const [items, setItems] = useState<Readonly<Record<string, ItemState>>>({})
  const [allState, setAllState] = useState<(ItemState & { runId: string }) | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const panelId = useId()
  const instructionId = useId()
  const title = props.buttonLabel ?? description?.title ?? fallbackAssistTitle(props.assistId)
  const open = phase !== 'idle'
  const acceptsInstruction = description?.acceptsInstruction ?? true
  const savedDataOnly = description?.savedDataOnly ?? result?.savedDataOnly ?? false
  const label = result?.label.text ?? description?.label.text ?? null
  const copyOn = props.copy ?? true
  const actions = props.actions ?? {}

  // Item states are keyed by run, so a new result starts clean without an effect.
  const runId = result?.runId ?? ''
  const all = allState?.runId === runId ? allState : null
  const keyOf = (id: string): string => `${runId}\u0000${id}`

  function setAll(next: ItemState | null): void {
    setAllState(next ? { ...next, runId } : null)
  }

  function patchItem(id: string, next: ItemState | null): void {
    const key = keyOf(id)
    setItems((current) => {
      const copy = { ...current }
      if (next) copy[key] = next
      else delete copy[key]
      return copy
    })
  }

  async function act(kind: ActionKind, item: AssistItem, current: AssistResult): Promise<void> {
    const handler = kind === 'apply' ? actions.apply : actions.add
    if (!handler) return
    patchItem(item.id, { kind, busy: true, undo: null, error: null })
    try {
      const undo = await handler(item, current)
      patchItem(item.id, { kind, busy: false, undo: undo ?? null, error: null })
    } catch (cause: unknown) {
      patchItem(item.id, { kind, busy: false, undo: null, error: assistErrorText(cause) })
    }
  }

  async function undoItem(id: string, state: ItemState): Promise<void> {
    if (!state.undo) return
    patchItem(id, { ...state, busy: true, error: null })
    try {
      await state.undo()
      patchItem(id, null)
    } catch (cause: unknown) {
      patchItem(id, { ...state, busy: false, error: assistErrorText(cause) })
    }
  }

  async function applyEvery(current: AssistResult): Promise<void> {
    if (!actions.applyAll) return
    setAll({ kind: 'apply', busy: true, undo: null, error: null })
    try {
      const undo = await actions.applyAll(current)
      setAll({ kind: 'apply', busy: false, undo: undo ?? null, error: null })
    } catch (cause: unknown) {
      setAll({ kind: 'apply', busy: false, undo: null, error: assistErrorText(cause) })
    }
  }

  async function undoEvery(state: ItemState): Promise<void> {
    if (!state.undo) return
    setAll({ ...state, busy: true, error: null })
    try {
      await state.undo()
      setAll(null)
    } catch (cause: unknown) {
      setAll({ ...state, busy: false, error: assistErrorText(cause) })
    }
  }

  function tryAgain(): void {
    assist.run(acceptsInstruction ? instruction : null)
  }

  function close(): void {
    assist.close()
    setInstruction('')
  }

  async function copyItem(item: AssistItem): Promise<void> {
    if (await copyText(itemCopyText(item))) setCopied(keyOf(item.id))
  }

  const recheck = result ? result.items.filter((entry) => entry.verify).length : 0

  return (
    <div className="assist">
      <div className="assist-head">
        <Button
          size="sm"
          icon="sparkle"
          className="assist-trigger"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          disabled={props.disabled === true || phase === 'running'}
          onClick={() => (open ? close() : assist.run(null))}
        >
          {title}
        </Button>
        {label ? <span className="assist-label">{label}</span> : null}
        {savedDataOnly ? (
          <Chip size="sm" tone="ok" className="assist-free">
            {NO_NEW_SEARCHES}
          </Chip>
        ) : null}
      </div>
      {props.note ? <p className="assist-note">{props.note}</p> : null}

      {phase === 'running' ? (
        <AssistProgress
          progress={assist.progress}
          title="Asking CiteFox AI…"
          {...(savedDataOnly ? { reads: 'no new searches' } : {})}
          {...(description ? { expectedSeconds: description.label.expectedSeconds } : {})}
        />
      ) : null}
      <div aria-live="polite" className="assist-live">
        {phase === 'done' && result ? (
          <p className="sr-only">{resultAnnouncement(result)}</p>
        ) : null}
      </div>

      {open && phase !== 'running' ? (
        <section className="assist-panel" id={panelId} role="region" aria-label={title}>
          <div className="assist-panel-head">
            <span className="assist-mark" aria-hidden="true">
              <UiIcon name="sparkle" size={14} />
            </span>
            <div className="assist-panel-titles">
              <p className="assist-panel-title">{result?.title ?? title}</p>
              <p className="assist-panel-meta num">
                {result
                  ? `${result.items.length} ${result.items.length === 1 ? 'suggestion' : 'suggestions'} · changes nothing until you apply`
                  : 'Nothing was changed'}
              </p>
            </div>
            <IconButton icon="x" size="sm" label="Close" onClick={close} />
          </div>
          {phase === 'error' ? (
            <p className="assist-error" role="alert">
              {error}
            </p>
          ) : null}
          {phase === 'done' && result ? (
            <>
              {result.summary ? <p className="assist-summary">{result.summary}</p> : null}
              {result.items.length > 0 ? (
                <ul className="assist-items">
                  {result.items.map((entry) => (
                    <AssistItemRow
                      key={entry.id}
                      item={entry}
                      state={items[keyOf(entry.id)] ?? null}
                      copyOn={copyOn}
                      copied={copied === keyOf(entry.id)}
                      applyLabel={actions.apply ? (props.applyLabel ?? 'Apply') : null}
                      addLabel={actions.add ? (props.addLabel ?? 'Add') : null}
                      onCopy={() => void copyItem(entry)}
                      onAct={(kind) => void act(kind, entry, result)}
                      onUndo={(state) => void undoItem(entry.id, state)}
                    />
                  ))}
                </ul>
              ) : null}
              {recheck > 0 ? (
                <p className="assist-recheck">
                  <UiIcon name="warning" size={16} />
                  <span>{recheckText(recheck)}</span>
                </p>
              ) : null}
              {result.caution ? <p className="assist-caution">{result.caution}</p> : null}
            </>
          ) : null}
          {acceptsInstruction ? (
            <div className="assist-instruction">
              <label className="sr-only" htmlFor={instructionId}>
                Tell CiteFox AI what to change
              </label>
              <input
                id={instructionId}
                className="ui-input ui-input-sm"
                type="text"
                value={instruction}
                maxLength={ASSIST_INSTRUCTION_MAX}
                placeholder={INSTRUCTION_PLACEHOLDER}
                onChange={(event) => setInstruction(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    tryAgain()
                  }
                }}
              />
            </div>
          ) : null}
          <div className="assist-foot">
            <div className="assist-row">
              {phase === 'done' && result && actions.applyAll ? (
                all && !all.busy && all.undo ? (
                  <>
                    <span className="assist-done">Applied.</span>
                    <Button size="sm" onClick={() => void undoEvery(all)}>
                      Undo
                    </Button>
                  </>
                ) : all && !all.busy && !all.error ? (
                  <span className="assist-done">Applied.</span>
                ) : (
                  <Button
                    size="sm"
                    disabled={all?.busy === true}
                    onClick={() => void applyEvery(result)}
                  >
                    Apply all
                  </Button>
                )
              ) : null}
              <Button size="sm" variant="ghost" onClick={tryAgain}>
                Try again
              </Button>
              {all?.error ? <span className="assist-error">{all.error}</span> : null}
            </div>
            {result && phase === 'done' ? (
              <p className="assist-footnote num">{suggestionFootnote(result)}</p>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  )
}
