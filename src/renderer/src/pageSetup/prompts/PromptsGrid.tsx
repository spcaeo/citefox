import type { JSX } from 'react'
import { pluralize } from '@shared/pluralize'
import type { BuyerPrompt, CoverageLevel, IntentStage } from '@shared/domain'
import type { AssistItem } from '@shared/ipc'
import type { AssistClient } from '../../assist/client'
import { AiSelection } from '../../assistant/context/AiSelection'
import { useAiContext } from '../../assistant/context/useAiContext'
import { askColumn } from '../../assistant/sparkle/askColumn'
import { navigateHash, pageHash, promptHash } from '../../shell/routes'
import {
  Button,
  Chip,
  ListGrid,
  useAssistMenu,
  type ChipTone,
  type ListColumn,
  type MenuItem
} from '../../ui'
import { useGridQueryState } from '../../utils/queryState'
import { coverageLabel, sourceLabel, stageLabel } from '../labels'
import { STAGE_ORDER } from '../model'

type Undo = () => Promise<void>

const COVERAGE_TONE: Readonly<Record<CoverageLevel, ChipTone>> = {
  strong: 'ok',
  partial: 'info',
  weak: 'warn',
  none: 'bad'
}

const STAGE_HINT: Readonly<Record<IntentStage, string>> = {
  problem: 'They feel the pain',
  solution: 'Ways people solve it',
  comparison: 'Weighing the options',
  objection: 'What holds them back',
  trigger: 'What makes them search now',
  unset: 'Not tagged yet'
}

export interface PromptsGridActions {
  onEdit: (prompt: BuyerPrompt) => void
  onRephrase: (prompt: BuyerPrompt) => void
  onAddOwn: () => void
  onSetEnabled: (ids: readonly string[], enabled: boolean) => void
  onRemove: (ids: readonly string[]) => void
  onMove: (promptId: string, delta: number) => void
  onAddSuggested: (item: AssistItem) => Promise<Undo | void>
}

/**
 * The generated buyer prompts as one v2 list grid (Seed-Questions.png): grouped
 * by journey stage, search, Included / Left out filter, bulk leave out and
 * remove, and a ⋯ menu per row. One AI menu for the set.
 */
