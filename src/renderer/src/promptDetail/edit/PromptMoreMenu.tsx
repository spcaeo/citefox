import type { JSX } from 'react'
import type { MenuItem } from '../../ui'
import { HeaderMenu } from '../components/FixActions'

/** The header's ⋯ with only the prompt's own actions, for a prompt that has no result to fix yet. */
export function PromptMoreMenu({ items }: { items: readonly MenuItem[] }): JSX.Element {
  return <HeaderMenu label="More question actions" items={items} />
}
