import type { JSX, ReactNode } from 'react'
import type { FixSubject, ProjectFix } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { askColumn } from '../../assistant/sparkle/askColumn'
import { Markdown } from '../../components/Markdown'
import { DrillNumber } from '../../drill'
import { FixVerdict } from '../../progress/FixDrills'
import { followUpPhrase, outcomeFor } from '../../progress/model'
import { openDrawer } from '../../shell/drawers'
import { navigateHash } from '../../shell/routes'
import { Button, Chip, EmptyState, ListGrid, type ChipTone, type ListColumn } from '../../ui'
import { newFixValues } from '../drawer/model'
import {
  FIX_STAGES,
  fixDetailHash,
  fixStage,
  stageCounts,
  stageLabel,
  type FixStage,
  type StageFilter
} from '../model'
import { fixQuestionsDrill } from '../drills'
import { SubjectCell } from './SubjectCell'

const STAGE_TONE: Record<FixStage, ChipTone> = { open: 'warn', checking: 'info', done: 'ok' }

/**
 * Every logged fix across pages and topics in the one list grid, grouped by status
 * (open first). A row opens the fix drawer; the `⋯` menu edits it, runs the follow-up
 * (its cost is confirmed first), deletes it (with Undo) or opens the page's fix detail.
 * Questions opens the questions the fix should help.
 */
export function FixesGrid({
  items,
  all,
  subjects,
  stage,
  selectedId,
  busy,
  toolbar,
  onStage,
  onSelect,
  onEdit,
  onRun,
  onDelete
}: {
  /** The fixes the filters show. */
  items: readonly ProjectFix[]
  /** Every fix, for the filter counts. */
  all: readonly ProjectFix[]
  subjects: ReadonlyMap<string, FixSubject>
  stage: StageFilter
  selectedId: string | null
  busy: boolean
  /** The page or topic filter. */
  toolbar: ReactNode
  onStage: (stage: StageFilter) => void
  onSelect: (item: ProjectFix) => void
  onEdit: (item: ProjectFix) => void
  onRun: (item: ProjectFix) => void
  onDelete: (item: ProjectFix) => void
}): JSX.Element {
  const counts = stageCounts(all)
  const columns: readonly ListColumn<ProjectFix>[] = [
    {
      id: 'fix',
      label: 'Fix',
      width: 'fill',
      minWidth: 260,
      sort: (item) => item.fix.number,
      render: ({ fix }) => (
        <span className="fxp-fix">
          <span className="fxp-num">Fix {fix.number}</span>
          <span className="fxp-desc">
            <Markdown inline baseLevel={4}>
              {fix.description.split('\n')[0] ?? ''}
            </Markdown>
          </span>
        </span>
      )
    },
    {
      id: 'subject',
      label: 'Page or topic',
      width: 220,
      sort: (item) => subjects.get(item.fix.pageId)?.label.toLowerCase() ?? null,
      render: (item) => <SubjectCell subject={subjects.get(item.fix.pageId)} />
    },
    {
      id: 'questions',
      label: 'Questions',
      width: 104,
      numeric: true,
      sort: (item) => item.fix.promptIds.length,
      render: ({ fix }) => (
        <DrillNumber
          drill={fixQuestionsDrill(fix, subjects.get(fix.pageId)?.label ?? '')}
          label={`${pluralize(fix.promptIds.length, 'question')} Fix ${fix.number} should help`}
          suffix={fix.promptIds.length === 1 ? ' question' : ' questions'}
        />
      )
    },
    {
      id: 'status',
      label: 'Status',
      width: 104,
      sort: (item) => FIX_STAGES.findIndex((entry) => entry.id === fixStage(item.fix)),
      render: ({ fix }) => (
        <Chip size="sm" tone={STAGE_TONE[fixStage(fix)]}>
          {stageLabel(fixStage(fix))}
        </Chip>
      )
    },
    {
      id: 'followUp',
      label: 'Follow-up check',
      width: 248,
      render: ({ fix }) =>
        fix.status === 'completed' ? (
          <FixVerdict fix={fix} outcome={outcomeFor(fix, null)} />
        ) : (
          <span className="fxp-follow">{sentence(followUpPhrase(fix))}</span>
        )
    }
  ]
  return (
    <ListGrid<ProjectFix>
      urlKey="fixlog"
      label="Fixes"
      noun={['fix', 'fixes']}
      rows={items}
      rowKey={(item) => item.fix.id}
      rowLabel={(item) => `Fix ${item.fix.number}`}
      columns={[
        ...columns,
        askColumn<ProjectFix>((item) => ({
          kind: 'fix',
          id: item.fix.id,
          label: `Fix ${item.fix.number} · ${item.fix.description}`,
          detail: subjects.get(item.fix.pageId)?.label ?? null
        }))
      ]}
      search={{
        text: (item) =>
          `Fix ${item.fix.number} ${item.fix.description} ${subjects.get(item.fix.pageId)?.label ?? ''}`,
        placeholder: 'Search fixes'
      }}
      filter={{
        label: 'Show fixes by status',
        options: [
          { value: 'all', label: 'All', count: counts.all },
          ...FIX_STAGES.map((entry) => ({
            value: entry.id,
            label: entry.label,
            count: counts[entry.id]
          }))
        ],
        value: stage,
        onChange: (value) => onStage(value as StageFilter)
      }}
      toolbar={toolbar}
      group={{
        key: (item) => {
          const id = fixStage(item.fix)
          return { key: id, label: stageLabel(id) }
        },
        order: FIX_STAGES.map((entry) => entry.id)
      }}
      onActivate={onSelect}
      isRowCurrent={(item) => item.fix.id === selectedId}
      rowMenu={(item) => [
        {
          id: 'open',
          label: 'Open the fix on its page',
          icon: 'external' as const,
          onSelect: () => navigateHash(fixDetailHash(subjects.get(item.fix.pageId), item.fix))
        },
        {
          id: 'details',
          label: 'Show what happened',
          icon: 'eye' as const,
          onSelect: () => onSelect(item)
        },
        {
          id: 'edit',
          label: 'Edit…',
          icon: 'pencil' as const,
          disabled: busy,
          onSelect: () => onEdit(item)
        },
        ...(item.fix.status === 'planned'
          ? [
              {
                id: 'follow-up',
                label: 'Run follow-up now…',
                icon: 'refresh' as const,
                disabled: busy,
                onSelect: () => onRun(item)
              }
            ]
          : []),
        ...(item.fix.status !== 'started'
          ? [
              {
                id: 'delete',
                label: 'Delete',
                icon: 'trash' as const,
                disabled: busy,
                onSelect: () => onDelete(item)
              }
            ]
          : [])
      ]}
      empty={
        <EmptyState
          title="No fixes logged yet."
          body="Log a fix and CiteFox re-checks the questions it should help after it goes live."
          action={
            <Button size="sm" icon="plus" onClick={() => openDrawer('fix', newFixValues())}>
              Log a fix
            </Button>
          }
        />
      }
    />
  )
}

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
