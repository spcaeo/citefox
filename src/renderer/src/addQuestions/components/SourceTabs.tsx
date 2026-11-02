import { useRef, type JSX, type KeyboardEvent } from 'react'
import { UiIcon } from '../../ui'
import { ADD_TABS, panelId, tabId, type AddTab } from '../types'

const LABEL: Readonly<Record<AddTab, string>> = {
  type: 'Type or paste',
  import: 'Import a file',
  suggest: 'Help me write',
  tracked: 'From tracked questions'
}

/**
 * The four ways in (AddQuestions.dc.html): a pill tab strip with arrow keys,
 * Home and End, and the hint for the open tab beside it.
 */
export function SourceTabs({
  tab,
  hint,
  onTab
}: {
  tab: AddTab
  hint: string
  onTab: (tab: AddTab) => void
}): JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  function move(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const last = ADD_TABS.length - 1
    let next: number | null = null
    if (event.key === 'ArrowRight') next = index >= last ? 0 : index + 1
    else if (event.key === 'ArrowLeft') next = index <= 0 ? last : index - 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last
    if (next === null) return
    event.preventDefault()
    const picked = ADD_TABS[next]
    if (picked) onTab(picked)
    refs.current[next]?.focus()
  }

  return (
    <div className="aq-tabs-row">
      <div className="aq-tabs" role="tablist" aria-label="How to add questions">
        {ADD_TABS.map((item, index) => {
          const on = item === tab
          return (
            <button
              key={item}
              ref={(node) => {
                refs.current[index] = node
              }}
              type="button"
              role="tab"
              id={tabId(item)}
              aria-selected={on}
              aria-controls={panelId(item)}
              tabIndex={on ? 0 : -1}
              className={on ? 'aq-tab on' : 'aq-tab'}
              onClick={() => onTab(item)}
              onKeyDown={(event) => move(event, index)}
            >
              {item === 'suggest' ? <UiIcon name="sparkle" size={14} /> : null}
              {LABEL[item]}
            </button>
          )
        })}
      </div>
      <p className="aq-hint aq-tabs-hint">{hint}</p>
    </div>
  )
}
