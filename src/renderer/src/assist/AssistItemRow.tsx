import { useId, type JSX } from 'react'
import type { AssistItem } from '@shared/ipc'
import { Button, Chip, IconButton, UiIcon } from '../ui'
import { signLabel } from './model'

export type Undo = () => Promise<void>

export type ActionKind = 'apply' | 'add'

export interface ItemState {
  kind: ActionKind
  busy: boolean
  undo: Undo | null
  error: string | null
}

/**
 * One proposed change in an assist result (the v2 suggestion card's item
 * row). Copy, Apply and Add sit at the right; nothing is written until the
 * user presses Apply or Add, which call the screen's own channel.
 */
export function AssistItemRow({
  item,
  state,
  copyOn,
  copied,
  applyLabel,
  addLabel,
  onCopy,
  onAct,
  onUndo
}: {
  item: AssistItem
  state: ItemState | null
  copyOn: boolean
  copied: boolean
  applyLabel: string | null
  addLabel: string | null
  onCopy: () => void
  onAct: (kind: ActionKind) => void
  onUndo: (state: ItemState) => void
}): JSX.Element {
  const textId = useId()
  const sign = signLabel(item.sign)
  const done = state !== null && !state.busy && state.error === null
  return (
    <li className="assist-item">
      <div className="assist-item-body">
        {item.tag ? (
          <Chip size="sm" className="assist-tag">
            {item.tag}
          </Chip>
        ) : null}
        <p id={textId} className="assist-item-text">
          {item.sign ? (
            <span className={`assist-sign ${item.sign}`} aria-hidden="true">
              {item.sign === 'add' ? '+' : '−'}
            </span>
          ) : null}
          {sign ? <span className="sr-only">{sign}: </span> : null}
          {item.text}
        </p>
        {item.detail ? <p className="assist-item-detail">{item.detail}</p> : null}
        {item.verify ? (
          <p className="assist-verify">
            <UiIcon name="warning" size={14} />
            <span>Re-verify: {item.verify}</span>
          </p>
        ) : null}
        {state?.error ? (
          <p className="assist-error" role="alert">
            {state.error}
          </p>
        ) : null}
      </div>
      <div className="assist-item-actions">
        {copyOn ? (
          <IconButton
            size="sm"
            tip
            icon={copied ? 'check' : 'copy'}
            label={copied ? 'Copied' : 'Copy'}
            aria-describedby={textId}
            onClick={onCopy}
          />
        ) : null}
        {done ? (
          <>
            <span className="assist-done" role="status">
              {state.kind === 'add' ? 'Added' : 'Applied'}
            </span>
            {state.undo ? (
              <Button size="sm" aria-describedby={textId} onClick={() => onUndo(state)}>
                Undo
              </Button>
            ) : null}
          </>
        ) : (
          <>
            {applyLabel ? (
              <Button
                size="sm"
                aria-describedby={textId}
                disabled={state?.busy === true}
                onClick={() => onAct('apply')}
              >
                {applyLabel}
              </Button>
            ) : null}
            {addLabel ? (
              <Button
                size="sm"
                icon="plus"
                aria-describedby={textId}
                disabled={state?.busy === true}
                onClick={() => onAct('add')}
              >
                {addLabel}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </li>
  )
}
