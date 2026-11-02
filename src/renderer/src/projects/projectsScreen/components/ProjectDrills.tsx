import { useEffect, useState, type JSX, type MouseEvent, type ReactNode } from 'react'
import type { ProjectUsageRow } from '@shared/domain'
import type { ProjectDetail } from '@shared/ipc'
import { pageHash, pagesHash, sectionHash } from '../../../shell/routes'
import { changeLine } from '../../scoreCopy'
import { meanOf, pageScoreList, searchRows } from '../utils/drills'
import { settingsHeading } from '../utils/goTo'
import { DrillPopover, PopoverList, type PopoverRow } from './DrillPopover'

import type { PageScoreRow } from '../utils/drills'
import { errorText } from '../../../components/errorText'

/**
 * What the project drills need: open a place in a project (switching to it
 * first), and load a project's page scores.
 */
export interface ProjectDrillActions {
  /** Switches to the project, then opens `hash`, then focuses `focusId` once drawn. */
  onGo: (projectId: string, hash: string, focusId?: string) => void
  loadPageScores: (projectId: string) => Promise<readonly PageScoreRow[]>
}

function n(value: number): string {
  return value.toLocaleString('en-US')
}

/** "186" tracked pages: opens that project's All pages on the Tracked pages preset. */
export function TrackedPagesButton({
  project,
  actions
}: {
  project: ProjectDetail
  actions: ProjectDrillActions
}): JSX.Element {
  return (
    <a
      className="drill-num"
      href={pagesHash({ view: 'tracked' })}
      aria-label={`Open the ${n(project.trackedPageCount)} tracked pages of ${project.name} in All pages`}
      onClick={(event) => {
        event.preventDefault()
        actions.onGo(project.id, pagesHash({ view: 'tracked' }))
      }}
    >
      {n(project.trackedPageCount)}
    </a>
  )
}

/** The average score (or change) that opens the page scores behind it, each opening its Progress tab. */
export function PageScoresPopover({
  project,
  mode,
  actions,
  children,
  className
}: {
  project: ProjectDetail
  mode: 'score' | 'change'
  actions: ProjectDrillActions
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <DrillPopover
      className={className ?? 'drill-num'}
      label={
        mode === 'score'
          ? `Avg score of ${project.name}: show each page's score`
          : `Score change of ${project.name}: show each page's change`
      }
      title={mode === 'score' ? 'Page scores' : 'Score change by page'}
      subtitle={`${project.name} · default market of each page`}
      body={(close) => (
        <PageScoresBody project={project} mode={mode} actions={actions} close={close} />
      )}
    >
      {children}
    </DrillPopover>
  )
}

function PageScoresBody({
  project,
  mode,
  actions,
  close
}: {
  project: ProjectDetail
  mode: 'score' | 'change'
  actions: ProjectDrillActions
  close: () => void
}): JSX.Element {
  const [rows, setRows] = useState<readonly PageScoreRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { loadPageScores } = actions
  useEffect(() => {
    let live = true
    loadPageScores(project.id).then(
      (loaded) => {
        if (live) setRows(loaded)
      },
      (cause: unknown) => {
        if (live) setError(errorText(cause, 'Could not load page scores.'))
      }
    )
    return () => {
      live = false
    }
  }, [loadPageScores, project.id])
  if (error) {
    return (
      <p className="field-error" role="alert">
        {error}
      </p>
    )
  }
  if (rows === null) return <p role="status">Loading page scores…</p>
  const listed = pageScoreList(rows, mode)
  const average = meanOf(listed.map((row) => (mode === 'score' ? row.score : row.change)))
  const items: PopoverRow[] = listed.map((row) => ({
    id: row.pageId,
    label: row.label,
    value: mode === 'score' ? n(Math.round(row.score ?? 0)) : signed(Math.round(row.change ?? 0)),
    detail: mode === 'score' ? changeLine(row.change) : `Score ${scoreText(row.score)}`,
    openLabel: `Open the Progress tab of ${row.label}`,
    onOpen: () => actions.onGo(project.id, pageHash(row.pageId, 'progress'))
  }))
  return (
    <>
      <p className="dpop-total" data-testid="dpop-total">
        <span>
          {mode === 'score' ? 'Average of' : 'Mean change of'} {listed.length}{' '}
          {listed.length === 1 ? 'page' : 'pages'}
        </span>
        <span className="mono">
          {average === null ? '—' : mode === 'score' ? n(average) : signed(average)}
        </span>
      </p>
      <PopoverList
        rows={items}
        close={close}
        label={mode === 'score' ? 'Page scores, lowest first' : 'Score change, biggest loss first'}
        empty={
          mode === 'score'
            ? 'No tracked page has a score yet.'
            : 'No tracked page has a previous check yet.'
        }
      />
    </>
  )
}

function signed(value: number): string {
  return value < 0 ? `−${Math.abs(value)}` : `+${value}`
}

function scoreText(score: number | null): string {
  return score === null ? '—' : n(Math.round(score))
}

/** Market tags that open that project's markets in Project settings. */
export function MarketTags({
  project,
  labels,
  actions,
  empty,
  max
}: {
  project: ProjectDetail
  labels: readonly string[]
  actions: ProjectDrillActions
  empty: string
  /** Shows at most this many tags, then one "+N" tag that opens the same markets. */
  max?: number
}): JSX.Element {
  if (labels.length === 0) return <span className="faint">{empty}</span>
  const shown = max !== undefined && labels.length > max ? labels.slice(0, max) : labels
  const rest = labels.slice(shown.length)
  function open(event: MouseEvent<HTMLAnchorElement>): void {
    event.preventDefault()
    actions.onGo(project.id, sectionHash('project-settings'), settingsHeading('ps-markets'))
  }
  return (
    <>
      {shown.map((label) => (
        <a
          className="tag"
          key={label}
          href={sectionHash('project-settings')}
          aria-label={`${label}: open the markets of ${project.name} in Project settings`}
          onClick={open}
        >
          {label}
        </a>
      ))}
      {rest.length > 0 ? (
        <a
          className="tag"
          href={sectionHash('project-settings')}
          title={rest.join(', ')}
          aria-label={`${rest.length} more: ${rest.join(', ')}. Open the markets of ${project.name} in Project settings`}
          onClick={open}
        >
          +{rest.length}
        </a>
      ) : null}
    </>
  )
}

/** Searches this month for one project: shared and own-key split, cap, share, Claude calls. */
export function SearchesPopover({
  project,
  used,
  cap,
  usage,
  actions,
  children,
  className
}: {
  project: ProjectDetail
  /** The number on the screen. The first row repeats it. */
  used: number
  cap: number | null
  usage: ProjectUsageRow | undefined
  actions: ProjectDrillActions
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <DrillPopover
      className={className ?? 'drill-num'}
      label={`${n(used)} searches this month in ${project.name}: show the breakdown`}
      title="Searches this month"
      subtitle={project.name}
      body={(close) => (
        <PopoverList
          close={close}
          label={`Searches this month in ${project.name}`}
          rows={searchRows(used, cap, usage)}
        />
      )}
      foot={(close) => (
        <>
          <button
            type="button"
            className="dpop-link"
            onClick={() => {
              close()
              actions.onGo(
                project.id,
                sectionHash('project-settings'),
                settingsHeading('ps-searches')
              )
            }}
          >
            Search settings
          </button>
          <a href={sectionHash('connections')} onClick={close}>
            Connections
          </a>
        </>
      )}
    >
      {children}
    </DrillPopover>
  )
}
