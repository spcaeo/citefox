import type { JSX } from 'react'
import { ChipSection } from './ChipSection'
import { ListSection } from './ListSection'
import { TextSection } from './TextSection'
import type { SectionCardProps } from './types'
import './sections.css'

/**
 * The one section card of onboarding v2 (steps 4, 5, 6 and 8), in three
 * variants: `list` (rows with ticks), `chips`, and `text`. Every variant has
 * the same controls: ✎ edit in place, ✕ remove with Undo, + Add, ✦ Find more
 * (new rows on top, marked "new"), one ⋯ AI menu, the inline Redo box, the
 * prompt editor, the user's own ChatGPT, and the ChatGPT way when Claude is
 * not set up. Open panels and the row being edited are in the URL.
 */
export function SectionCard(props: SectionCardProps): JSX.Element {
  if (props.variant === 'list') return <ListSection {...props} />
  if (props.variant === 'chips') return <ChipSection {...props} />
  return <TextSection {...props} />
}
