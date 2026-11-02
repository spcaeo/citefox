import { useCallback, useEffect, useId, useRef, useState, type JSX } from 'react'
import type { SetupItem, SetupRow } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { BusyBar, UiIcon } from '../../ui'
import { currentRows, mergeIntoList, withList } from './draftOps'
import { addItem, editItem, removeItem, restoreItem } from './merge'
import {
  FindMoreButton,
  SectionHead,
  SectionMenu,
  SectionPanels,
  SectionStatus
} from './SectionChrome'
import { sectionMenuLines } from './menuLines'
import type { ChipSectionProps } from './types'
import { useSectionActions } from './useSectionActions'
import { useSectionAi, type AiMode } from './useSectionAi'
import { useSectionUrl } from './useSectionUrl'

/** An inline box for a chip: + Add, or ✎ on a chip. Enter saves, Escape cancels. */
function ChipInputBox({
  initial,
  label,
  placeholder,
  keepOpen = false,
  onSave,
  onCancel
}: {
  initial: string
  /** + Add: the box stays open and empties after each chip. */
  keepOpen?: boolean
  label: string
  placeholder: string
  onSave: (text: string) => string | null
  onCancel: () => void
}): JSX.Element {
  const [text, setText] = useState(initial)
  const [problem, setProblem] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [])
  return (
    <span className="osc-chip-edit">
      <input
        ref={ref}
        className="ui-input ui-input-sm"
        aria-label={label}
        value={text}
        placeholder={placeholder}
        onChange={(event) => {
          setText(event.target.value)
          setProblem(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            const next = onSave(text)
            setProblem(next)
            if (next === null && keepOpen) setText('')
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
        onBlur={() => {
          if (text.trim() === initial.trim()) onCancel()
        }}
      />
      {problem ? (
        <span className="osc-hint osc-warn" role="status">
          {problem}
        </span>
      ) : null}
    </span>
  )
}

/**
 * A chip section card (mock-up panels 4 and 5: brand names, what sends buyers
 * looking): chips with ✕ (Undo), ✎ by clicking a chip, a dashed "+ Add",
 * ✦ Find more and the ⋯ menu. Chips have no tick: ✕ leaves one out.
 */
export function ChipSection(props: ChipSectionProps): JSX.Element {
  const { env, list, title, noun } = props
  const { draft, onDraft } = env
  const items = draft.lists[list]
  const titleId = useId()
  const url = useSectionUrl(list)
  const addKey = `${list}.add`
  const adding = url.editId === addKey

  const current = useCallback((mode: AiMode) => currentRows(items, mode), [items])
  const apply = useCallback(
    (result: { rows: readonly SetupRow[] }, mode: AiMode) =>
      mergeIntoList(onDraft, list, result.rows, mode, noun, items),
    [onDraft, list, noun, items]
  )
  const ai = useSectionAi(env, list, current, apply)
  const actions = useSectionActions(env, list, ai, url)
  const working = ai.busy !== null || props.working === true

  const change = (update: (now: readonly SetupItem[]) => readonly SetupItem[]): void => {
    onDraft((now) => withList(now, list, update))
  }

  function remove(item: SetupItem): void {
    const { removed } = removeItem(items, item.id)
    change((now) => removeItem(now, item.id).items)
    if (removed === null) return
    const message = `Removed “${item.name}”.`
    env.announce(`${message} Undo is available for a few seconds.`)
    actions.offerUndo({
      message,
      undo: () => change((now) => restoreItem(now, removed))
    })
  }

  function add(text: string): string | null {
    const name = text.trim()
    if (name.length === 0) return null
    const row: SetupRow = { name, detail: '', url: null, tag: null }
    if (!addItem(items, row).added) return `“${name}” is already listed.`
    change((now) => addItem(now, row).items)
    env.announce(`Added “${name}”.`)
    return null
  }

  function rename(item: SetupItem, text: string): string | null {
    const name = text.trim()
    if (name.length === 0) return `Type a ${noun.one}, or use ✕ to remove it.`
    change((now) => editItem(now, item.id, { name }))
    url.stopEdit()
    return null
  }

  const lines = sectionMenuLines({ findMoreLabel: 'Find more…', actions, url, ai })

  return (
    <section
      className="osc-card"
      aria-labelledby={titleId}
      aria-busy={working || undefined}
      data-section={list}
      data-testid={`section-${list}`}
    >
      <BusyBar active={working} />
      <SectionHead
        title={title}
        titleId={titleId}
        count={items.length}
        countLabel={pluralize(items.length, noun.one, noun.many)}
        {...(props.hint ? { hint: props.hint } : {})}
      >
        <FindMoreButton label="Find more" ai={ai} onClick={actions.findMore} />
        <SectionMenu title={title} lines={lines} ai={ai} url={url} />
      </SectionHead>
      <SectionStatus
        section={list}
        ai={ai}
        actions={actions}
        announce={env.announce}
        runningText={
          ai.busy === 'more'
            ? `CiteFox AI is looking for more ${noun.many}`
            : `CiteFox AI is redoing ${title.toLowerCase()}`
        }
      />
      <ul className="osc-chips" aria-label={title}>
        {items.map((item) =>
          url.editId === item.id ? (
            <li key={item.id}>
              <ChipInputBox
                initial={item.name}
                label={`Edit ${item.name}`}
                placeholder={props.addPlaceholder}
                onSave={(text) => rename(item, text)}
                onCancel={url.stopEdit}
              />
            </li>
          ) : (
            <li
              key={item.id}
              className={`osc-chip${item.fresh ? ' osc-chip-new' : item.origin === 'ai' ? ' osc-chip-ai' : ''}`}
              data-testid="section-chip"
            >
              <button
                type="button"
                className="osc-chip-name"
                aria-label={`Edit ${item.name}`}
                title="Edit"
                onClick={() => url.startEdit(item.id)}
              >
                {item.name}
              </button>
              {item.fresh ? <span className="osc-tag osc-tag-new">new</span> : null}
              <button
                type="button"
                className="osc-chip-x"
                aria-label={`Remove ${item.name}`}
                onClick={() => remove(item)}
              >
                <UiIcon name="x" size={12} />
              </button>
            </li>
          )
        )}
        <li>
          {adding ? (
            <ChipInputBox
              initial=""
              label={`Add a ${noun.one}`}
              placeholder={props.addPlaceholder}
              keepOpen
              onSave={add}
              onCancel={url.stopEdit}
            />
          ) : (
            <button
              type="button"
              className="osc-chip osc-chip-add"
              onClick={() => url.startEdit(addKey)}
            >
              + Add
            </button>
          )}
        </li>
      </ul>
      <SectionPanels
        title={title}
        redoLabel={props.redoLabel}
        saved={draft.prompts[list] ?? null}
        tracked={items.length}
        ai={ai}
        actions={actions}
        url={url}
      />
    </section>
  )
}
