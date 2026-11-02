import { useEffect, useMemo, useState, type JSX } from 'react'
import type { CoverageLevel, CoveragePriority } from '@shared/domain'
import { askColumn } from '../assistant/sparkle/askColumn'
import type { GapStatus } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { DrillLink, targetHref, type DrillScope } from '../drill'
import { navigateHash, readHash } from '../shell/routes'
import {
  Button,
  Chip,
  COPIED_MS,
  IconButton,
  ListGrid,
  SearchBox,
  UiIcon,
  type ListColumn,
  type MenuItem
} from '../ui'
import { GAP_STATUS_LABEL, GAP_STATUS_TONE, statusVerb } from './gaps/status'
import { gapTarget } from './gapsDrills'
import { NO_GAP_FILTER, toggleIn, type GapFilterState } from './gapsFilter'
import { actionLabel, coverageLabel, priorityLabel, sourceLabel, stageLabel } from './labels'
import {
  COVERAGE_LEVELS,
  STAGE_ORDER,
  coverageTally,
  filterGapRows,
  showingCount,
  type GapListRow
} from './model'

const PRIORITIES: readonly CoveragePriority[] = ['high', 'medium', 'low']
/** Tallest the matrix body grows before it scrolls. Long matrices render only the rows in view. */
const BODY = 520

export interface GapsMatrixProps {
  pageId: string
  rows: readonly GapListRow[]
  population: readonly GapListRow[]
  listed: readonly GapListRow[]
  filter: GapFilterState
  onFilter: (next: GapFilterState) => void
  scope: DrillScope
  /** Opens this row one by one (switches to that view and focuses it). */
  onOpenRow: (row: GapListRow) => void
  /** Open, published or verified for one row or the ticked ones. */
  onSetStatus: (rows: readonly GapListRow[], status: GapStatus) => void
  onRedo: (row: GapListRow) => void
  /** Opens the FAQ draft drawer. Absent: drafts cannot be edited here. */
  onEditDraft?: ((row: GapListRow) => void) | undefined
  /** Opens the Fix drawer with these rows' prompts. */
  onPlanFix: (rows: readonly GapListRow[]) => void
  /** Copies the rows' drafts as FAQPage JSON-LD; false when none has a draft. */
  onCopyJsonLd: (rows: readonly GapListRow[]) => Promise<boolean>
}

const STATUSES: readonly GapStatus[] = ['open', 'published', 'verified']

