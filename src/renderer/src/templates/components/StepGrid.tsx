import { useMemo, type JSX } from 'react'
import { templateKindInfo } from '@shared/domain'
import type { TemplateStep, TemplateStepStatus } from '@shared/ipc'
import { askColumn } from '../../assistant/sparkle/askColumn'
import { Chip, EmptyState, ListGrid, type ListColumn } from '../../ui'
import {
  STEP_AREAS,
  STEP_AREA_LABEL,
  STEP_AREA_NOTE,
  STEP_STATUSES,
  STEP_STATUS_LABEL,
  STEP_STATUS_TONE,
  lastRunDay,
  lastRunLine,
  areaPositions,
  stepArea,
  stepListLabel,
  stepSearchText,
  type StepArea,
  versionLine,
  versionShort
} from '../utils/stepCopy'

/** The status filter: every step, or one status. */
export type StepStatusFilter = 'all' | TemplateStepStatus

const SHORT_STATUS: Readonly<Record<TemplateStepStatus, string>> = {
  shipped: 'Default',
  edited: 'Edited',
  project: 'Overridden'
}

/** Room for every row and group header, so the page scrolls, never the list. */
const ROW_PX = 48

/**
 * Every AI step in run order (FR-26.1) as the v2 list grid: search, a
 * status filter, version and last-run drills, and the row menu. Opening a row
 * shows that step in the editor tab.
 */
export function StepGrid({
  steps,
  status,
  selectedKind,
  dirtyKind,
  projectOpen,
  onStatus,
  onOpen,
  onLibrary,
  onVersions,
  onCalls
}: {
  steps: readonly TemplateStep[]
  status: StepStatusFilter
  selectedKind: string | null
  /** The step with unsaved changes, if any. */
  dirtyKind: string | null
  projectOpen: boolean
  onStatus: (status: StepStatusFilter) => void
  /** Selects the step and shows its editor. */
  onOpen: (step: TemplateStep) => void
  /** Selects the step and shows its app templates. */
  onLibrary: (step: TemplateStep) => void
  /** Opens the step's version history drawer. */
  onVersions: (step: TemplateStep) => void
  /** Opens the drawer of AI calls behind "Last run". */
  onCalls: (step: TemplateStep) => void
}): JSX.Element {
  const offered = projectOpen ? STEP_STATUSES : STEP_STATUSES.filter((item) => item !== 'project')
  const rows = status === 'all' ? steps : steps.filter((step) => step.status === status)

  const numbers = useMemo(() => areaPositions(steps), [steps])
  const columns = useMemo((): ListColumn<TemplateStep>[] => {
    const list: ListColumn<TemplateStep>[] = [
      {
        id: 'position',
        label: 'Step',
        width: 72,
        numeric: true,
        sort: (step) => step.position,
        render: (step) => numbers.get(step.kind) ?? step.position
      },
      {
        id: 'name',
        label: 'Template',
        width: 'fill',
        minWidth: 220,
        sort: (step) => templateKindInfo(step.kind).label.toLowerCase(),
        render: (step) => {
          const info = templateKindInfo(step.kind)
          return (
            <span className="tpl-grid-name">
              <span className="tpl-grid-label" title={info.file}>
                {info.label}
              </span>
              {step.kind === dirtyKind ? (
                <Chip tone="warn" size="sm">
                  Unsaved changes
                </Chip>
              ) : null}
            </span>
          )
        }
      },
      {
        id: 'status',
        label: 'Status',
        hint: 'Default: comes with CiteFox · Edited: a named app template is the default · Overridden: this project has its own version',
        width: 140,
        sort: (step) => STEP_STATUSES.indexOf(step.status),
        render: (step) => (
          <Chip
            tone={STEP_STATUS_TONE[step.status]}
            size="sm"
            label={
              STEP_STATUS_LABEL[step.status] === SHORT_STATUS[step.status]
                ? undefined
                : STEP_STATUS_LABEL[step.status]
            }
          >
            <span aria-hidden="true">{SHORT_STATUS[step.status]}</span>
          </Chip>
        )
      },
      {
        id: 'version',
        label: 'Version',
        width: 96,
        numeric: true,
        sort: (step) => step.effective.version,
        render: (step) => (
          <span title={versionLine(step.effective)}>{versionShort(step.effective)}</span>
        ),
        drill: (step) => ({
          label: `Version history: ${versionLine(step.effective)}`,
          onOpen: () => onVersions(step)
        })
      }
    ]
    if (projectOpen) {
      list.push({
        id: 'lastRun',
        label: 'Last run',
        width: 120,
        // Before any AI step ran, the column is all "—": it stays out until one has.
        hideWhenEmpty: true,
        sort: (step) => step.lastRunAt,
        render: (step) => lastRunDay(step) ?? <span className="faint">—</span>,
        drill: (step) =>
          step.lastRunAt === null
            ? null
            : {
                label: `AI calls: ${lastRunLine(step, true) ?? ''}`,
                onOpen: () => onCalls(step)
              }
      })
    }
    list.push(
      askColumn((step) => ({
        kind: 'template',
        id: step.kind,
        label: templateKindInfo(step.kind).label,
        detail: STEP_STATUS_LABEL[step.status]
      }))
    )
    return list
  }, [numbers, dirtyKind, projectOpen, onVersions, onCalls])

  return (
    <ListGrid<TemplateStep>
      label="AI steps"
      noun={['step', 'steps']}
      rows={rows}
      rowKey={(step) => step.kind}
      rowLabel={(step) => templateKindInfo(step.kind).label}
      columns={columns}
      search={{ text: stepSearchText, placeholder: 'Search steps' }}
      filter={{
        label: 'Status',
        options: [
          { value: 'all', label: 'All', count: steps.length },
          ...offered.map((item) => ({
            value: item,
            label: SHORT_STATUS[item],
            count: steps.filter((step) => step.status === item).length
          }))
        ],
        value: status,
        onChange: (value) => onStatus(value as StepStatusFilter)
      }}
      rowMenu={(step) => [
        { id: 'edit', label: 'Edit template', icon: 'pencil', onSelect: () => onOpen(step) },
        {
          id: 'library',
          label: 'App templates',
          icon: 'layers',
          onSelect: () => onLibrary(step)
        },
        {
          id: 'versions',
          label: 'Version history',
          icon: 'refresh',
          onSelect: () => onVersions(step)
        },
        {
          id: 'calls',
          label: 'AI calls',
          icon: 'eye',
          disabled: !projectOpen || step.lastRunAt === null,
          onSelect: () => onCalls(step)
        }
      ]}
      group={{
        key: (step) => {
          const area = stepArea(step.kind)
          return { key: area, label: STEP_AREA_LABEL[area] }
        },
        order: STEP_AREAS,
        meta: (_rows, key) => STEP_AREA_NOTE[key as StepArea]
      }}
      onActivate={onOpen}
      isRowCurrent={(step) => step.kind === selectedKind}
      initialSort={[{ key: 'position', dir: 'asc' }]}
      pageSize="all"
      maxBodyHeight={(steps.length + STEP_AREAS.length) * ROW_PX}
      summary={(info) => stepListLabel(info.matching, steps.length, info.matching !== steps.length)}
      empty={<EmptyState icon="inbox" title="No AI steps to show." />}
    />
  )
}
