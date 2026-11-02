import { useRef, type ClipboardEvent, type JSX, type KeyboardEvent } from 'react'
import { addChips, COMMA_SEPARATOR } from './chipList'
import { UiIcon } from './UiIcon'
import { DomainText } from './UrlText'

/**
 * A text field that turns names into removable chips: Enter or a comma adds
 * what is typed (a pasted "a, b" adds both), Backspace in an empty field
 * removes the last chip, and each chip has its own Remove button. The text
 * still being typed is the caller's `draft`, so a form can count it on submit.
 */
export interface ChipInputProps {
  id: string
  items: readonly string[]
  onItems: (items: string[]) => void
  draft: string
  onDraft: (text: string) => void
  placeholder?: string
  describedBy?: string
  /** Code font, for domains. */
  mono?: boolean
  /** Each chip is a domain: the site icon in front, Copy and Open at the end (UrlText). */
  domains?: boolean
  /**
   * What splits typed or pasted text into chips. Default: commas. Pass
   * `LIST_SEPARATORS` for email addresses ("a@x.com, b@y.com; c@z.com" or one per line).
   */
  separators?: RegExp
  /** Why a chip is not valid ("Not an email address"), or null. Bad chips are marked. */
  invalid?: (item: string) => string | null
}

export function ChipInput({
  id,
  items,
  onItems,
  draft,
  onDraft,
  placeholder,
  describedBy,
  mono = false,
  domains = false,
  separators = COMMA_SEPARATOR,
  invalid
}: ChipInputProps): JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  const splits = (text: string): boolean => new RegExp(separators.source).test(text)

  function commit(text: string): void {
    if (text.trim()) onItems(addChips(items, text, separators))
    onDraft('')
  }

  /** A pasted list (with new lines an input would drop) becomes chips at once. */
  function onPaste(event: ClipboardEvent<HTMLInputElement>): void {
    const text = event.clipboardData.getData('text')
    if (!splits(text) && !/[\r\n]/.test(text)) return
    event.preventDefault()
    commit(`${draft}${text}`)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    const separatorKey = event.key.length === 1 && splits(event.key)
    if (event.key === 'Enter' || separatorKey) {
      if (!draft.trim()) {
        if (separatorKey) event.preventDefault()
        return
      }
      event.preventDefault()
      commit(draft)
    } else if (event.key === 'Backspace' && draft === '' && items.length > 0) {
      event.preventDefault()
      onItems(items.slice(0, -1))
    }
  }

  return (
    <div className="ui-chipbox" onClick={() => input.current?.focus()}>
      {items.map((item) => {
        const problem = invalid?.(item) ?? null
        return (
          <span
            className={problem ? 'ui-chipbox-chip ui-chipbox-chip-bad' : 'ui-chipbox-chip'}
            key={item}
            title={problem ?? undefined}
            data-invalid={problem ? 'true' : undefined}
          >
            {domains ? (
              <DomainText domain={item} />
            ) : (
              <span className={mono ? 'mono' : undefined}>{item}</span>
            )}
            {problem ? <span className="sr-only">{` (${problem})`}</span> : null}
            <button
              type="button"
              aria-label={`Remove ${item}`}
              onClick={(event) => {
                event.stopPropagation()
                onItems(items.filter((value) => value !== item))
                input.current?.focus()
              }}
            >
              <UiIcon name="x" size={14} />
            </button>
          </span>
        )
      })}
      <input
        ref={input}
        id={id}
        className={mono ? 'ui-chipbox-input mono' : 'ui-chipbox-input'}
        value={draft}
        placeholder={items.length === 0 ? placeholder : undefined}
        aria-describedby={describedBy}
        onChange={(event) => {
          const text = event.target.value
          if (splits(text)) commit(text)
          else onDraft(text)
        }}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (draft.trim()) commit(draft)
        }}
      />
    </div>
  )
}
