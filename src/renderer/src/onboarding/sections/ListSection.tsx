import { useCallback, useId, type JSX } from 'react'
import type { SetupItem, SetupRow } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { BusyBar } from '../../ui'
import { currentRows, mergeIntoList, withList } from './draftOps'
import { AddRow, ListRow, RowEditor } from './ListRows'
import { addItem, editItem, removeItem, restoreItem, toggleItem } from './merge'
import { rowBadge } from './rowView'
import {
  FindMoreButton,
  SectionHead,
  SectionMenu,
  SectionPanels,
  SectionStatus
} from './SectionChrome'
import { sectionMenuLines } from './menuLines'
import type { ListSectionProps } from './types'
import { useSectionActions } from './useSectionActions'
import { useSectionAi, type AiMode } from './useSectionAi'
import { useSectionUrl } from './useSectionUrl'

function plainRow(text: string): SetupRow | null {
  const name = text.trim()
  return name.length > 0 ? { name, detail: '', url: null, tag: null } : null
}

/**
 * A list section card (mock-up panels 4, 5, 6 and 8): tick, ✎ edit in place,
 * ✕ remove with Undo, + Add at the end, ✦ Find more (new rows on top, marked
 * "new"), and the ⋯ menu with Redo, Edit the prompt and the user's own ChatGPT.
 */
export function ListSection(props: ListSectionProps): JSX.Element {
  const { env, list, title, noun, fields } = props
  const { draft, onDraft } = env
  const items = draft.lists[list]
  const titleId = useId()
  const url = useSectionUrl(list)

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
    if (url.editId === item.id) url.stopEdit()
    if (removed === null) return
    const message = `Removed “${item.name}”.`
    env.announce(`${message} Undo is available for a few seconds.`)
    actions.offerUndo({
      message,
      undo: () => {
        change((now) => restoreItem(now, removed))
        env.announce(`“${item.name}” is back.`)
      }
    })
  }

  function add(text: string): string | null {
    const row = (props.parseAdd ?? plainRow)(text)
    if (row === null) return `Type a ${noun.one} first.`
    const check = addItem(items, row)
    if (!check.added) {
      return check.id === null ? `Type a ${noun.one} first.` : `“${row.name}” is already listed.`
    }
    change((now) => addItem(now, row).items)
    env.announce(`Added “${row.name}”.`)
    return null
  }

  const kept = items.filter((item) => item.kept).length
  const findMoreLabel = props.findMoreLabel ?? 'Find more'
  const lines = sectionMenuLines({
    findMoreLabel: props.findMoreMenuLabel ?? `${findMoreLabel}…`,
    ...(props.findMoreHint ? { findMoreHint: props.findMoreHint } : {}),
    actions,
    url,
    ai
  })

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
        countLabel={`${pluralize(items.length, noun.one, noun.many)}, ${kept} kept`}
        {...(props.hint ? { hint: props.hint } : {})}
      >
        <FindMoreButton label={findMoreLabel} ai={ai} onClick={actions.findMore} />
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
      {items.length > 0 ? (
        <ul className="osc-items" aria-label={title}>
          {items.map((item) =>
            url.editId === item.id ? (
              <RowEditor
                key={item.id}
                item={item}
                fields={fields}
                onToggle={() => change((now) => toggleItem(now, item.id))}
                onCancel={url.stopEdit}
                onSave={(patch) => {
                  change((now) => editItem(now, item.id, patch))
                  url.stopEdit()
                }}
              />
            ) : (
              <ListRow
                key={item.id}
                item={item}
                sub={
                  props.renderSub
                    ? props.renderSub(item)
                    : item.detail || (item.origin === 'user' && !item.edited ? 'Added by you' : '')
                }
                badge={rowBadge(item, props.aiLabel, props.rowTag)}
                onToggle={() => change((now) => toggleItem(now, item.id))}
                onEdit={() => url.startEdit(item.id)}
                onRemove={() => remove(item)}
              />
            )
          )}
        </ul>
      ) : (
        <p className="osc-empty">
          Nothing here yet. Add your own below, or ✦ {findMoreLabel.toLowerCase()} with{' '}
          {ai.available ? 'CiteFox AI' : 'your own ChatGPT'}.
        </p>
      )}
      <AddRow
        placeholder={props.addPlaceholder}
        label={`Add a ${noun.one}`}
        {...(props.addMono ? { mono: true } : {})}
        onAdd={add}
      />
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
