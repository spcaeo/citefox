import { useContext, type JSX, type ReactNode } from 'react'
import { AiSectionTitleContext, useAiSlot } from './aiSlot'
import { ClaudeStatusLine } from './ClaudeStatusChip'
import { AI_MENU_FOOTER, aiMenuItems, type AiAction } from './componentModels'
import { MenuButton } from './Menu'
import { UiIcon } from './UiIcon'

export type { AiAction }

export interface AiMenuProps {
  /** Accessible name of the menu and button. Default "AI actions". */
  label?: string
  actions: readonly AiAction[]
  /** Line under the actions. Default "Runs on your Claude plan. Uses no searches." */
  footer?: ReactNode
  /** `md` 32px (default, toolbars and cards), `sm` 28px icon-only (section headers). */
  size?: 'md' | 'sm'
  /** Which edge the menu lines up with. Default `end`. */
  align?: 'start' | 'end'
}

/**
 * The one AI menu per section or grid toolbar (Theme.dc.html "AI menu · one per
 * card"): a sparkle "AI" button that opens a short menu. Each line says what
 * runs and roughly how long; results land as one suggestion card.
 */
export function AiMenu({
  label = 'AI actions',
  actions,
  footer = AI_MENU_FOOTER,
  size = 'md',
  align = 'end'
}: AiMenuProps): JSX.Element {
  // The last line opens Ask CiteFox about this section (assistant/AiSlotProvider).
  const section = useContext(AiSectionTitleContext)
  const slotItem = useAiSlot()?.menuItem?.(section) ?? null
  // A menu with its own Ask line ("Ask about this topic") keeps just that one.
  const askItem = actions.some((action) => action.id === 'ask') ? null : slotItem
  const items = aiMenuItems(actions)
  return (
    <MenuButton
      label={label}
      items={askItem ? [...items, { ...askItem, groupStart: items.length > 0 }] : items}
      footer={
        <>
          {footer}
          <ClaudeStatusLine size="sm" className="ui-ai-claude" />
        </>
      }
      align={align}
      width={272}
      trigger={(props, open) => (
        <button
          {...props}
          type="button"
          aria-label={label}
          // The icon-only size names itself on hover too, so the ✦ is never bare.
          title={size === 'sm' ? label : undefined}
          className={`ui-ai-btn${size === 'sm' ? ' ui-ai-btn-sm' : ''}${open ? ' ui-ai-on' : ''}`}
        >
          <span className="ui-ai-spark">
            <UiIcon name="sparkle" size={16} />
          </span>
          {size === 'md' ? (
            <>
              <span aria-hidden="true">AI</span>
              <UiIcon name="chevron-down" size={12} />
            </>
          ) : null}
        </button>
      )}
    />
  )
}