export function PromptsGrid({
  prompts,
  textOf,
  coverage,
  projectId,
  pageId,
  marketId,
  assistClient,
  actions
}: {
  prompts: readonly BuyerPrompt[]
  textOf: (prompt: BuyerPrompt) => string
  coverage: ReadonlyMap<string, CoverageLevel>
  projectId: string
  pageId: string
  marketId: string
  assistClient?: AssistClient
  actions: PromptsGridActions
}): JSX.Element {
  // Search, Show and sort are on the URL (`pr.q`, `pr.f`, `pr.sort`): Back undoes a Show change.
  const grid = useGridQueryState('pr')
  const filter = grid.filter === 'in' || grid.filter === 'out' ? grid.filter : 'all'
  const included = prompts.filter((prompt) => prompt.enabled)
  useAiContext({
    filters: filter === 'all' ? {} : { show: filter === 'in' ? 'Included' : 'Left out' }
  })
  const rows =
    filter === 'in'
      ? included
      : filter === 'out'
        ? prompts.filter((prompt) => !prompt.enabled)
        : prompts
  const assists = useAssistMenu({
    label: 'AI actions for these questions',
    scope: {
      projectId,
      pageId,
      marketId,
      ...(assistClient ? { client: assistClient } : {})
    },
    actions: [
      {
        assistId: 'prompts.more',
        label: 'Write more like these',
        seconds: 15,
        icon: 'compass',
        applyLabel: 'Add selected',
        onApply: (result, ids) => {
          const chosen = result.items.filter((item) => ids.length === 0 || ids.includes(item.id))
          void (async () => {
            for (const item of chosen) await actions.onAddSuggested(item)
          })()
        }
      },
      {
        assistId: 'prompts.checkPage',
        label: 'Check against the page',
        seconds: 12,
        icon: 'bulb'
      }
    ]
  })

  const columns: ListColumn<BuyerPrompt>[] = [
    {
      id: 'n',
      label: '#',
      width: 56,
      numeric: true,
      align: 'start',
      sort: (row) => row.position,
      render: (row) => <span className="pr-num">{row.position}</span>
    },
    {
      id: 'text',
      label: 'Question',
      width: 'fill',
      minWidth: 260,
      sort: (row) => textOf(row).toLowerCase(),
      render: (row) => (
        <span
          className={row.enabled ? 'pr-text' : 'pr-text pr-text-out'}
          title={`${textOf(row)} (${sourceLabel(row.source)})`}
        >
          {textOf(row)}
        </span>
      )
    },
    {
      id: 'coverage',
      label: 'Page covers it',
      width: 132,
      sort: (row) => {
        const level = coverage.get(row.id)
        return level === undefined ? null : ['strong', 'partial', 'weak', 'none'].indexOf(level)
      },
      render: (row) => {
        const level = coverage.get(row.id)
        return level === undefined ? (
          <span className="pr-muted">—</span>
        ) : (
          <Chip tone={COVERAGE_TONE[level]} size="sm" label="Page covers it">
            {coverageLabel(level)}
          </Chip>
        )
      },
      drill: (row) =>
        coverage.has(row.id)
          ? {
              label: `${coverageLabel(coverage.get(row.id) ?? 'none')} coverage: open question ${row.position} in Content gaps`,
              href: pageHash(pageId, 'gaps', { filter: `row:${row.id}` })
            }
          : null
    },
    {
      id: 'in',
      label: 'In check',
      width: 110,
      sort: (row) => (row.enabled ? 0 : 1),
      render: (row) =>
        row.enabled ? (
          <Chip tone="ok" size="sm">
            Included
          </Chip>
        ) : (
          <span className="pr-muted">Left out</span>
        )
    }
  ]

  const rowMenu = (row: BuyerPrompt): MenuItem[] => [
    { id: 'edit', label: 'Edit wording', icon: 'pencil', onSelect: () => actions.onEdit(row) },
    {
      id: 'rephrase',
      label: 'Rephrase like a buyer',
      icon: 'sparkle',
      tone: 'ai',
      hint: '5 s',
      onSelect: () => actions.onRephrase(row)
    },
    {
      id: 'toggle',
      label: row.enabled ? 'Leave out of the check' : 'Include in the check',
      icon: row.enabled ? 'x' : 'check',
      onSelect: () => actions.onSetEnabled([row.id], !row.enabled)
    },
    {
      id: 'up',
      label: 'Move up',
      icon: 'arrow-up',
      disabled: row.position <= 1,
      onSelect: () => actions.onMove(row.id, -1)
    },
    {
      id: 'down',
      label: 'Move down',
      icon: 'arrow-down',
      disabled: row.position >= prompts.length,
      onSelect: () => actions.onMove(row.id, 1)
    },
    {
      id: 'open',
      label: 'Open question detail',
      icon: 'external',
      onSelect: () => navigateHash(promptHash(pageId, row.id, { marketId: marketId || null }))
    },
    {
      id: 'remove',
      label: 'Remove',
      icon: 'trash',
      tone: 'danger',
      onSelect: () => actions.onRemove([row.id])
    }
  ]

  return (
    <div className="pr-grid-wrap">
      {assists.card}
      <ListGrid
        label="Buyer questions"
        noun={['question', 'questions']}
        rows={rows}
        rowKey={(row) => row.id}
        rowLabel={(row) => `question ${row.position}`}
        columns={[
          ...columns,
          askColumn<BuyerPrompt>((row) => ({
            kind: 'question',
            id: row.id,
            label: textOf(row),
            detail: row.enabled ? stageLabel(row.intentStage) : 'Left out'
          }))
        ]}
        search={{ text: (row) => textOf(row), placeholder: `Search ${prompts.length} questions` }}
        filter={{
          label: 'Show',
          value: filter,
          onChange: (value) => grid.setFilter(value === 'all' ? null : value),
          options: [
            { value: 'all', label: 'All', count: prompts.length },
            { value: 'in', label: 'Included', count: included.length },
            { value: 'out', label: 'Left out', count: prompts.length - included.length }
          ]
        }}
        actions={
          <Button variant="ghost" icon="plus" onClick={actions.onAddOwn}>
            Add my own
          </Button>
        }
        ai={assists.menu}
        group={{
          key: (row) => ({ key: row.intentStage, label: stageLabel(row.intentStage) }),
          order: STAGE_ORDER,
          meta: (groupRows, key) =>
            `${groupRows.filter((row) => row.enabled).length} of ${groupRows.length} included · ${STAGE_HINT[key as IntentStage] ?? ''}`
        }}
        bulk={({ selected, clear }) => {
          const ids = selected.map((row) => row.id)
          return (
            <>
              <AiSelection
                items={selected.map((row) => ({
                  kind: 'question',
                  id: row.id,
                  label: textOf(row)
                }))}
              />
              <Button
                size="sm"
                icon="x"
                onClick={() => {
                  actions.onSetEnabled(ids, false)
                  clear()
                }}
              >
                Leave out
              </Button>
              <Button
                size="sm"
                icon="check"
                onClick={() => {
                  actions.onSetEnabled(ids, true)
                  clear()
                }}
              >
                Include
              </Button>
              <Button
                size="sm"
                icon="trash"
                onClick={() => {
                  actions.onRemove(ids)
                  clear()
                }}
              >
                Remove
              </Button>
            </>
          )
        }}
        rowMenu={rowMenu}
        onActivate={(row) =>
          navigateHash(promptHash(pageId, row.id, { marketId: marketId || null }))
        }
        initialSort={[{ key: 'n', dir: 'asc' }]}
        {...grid.listProps}
        summary={() =>
          `${included.length} of ${prompts.length} included · ${pluralize(new Set(prompts.map((p) => p.intentStage)).size, 'stage')}`
        }
        empty={
          <p className="pr-muted">No questions in this set. Add your own or write them again.</p>
        }
        maxBodyHeight={560}
      />
    </div>
  )
}
