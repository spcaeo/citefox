import { useMemo, useState, type JSX, type ReactNode } from 'react'
import type { ProjectDetail } from '@shared/ipc'
import { AskSparkle } from '../../../assistant/sparkle/AskSparkle'
import { alertsHash, landingHash } from '../../../shell/routes'
import {
  Button,
  Chip,
  DomainText,
  ListGrid,
  type FilterGroup,
  type ListColumn,
  type ListFilter,
  type MenuItem
} from '../../../ui'
import { ScoreMeter } from '../../cardRows'
import { NO_VALUE } from '../../copy'
import { projectKind, projectStatusWord } from '../../listModel'
import {
  cadenceLine,
  changeLine,
  changeTone,
  scoreLine,
  searchesLine,
  usedPercent
} from '../../scoreCopy'
import type { ProjectActions, ProjectRowActions } from '../types'
import {
  projectMarketLabels,
  projectSortValue,
  rowSearches,
  type ProjectColumn,
  type ProjectRow
} from '../utils/rows'
import { MarketTags, PageScoresPopover, SearchesPopover, TrackedPagesButton } from './ProjectDrills'
import { RenameField, RenameHint } from './RenameField'

function n(value: number): string {
  return value.toLocaleString('en-US')
}

function sortBy(key: ProjectColumn): (row: ProjectRow) => string | number | null {
  return (row) => projectSortValue(row, key)
}

/** "+3" on screen; screen readers hear "+3 since the last check". */
function ShortChange({ change }: { change: number | null }): JSX.Element {
  const line = changeLine(change)
  if (change === null) {
    return (
      <>
        {NO_VALUE}
        <span className="sr-only"> {line}</span>
      </>
    )
  }
  const [short = line, ...rest] = line.split(' ')
  return (
    <>
      {short}
      <span className="sr-only"> {rest.join(' ')}</span>
    </>
  )
}

/**
 * Row actions behind the right-hand `⋯`: Open, Settings, Schedule; Rename,
 * Duplicate and Export; Pause, Resume, Archive or Restore; then Delete.
 */
function projectRowMenu(
  row: ProjectRow,
  actions: ProjectActions,
  edits: ProjectRowActions | undefined,
  onRename: (projectId: string) => void
): MenuItem[] {
  const { project } = row
  const archived = project.status === 'archived'
  const status: MenuItem[] = archived
    ? [
        {
          id: 'restore',
          label: 'Restore',
          icon: 'refresh',
          groupStart: true,
          onSelect: () => void actions.onRestore(project)
        }
      ]
    : [
        {
          id: 'toggle',
          label: project.status === 'paused' ? 'Resume' : 'Pause',
          icon: project.status === 'paused' ? 'play' : 'pause',
          groupStart: true,
          onSelect: () => void actions.onToggleStatus(project)
        },
        ...(edits
          ? [
              {
                id: 'archive',
                label: 'Archive',
                icon: 'inbox' as const,
                onSelect: () => void edits.onArchive(project)
              }
            ]
          : [])
      ]
  const { onDuplicate, onExport, onDelete } = edits ?? {}
  const editItems: MenuItem[] = edits
    ? [
        {
          id: 'rename',
          label: 'Rename',
          icon: 'pencil',
          groupStart: true,
          onSelect: () => onRename(project.id)
        },
        ...(onDuplicate
          ? [
              {
                id: 'duplicate',
                label: 'Duplicate',
                icon: 'copy' as const,
                onSelect: () => void onDuplicate(project)
              }
            ]
          : []),
        ...(onExport
          ? [
              {
                id: 'export',
                label: 'Export project…',
                icon: 'download' as const,
                onSelect: () => void onExport(project)
              }
            ]
          : [])
      ]
    : []
  const remove: MenuItem[] = onDelete
    ? [
        {
          id: 'delete',
          label: 'Delete…',
          icon: 'trash',
          tone: 'danger',
          groupStart: true,
          onSelect: () => onDelete(project)
        }
      ]
    : []
  return [
    {
      id: 'open',
      label: 'Open project',
      icon: 'arrow-right',
      onSelect: () => void actions.onOpen(project.id)
    },
    {
      id: 'settings',
      label: 'Project settings',
      icon: 'sliders',
      onSelect: () => actions.onSettings(project.id)
    },
    {
      id: 'site',
      label: `Open ${project.domain}`,
      icon: 'external',
      hint: 'Browser',
      onSelect: () => {
        window.open(`https://${project.domain}`, '_blank', 'noopener,noreferrer')
      }
    },
    {
      id: 'schedule',
      label: row.schedule ? `Schedule: ${cadenceLine(row.schedule)}` : 'Check timing',
      icon: 'refresh',
      onSelect: () => actions.onGo(project.id, alertsHash('schedule'))
    },
    ...editItems,
    ...status,
    ...remove
  ]
}

