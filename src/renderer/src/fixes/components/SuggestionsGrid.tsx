import type { JSX } from 'react'
import type { FixSubject, GapSuggestion } from '@shared/ipc'
import { coverageLabel, priorityLabel } from '../../pageSetup/labels'
import { openDrawer } from '../../shell/drawers'
import { navigateHash } from '../../shell/routes'
import { Chip, ListGrid, type ChipTone, type ListColumn } from '../../ui'
import { newFixValues } from '../drawer/model'
import { gapHash } from '../model'
import { SubjectCell } from './SubjectCell'

const PRIORITY_TONE: Record<GapSuggestion['priority'], ChipTone> = {
  high: 'bad',
  medium: 'warn',
  low: 'neutral'
}

/** The open content-gap rows that are not fixes yet, from each page's latest gap matrix. */
export function SuggestionsGrid({
  items,
  subjects
}: {
  items: readonly GapSuggestion[]
  subjects: ReadonlyMap<string, FixSubject>
}): JSX.Element {
  const columns: readonly ListColumn<GapSuggestion>[] = [
    {
      id: 'question',
      label: 'Question',
      width: 'fill',
      minWidth: 240,
      render: (gap) => (
        <span className="fxp-question">
          {gap.promptLabel ? <span className="fxp-num">{gap.promptLabel}</span> : null}
          <span className="fxp-desc">{gap.promptText ?? 'A question no longer in the set'}</span>
        </span>
      )
    },
    {
      id: 'subject',
      label: 'Page or topic',
      width: 220,
      sort: (gap) => subjects.get(gap.pageId)?.label.toLowerCase() ?? null,
      render: (gap) => <SubjectCell subject={subjects.get(gap.pageId)} />
    },
    {
      id: 'coverage',
      label: 'Covered',
      width: 104,
      sort: (gap) => ['none', 'weak', 'partial', 'strong'].indexOf(gap.coverage),
      render: (gap) => coverageLabel(gap.coverage)
    },
    {
      id: 'priority',
      label: 'Priority',
      width: 96,
      sort: (gap) => ['high', 'medium', 'low'].indexOf(gap.priority),
      render: (gap) => (
        <Chip size="sm" tone={PRIORITY_TONE[gap.priority]}>
          {priorityLabel(gap.priority)}
        </Chip>
      )
    },
    {
      id: 'change',
      label: 'What to change',
      width: 280,
      render: (gap) => (
        <span className="fxp-change" title={gap.whatToUpdate}>
          {gap.whatToUpdate}
        </span>
      )
    }
  ]
  return (
    <ListGrid<GapSuggestion>
      label="Content gaps not fixed yet"
      noun={['gap', 'gaps']}
      rows={items}
      rowKey={(gap) => gap.id}
      rowLabel={(gap) => gap.promptLabel ?? 'Gap'}
      columns={columns}
      initialSort={[{ key: 'priority', dir: 'asc' }]}
      pageSize={10}
      onActivate={(gap) => navigateHash(gapHash(subjects.get(gap.pageId), gap))}
      rowMenu={(gap) => [
        {
          id: 'open',
          label: 'Open in Content gaps',
          icon: 'external' as const,
          onSelect: () => navigateHash(gapHash(subjects.get(gap.pageId), gap))
        },
        {
          id: 'plan',
          label: 'Log as a fix',
          icon: 'plus' as const,
          onSelect: () =>
            openDrawer(
              'fix',
              newFixValues({ pageId: gap.pageId, promptIds: [gap.promptId], from: gap.id })
            )
        }
      ]}
      empty={null}
    />
  )
}
