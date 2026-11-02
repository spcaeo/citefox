import {
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode
} from 'react'
import type { BoardWidget, SummaryBoard, WidgetSize } from '@shared/summary-board'
import { IconButton, SegmentedControl, UiIcon } from '../../ui'
import { SIZE_LABEL, WIDGET_INFO } from './catalog'
import { moveBy, moveWidget, nextSize, resizeWidget } from './model'

const SIZE_KEYS: Readonly<Record<string, WidgetSize>> = { s: 's', m: 'm', l: 'l', w: 'w' }

/**
 * The Summary board: widgets on a 4-column grid (2, then 1 on a narrow window). In Edit
 * mode each widget wiggles gently (still under reduced motion), its content rests, and a
 * bar on top moves it (drag, or arrow keys on the handle), sizes it and removes it.
 */
export function Board({
  board,
  editing,
  onChange,
  onRemove,
  renderWidget,
  focusId = null
}: {
  board: SummaryBoard
  editing: boolean
  /** A move or a resize: save it. */
  onChange: (board: SummaryBoard) => void
  onRemove: (widget: BoardWidget) => void
  renderWidget: (widget: BoardWidget) => ReactNode
  /** A widget just added: its handle takes focus. */
  focusId?: string | null
}): JSX.Element {
  const helpId = useId()
  const [preview, setPreview] = useState<SummaryBoard | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [said, setSaid] = useState('')
  const handles = useRef(new Map<string, HTMLButtonElement>())
  const shown = preview ?? board
  const count = shown.widgets.length

  useEffect(() => {
    if (focusId !== null) handles.current.get(focusId)?.focus()
  }, [focusId])

  const announce = (next: SummaryBoard, id: string, verb: string): void => {
    const index = next.widgets.findIndex((widget) => widget.id === id)
    const widget = next.widgets[index]
    if (widget === undefined) return
    setSaid(
      `${WIDGET_INFO[widget.kind].title} ${verb}: place ${index + 1} of ${next.widgets.length}, ${SIZE_LABEL[widget.size].toLowerCase()}.`
    )
  }

  const onKey = (event: KeyboardEvent<HTMLButtonElement>, widget: BoardWidget): void => {
    const key = event.key
    let next: SummaryBoard | null = null
    if (key === 'ArrowLeft' || key === 'ArrowUp') next = moveBy(board, widget.id, -1)
    else if (key === 'ArrowRight' || key === 'ArrowDown') next = moveBy(board, widget.id, 1)
    else if (key === 'Home') next = moveWidget(board, widget.id, 0)
    else if (key === 'End') next = moveWidget(board, widget.id, board.widgets.length - 1)
    else if (key === '+' || key === '=') next = resizeWidget(board, widget.id, nextSize(widget, 1))
    else if (key === '-') next = resizeWidget(board, widget.id, nextSize(widget, -1))
    else if (SIZE_KEYS[key.toLowerCase()] !== undefined && !event.metaKey && !event.ctrlKey) {
      next = resizeWidget(board, widget.id, SIZE_KEYS[key.toLowerCase()] as WidgetSize)
    } else if (key === 'Delete' || key === 'Backspace') {
      event.preventDefault()
      onRemove(widget)
      return
    }
    if (next === null) return
    event.preventDefault()
    if (next !== board) {
      onChange(next)
      announce(
        next,
        widget.id,
        key.startsWith('Arrow') || key === 'Home' || key === 'End' ? 'moved' : 'resized'
      )
      // The handle keeps focus as the widget moves (React keeps it by key).
      requestAnimationFrame(() => handles.current.get(widget.id)?.focus())
    }
  }

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>, widget: BoardWidget): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragId(widget.id)
    setPreview(board)
  }

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>): void => {
    if (dragId === null || preview === null) return
    const under = document
      .elementsFromPoint(event.clientX, event.clientY)
      .map((node) => node.closest<HTMLElement>('[data-widget-id]'))
      .find((node) => node !== null && node.dataset.widgetId !== dragId)
    const overId = under?.dataset.widgetId
    if (overId === undefined) return
    const to = preview.widgets.findIndex((widget) => widget.id === overId)
    if (to < 0) return
    const next = moveWidget(preview, dragId, to)
    if (next !== preview) setPreview(next)
  }

  const onPointerUp = (): void => {
    if (dragId === null) return
    const final = preview
    setDragId(null)
    setPreview(null)
    if (final !== null && final !== board) {
      onChange(final)
      announce(final, dragId, 'moved')
    }
  }

  return (
    <div className={editing ? 'wb-board wb-editing' : 'wb-board'}>
      <p id={helpId} className="sr-only">
        Arrow keys move the widget. S, M, L and W set its size. Delete removes it.
      </p>
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
      <div
        className="wb-grid"
        role={editing ? 'list' : undefined}
        aria-label={editing ? 'Summary widgets' : undefined}
      >
        {shown.widgets.map((widget, index) => {
          const info = WIDGET_INFO[widget.kind]
          return (
            <div
              key={widget.id}
              className={widget.id === dragId ? 'wb-cell wb-dragging' : 'wb-cell'}
              data-widget-id={widget.id}
              data-kind={widget.kind}
              data-size={widget.size}
              role={editing ? 'listitem' : undefined}
              style={{ animationDelay: `${(index % 3) * -90}ms` }}
            >
              {editing ? (
                <div
                  className="wb-edit"
                  role="group"
                  aria-label={`${info.title}, place ${index + 1} of ${count}`}
                >
                  <button
                    type="button"
                    className="wb-handle"
                    ref={(node) => {
                      if (node) handles.current.set(widget.id, node)
                      else handles.current.delete(widget.id)
                    }}
                    aria-label={`Move ${info.title}`}
                    aria-describedby={helpId}
                    data-tip="Drag to move"
                    onKeyDown={(event) => onKey(event, widget)}
                    onPointerDown={(event) => onPointerDown(event, widget)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                  >
                    <UiIcon name="grip" size={16} />
                    <span className="wb-handle-text">{info.title}</span>
                  </button>
                  {info.sizes.length > 1 ? (
                    <SegmentedControl<WidgetSize>
                      label={`Size of ${info.title}`}
                      size="sm"
                      className="wb-size"
                      value={widget.size}
                      options={(['s', 'm', 'l', 'w'] as const)
                        .filter((size) => info.sizes.includes(size))
                        .map((size) => ({
                          value: size,
                          label: SIZE_LABEL[size],
                          icon: (
                            <span className="wb-size-letter" aria-hidden="true">
                              {size.toUpperCase()}
                            </span>
                          ),
                          iconOnly: true
                        }))}
                      onChange={(size) => {
                        const next = resizeWidget(board, widget.id, size)
                        onChange(next)
                        announce(next, widget.id, 'resized')
                      }}
                    />
                  ) : null}
                  <IconButton
                    icon="x"
                    size="sm"
                    tip
                    label={`Remove ${info.title}`}
                    onClick={() => onRemove(widget)}
                  />
                </div>
              ) : null}
              <div className="wb-content" inert={editing || undefined}>
                {renderWidget(widget)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