/** "Copied" for 1.5 s after a copy, keyed by what was copied. */
function useCopied(): [string | null, (key: string) => void] {
  const [copied, setCopied] = useState<string | null>(null)
  useEffect(() => {
    if (copied === null) return
    const timer = window.setTimeout(() => setCopied(null), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [copied])
  return [copied, setCopied]
}

/**
 * The coverage matrix as the v2 list grid: search, a coverage segment,
 * priority toggles, groups by journey stage, and a `⋯` menu per row. A row
 * opens its one-by-one item on click or Enter. The prompt label opens Prompt
 * detail; source and action cells filter the matrix (removable chips).
 */
export function GapsMatrix({
  pageId,
  rows,
  population,
  listed,
  filter,
  onFilter,
  scope,
  onOpenRow,
  onSetStatus,
  onRedo,
  onEditDraft,
  onPlanFix,
  onCopyJsonLd
}: GapsMatrixProps): JSX.Element {
  const [copied, setCopied] = useCopied()
  const copy = (key: string, chosen: readonly GapListRow[]): void => {
    void onCopyJsonLd(chosen).then((done) => {
      if (done) setCopied(key)
    })
  }
  const withDrafts = listed.filter((row) => row.suggestedFaq !== null)
  const copyAllLabel =
    copied === 'all'
      ? 'Copied FAQ JSON-LD'
      : `Copy FAQ JSON-LD: ${pluralize(withDrafts.length, 'FAQ draft')} as FAQPage`
  const set = (patch: Partial<GapFilterState>): void => onFilter({ ...filter, ...patch })
  const tally = coverageTally(population)
  const chips = activeChips(filter)
  // "Showing x of y": y is every row the search and priority keep, before the
  // matrix's own filters (coverage, stage, source, action) narrow it.
  const searched = filterGapRows(rows, {
    query: filter.query,
    priority: filter.priority,
    coverage: []
  })
  const levelValue = filter.coverage.length === 1 ? (filter.coverage[0] ?? 'all') : 'all'
  const columns = useMemo(
    () => matrixColumns(scope, filter, onFilter),
    // The cells read the current filter for their pressed state.
    [scope, filter, onFilter]
  )

  return (
    <div className="gp-matrix">
      {chips.length > 0 ? (
        <ul className="gp-chips" aria-label="Filters from the matrix">
          {chips.map((chip) => (
            <li key={chip.key}>
              <button
                type="button"
                className="gp-chip"
                aria-label={`Remove filter ${chip.label}`}
                onClick={() => set(chip.remove(filter))}
              >
                {chip.label}
                <UiIcon name="x" size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <ListGrid<GapListRow>
        label="Coverage matrix"
        noun={['question', 'questions']}
        rows={listed}
        rowKey={(row) => row.id}
        rowLabel={(row) => `question ${row.position}`}
        columns={[
          ...columns,
          askColumn<GapListRow>((row) => ({
            kind: 'question',
            id: row.promptId,
            label: row.text,
            detail: coverageLabel(row.coverage)
          }))
        ]}
        filter={{
          label: 'Filter by coverage',
          value: levelValue,
          onChange: (value) => set({ coverage: value === 'all' ? [] : [value as CoverageLevel] }),
          resetValue: 'all',
          options: [
            { value: 'all', label: 'All', count: tally.total },
            ...COVERAGE_LEVELS.map((level) => ({
              value: level,
              label: coverageLabel(level),
              count: tally[level]
            }))
          ]
        }}
        toolbar={
          <>
            <SearchBox
              className="ui-lg-search gp-search"
              label="Search questions, gaps or actions"
              value={filter.query}
              onChange={(query) => set({ query })}
            />
            <div className="gp-pri" role="group" aria-label="Priority">
              {PRIORITIES.map((level) => {
                const count = filterGapRows(rows, {
                  ...filter,
                  priority: [],
                  coverage: []
                }).filter((row) => row.priority === level).length
                return (
                  <button
                    key={level}
                    type="button"
                    className="gp-pri-btn"
                    aria-pressed={filter.priority.includes(level)}
                    onClick={() => set({ priority: toggleIn(filter.priority, level) })}
                  >
                    {priorityLabel(level)}
                    <span className="gp-pri-count num">{count}</span>
                  </button>
                )
              })}
            </div>
          </>
        }
        group={{
          key: (row) => ({ key: row.stage, label: stageLabel(row.stage) }),
          order: STAGE_ORDER,
          meta: (groupRows) => {
            const weak = groupRows.filter(
              (row) => row.coverage === 'weak' || row.coverage === 'none'
            ).length
            return weak === 0 ? 'Covered' : `${weak} weak or missing`
          }
        }}
        actions={
          <IconButton
            size="sm"
            icon={copied === 'all' ? 'check' : 'copy'}
            disabled={withDrafts.length === 0}
            label={copyAllLabel}
            data-tip={copyAllLabel}
            onClick={() => copy('all', withDrafts)}
          />
        }
        bulk={({ selected, clear }) => (
          <>
            {STATUSES.map((status) => (
              <Button
                key={status}
                size="sm"
                variant="secondary"
                disabled={selected.every((row) => row.status === status)}
                onClick={() => {
                  onSetStatus(selected, status)
                  clear()
                }}
              >
                {statusVerb(status)}
              </Button>
            ))}
            <Button size="sm" variant="secondary" icon="target" onClick={() => onPlanFix(selected)}>
              Plan as a fix
            </Button>
            <IconButton
              size="sm"
              tip
              icon={copied === 'bulk' ? 'check' : 'copy'}
              label={copied === 'bulk' ? 'Copied' : 'Copy as JSON-LD'}
              disabled={selected.every((row) => row.suggestedFaq === null)}
              onClick={() => copy('bulk', selected)}
            />
          </>
        )}
        rowMenu={(row) =>
          rowMenu(row, pageId, scope, filter, onFilter, {
            onOpenRow,
            onSetStatus,
            onRedo,
            onEditDraft,
            onPlanFix,
            copied: copied === row.id,
            onCopy: () => copy(row.id, [row])
          })
        }
        onActivate={onOpenRow}
        initialSort={[{ key: 'q', dir: 'asc' }]}
        pageSize="all"
        maxBodyHeight={BODY}
        summary={() => showingCount(listed.length, searched.length, 'prompts')}
        empty={
          <div className="gp-empty">
            <p>No questions match this search and these filters.</p>
            <button
              type="button"
              className="ui-btn ui-btn-secondary ui-btn-sm"
              onClick={() => onFilter(NO_GAP_FILTER)}
            >
              Clear search and filters
            </button>
          </div>
        }
      />
    </div>
  )
}

function matrixColumns(
  scope: DrillScope,
  filter: GapFilterState,
  onFilter: (next: GapFilterState) => void
): ListColumn<GapListRow>[] {
  const set = (patch: Partial<GapFilterState>): void => onFilter({ ...filter, ...patch })
  return [
    {
      id: 'q',
      label: '#',
      width: 56,
      numeric: true,
      sort: (row) => row.position,
      render: (row) => <span className="gp-q num">{row.position}</span>
    },
    {
      id: 'prompt',
      label: 'Question',
      width: 'fill',
      minWidth: 220,
      render: (row) => <PromptLabel row={row} scope={scope} />
    },
    {
      id: 'source',
      label: 'Source',
      width: 150,
      render: (row) => (
        <button
          type="button"
          className="gp-cell-btn"
          aria-pressed={filter.source.includes(row.source)}
          aria-label={`Filter by source: ${sourceLabel(row.source)}`}
          onClick={() => set({ source: toggleIn(filter.source, row.source) })}
        >
          {sourceLabel(row.source)}
        </button>
      )
    },
    {
      id: 'coverage',
      label: 'Coverage',
      width: 104,
      sort: (row) => COVERAGE_LEVELS.indexOf(row.coverage),
      render: (row) => (
        <span className={`gp-level gp-level-${row.coverage} gp-level-sm`}>
          {coverageLabel(row.coverage)}
        </span>
      )
    },
    {
      id: 'gap',
      label: 'Main gap',
      width: 220,
      render: (row) => (
        <span className="gp-gap" title={row.mainGap}>
          {row.mainGap}
        </span>
      )
    },
    {
      id: 'action',
      label: 'Action',
      width: 180,
      render: (row) => (
        <span className="gp-actions">
          {row.actions.map((action, index) => (
            <span key={action}>
              {index > 0 ? ' + ' : null}
              <button
                type="button"
                className="gp-cell-btn"
                aria-pressed={filter.action.includes(action)}
                aria-label={`Filter by action ${actionLabel(action)}`}
                onClick={() => set({ action: toggleIn(filter.action, action) })}
              >
                {actionLabel(action)}
              </button>
            </span>
          ))}
        </span>
      )
    },
    {
      id: 'status',
      label: 'Status',
      width: 108,
      sort: (row) => STATUSES.indexOf(row.status),
      render: (row) => (
        <Chip tone={GAP_STATUS_TONE[row.status]} size="sm">
          {GAP_STATUS_LABEL[row.status]}
        </Chip>
      )
    }
  ]
}

interface RowMenuActions {
  onOpenRow: (row: GapListRow) => void
  onSetStatus: (rows: readonly GapListRow[], status: GapStatus) => void
  onRedo: (row: GapListRow) => void
  onEditDraft?: ((row: GapListRow) => void) | undefined
  onPlanFix: (rows: readonly GapListRow[]) => void
  copied: boolean
  onCopy: () => void
}

function rowMenu(
  row: GapListRow,
  pageId: string,
  scope: DrillScope,
  filter: GapFilterState,
  onFilter: (next: GapFilterState) => void,
  actions: RowMenuActions
): MenuItem[] {
  const { onOpenRow, onSetStatus, onRedo, onEditDraft, onPlanFix } = actions
  const target = gapTarget(scope, row.promptId)
  const href = target ? targetHref(target) : null
  const items: MenuItem[] = [
    { id: 'open', label: 'Open one by one', icon: 'list', onSelect: () => onOpenRow(row) }
  ]
  if (href) {
    items.push({
      id: 'detail',
      label: 'See its AI Overview',
      icon: 'eye',
      onSelect: () => navigateHash(href)
    })
  }
  if (row.whereCovered.length > 0) {
    items.push({
      id: 'where',
      label: `Where on the page: ${row.whereCovered.join(', ')}`,
      icon: 'file',
      onSelect: () => navigateHash(readHash(pageId))
    })
  }
  items.push(
    {
      id: 'stage',
      label: filter.stage.includes(row.stage)
        ? `Show every stage`
        : `Only ${stageLabel(row.stage)} questions`,
      icon: 'layers',
      onSelect: () => onFilter({ ...filter, stage: toggleIn(filter.stage, row.stage) })
    },
    ...(onEditDraft
      ? [
          {
            id: 'draft',
            label: row.suggestedFaq ? 'Edit FAQ draft' : 'Write an FAQ draft',
            icon: 'pencil' as const,
            groupStart: true,
            onSelect: () => onEditDraft(row)
          }
        ]
      : []),
    {
      id: 'jsonld',
      label: actions.copied ? 'Copied' : 'Copy as FAQPage JSON-LD',
      icon: actions.copied ? 'check' : 'copy',
      tone: actions.copied ? 'ok' : 'default',
      disabled: row.suggestedFaq === null,
      keepOpen: true,
      groupStart: !onEditDraft,
      onSelect: actions.onCopy
    },
    {
      id: 'plan',
      label: 'Plan as a fix',
      icon: 'target',
      onSelect: () => onPlanFix([row])
    },
    ...STATUSES.filter((status) => status !== row.status).map((status, index) => ({
      id: `status-${status}`,
      label: `${statusVerb(status)}: question ${row.position}`,
      icon: (status === 'open' ? 'refresh' : 'check') as 'refresh' | 'check',
      groupStart: index === 0,
      onSelect: () => onSetStatus([row], status)
    })),
    {
      id: 'redo',
      label: 'Write this row again',
      icon: 'refresh',
      tone: 'ai',
      hint: '10 s',
      onSelect: () => onRedo(row)
    }
  )
  return items
}

function PromptLabel({ row, scope }: { row: GapListRow; scope: DrillScope }): JSX.Element {
  const target = gapTarget(scope, row.promptId)
  if (!target) return <span className="gp-prompt">{row.label}</span>
  return (
    <span className="gp-prompt">
      <DrillLink target={target} className="gx-link" label={`${row.label}: open Question detail`}>
        {row.label}
      </DrillLink>
      {row.text && row.text !== row.label ? <span className="gp-text">{row.text}</span> : null}
    </span>
  )
}

interface Chip {
  key: string
  label: string
  remove: (filter: GapFilterState) => Partial<GapFilterState>
}

/** The stage, source and action filters set from matrix cells, as removable chips. */
function activeChips(filter: GapFilterState): Chip[] {
  return [
    ...filter.stage.map((stage) => ({
      key: `stage:${stage}`,
      label: `Stage: ${stageLabel(stage)}`,
      remove: (current: GapFilterState) => ({ stage: current.stage.filter((s) => s !== stage) })
    })),
    ...filter.source.map((source) => ({
      key: `source:${source}`,
      label: `Source: ${sourceLabel(source)}`,
      remove: (current: GapFilterState) => ({
        source: current.source.filter((s) => s !== source)
      })
    })),
    ...filter.action.map((action) => ({
      key: `action:${action}`,
      label: `Action: ${actionLabel(action)}`,
      remove: (current: GapFilterState) => ({
        action: current.action.filter((a) => a !== action)
      })
    }))
  ]
}
