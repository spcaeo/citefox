import type { JSX } from 'react'
import { Dropdown } from '../../ui'
import type { GroupMode, QuestionsView } from '../model'

const GROUP_OPTIONS: readonly { value: GroupMode; label: string }[] = [
  { value: 'topic', label: 'Topic' },
  { value: 'stage', label: 'Stage' },
  { value: 'target', label: 'Right page' },
  { value: 'none', label: 'None' }
]

/**
 * The list toolbar's Group ▾ (audit2 #7: one "Group by" control). Market is one
 * of the grid's `filterControls` (`questionMarketGroup`),
 * and the other filters live in its one Filter ▾ button (`questionFilterGroups`).
 */
export function QuestionGroupControls({
  view,
  onChange
}: {
  view: QuestionsView
  onChange: (patch: Partial<QuestionsView>) => void
}): JSX.Element {
  return (
    <Dropdown
      size="sm"
      prefix="Group"
      aria-label="Group by"
      value={view.group}
      onChange={(group) => onChange({ group: group as GroupMode })}
      options={GROUP_OPTIONS}
    />
  )
}