/** The client chip repeats nothing: shown only when the client is not the project's name. */
function clientChip(project: ProjectDetail): string | null {
  const client = project.clientName?.trim() ?? ''
  if (client === '' || client.toLowerCase() === project.name.trim().toLowerCase()) return null
  return client
}

/*
 * Widths fit the grid in a 1134 px window (1134 - 220 sidebar - gutters leaves
 * about 833 px with a scrollbar), so no column, Status last, is cut by a sideways scroll.
 */
function projectColumns(
  actions: ProjectActions,
  rename: {
    id: string | null
    save: (project: ProjectDetail, name: string) => Promise<boolean>
    done: () => void
  }
): ListColumn<ProjectRow>[] {
  return [
    {
      id: 'name',
      label: 'Project',
      width: 'fill',
      minWidth: 124,
      sort: sortBy('name'),
      render: ({ project }) => (
        <span className="pj-cell2">
          <span className="pj-name">
            {rename.id === project.id ? (
              <RenameField
                name={project.name}
                onSave={(name) => rename.save(project, name)}
                onCancel={rename.done}
              />
            ) : (
              <a
                className="page-title pj-title"
                title={project.name}
                href={landingHash()}
                aria-label={`Open ${project.name}`}
                onClick={(event) => {
                  event.preventDefault()
                  void actions.onOpen(project.id)
                }}
              >
                {project.name}
              </a>
            )}
            {clientChip(project) ? (
              <Chip size="sm" label="Client">
                {clientChip(project)}
              </Chip>
            ) : null}
            {/* In the name cell, not its own column: the grid has no width to spare at 1134 px. */}
            <AskSparkle
              target={{ kind: 'project', id: project.id, label: project.name }}
              size="xs"
            />
          </span>
          <DomainText className="pj-domain faint" domain={project.domain} />
        </span>
      )
    },
    {
      id: 'tracked',
      label: 'Tracked',
      width: 88,
      numeric: true,
      sort: sortBy('tracked'),
      render: (row) => (
        <span>
          <TrackedPagesButton project={row.project} actions={actions} />{' '}
          <span className="faint">of {n(row.project.foundPageCount)}</span>
        </span>
      )
    },
    {
      id: 'score',
      label: 'Avg score',
      width: 84,
      numeric: true,
      sort: sortBy('score'),
      render: ({ project, score }) =>
        score?.averageScore !== null && score?.averageScore !== undefined ? (
          <span className="score-mini">
            <PageScoresPopover project={project} mode="score" actions={actions}>
              {scoreLine(score.averageScore)}
            </PageScoresPopover>
            <ScoreMeter score={score.averageScore} />
          </span>
        ) : (
          <span>{scoreLine(null)}</span>
        )
    },
    {
      id: 'change',
      label: 'Change',
      width: 60,
      numeric: true,
      sort: sortBy('change'),
      render: ({ project, score }) => (
        <span className={changeTone(score?.change ?? null)}>
          {score?.change !== null && score?.change !== undefined ? (
            <PageScoresPopover project={project} mode="change" actions={actions}>
              <ShortChange change={score.change} />
            </PageScoresPopover>
          ) : (
            <ShortChange change={null} />
          )}
        </span>
      )
    },
    {
      id: 'markets',
      label: 'Markets',
      width: 100,
      sort: sortBy('markets'),
      render: ({ project }) => (
        <span className="tag-list pj-tags">
          <MarketTags
            project={project}
            labels={projectMarketLabels(project)}
            actions={actions}
            empty="No market"
            max={1}
          />
        </span>
      )
    },
    {
      id: 'searches',
      label: 'Searches',
      width: 92,
      sort: sortBy('searches'),
      render: (row) => {
        const searches = rowSearches(row)
        return (
          <SearchesPopover
            project={row.project}
            used={searches.used}
            cap={searches.cap}
            usage={row.usage}
            actions={actions}
            className="dpop-block pj-searches"
          >
            <span className="num">{searchesLine(searches.used, searches.cap)}</span>
            <span
              className={row.project.status === 'active' ? 'bar' : 'bar bar-muted'}
              aria-hidden="true"
            >
              <span style={{ width: `${usedPercent(searches.used, searches.cap)}%` }} />
            </span>
          </SearchesPopover>
        )
      }
    },
    {
      id: 'status',
      label: 'Status',
      width: 76,
      sort: sortBy('status'),
      render: ({ project }) => (
        <Chip size="sm" dot tone={project.status === 'active' ? 'ok' : 'neutral'}>
          {projectStatusWord(project.status)}
        </Chip>
      )
    }
  ]
}

/** Text the toolbar search matches: name, domain, client and kind. */
function searchText({ project }: ProjectRow): string {
  return [project.name, project.domain, project.clientName ?? '', projectKind(project)].join(' ')
}

/**
 * FR-10.5 Projects list: the one v2 list grid. Headers sort (Shift-click adds a
 * second key), the toolbar searches and filters by status and kind, each row
 * opens its project, and Open, Settings, Rename, Duplicate, Export, Pause or
 * Resume, Archive or Restore, and Delete sit behind `⋯`.
 */
export function ProjectTable({
  rows,
  total,
  actions,
  statusFilter,
  kindFilter,
  empty,
  edits,
  onBulkToggle = actions.onToggleStatus
}: {
  /** Rows after the status and kind filters. */
  rows: readonly ProjectRow[]
  /** Every project, for the footer. */
  total: number
  actions: ProjectActions
  statusFilter: ListFilter
  /** Own or Client, as a toolbar dropdown that moves into Filter ▾ when the row is full. */
  kindFilter?: FilterGroup
  empty: ReactNode
  /** Rename, Duplicate, Export, Archive and Delete in the row menu. */
  edits?: ProjectRowActions
  /** Bulk Pause and Resume, one status change per project. Default: the row action. */
  onBulkToggle?: (project: ProjectDetail) => Promise<void>
}): JSX.Element {
  const [renaming, setRenaming] = useState<string | null>(null)
  const columns = useMemo(
    () =>
      projectColumns(actions, {
        id: renaming,
        save: async (project, name) => {
          const saved = (await edits?.onRename(project, name)) ?? false
          if (saved) setRenaming(null)
          return saved
        },
        done: () => setRenaming(null)
      }),
    [actions, edits, renaming]
  )
  return (
    <>
      <RenameHint />
      <ListGrid
        urlKey="projects"
        columnsMenu
        label="Projects"
        noun={['project', 'projects']}
        rows={rows}
        rowKey={(row) => row.project.id}
        rowLabel={(row) => row.project.name}
        columns={columns}
        search={{ text: searchText, placeholder: 'Search name, domain or client' }}
        filter={statusFilter}
        filterControls={kindFilter ? [kindFilter] : undefined}
        initialSort={[{ key: 'name', dir: 'asc' }]}
        rowMenu={(row) => projectRowMenu(row, actions, edits, setRenaming)}
        onActivate={(row) => void actions.onOpen(row.project.id)}
        bulk={({ selected, clear }) => (
          <>
            <Button
              size="sm"
              disabled={!selected.some((row) => row.project.status === 'active')}
              onClick={() => {
                for (const row of selected) {
                  if (row.project.status === 'active') void onBulkToggle(row.project)
                }
                clear()
              }}
            >
              Pause
            </Button>
            <Button
              size="sm"
              disabled={!selected.some((row) => row.project.status === 'paused')}
              onClick={() => {
                for (const row of selected) {
                  if (row.project.status === 'paused') void onBulkToggle(row.project)
                }
                clear()
              }}
            >
              Resume
            </Button>
          </>
        )}
        summary={(info) =>
          info.matching === total
            ? `Showing ${n(info.matching)} ${info.matching === 1 ? 'project' : 'projects'}`
            : `Showing ${n(info.matching)} of ${n(total)} ${total === 1 ? 'project' : 'projects'}`
        }
        empty={empty}
      />
    </>
  )
}
