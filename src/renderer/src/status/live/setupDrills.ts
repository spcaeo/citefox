import type { PageSummary } from '@shared/domain'
import type { SetupFailure, SetupRunStep, SetupStatus } from '@shared/ipc'
import type { DrillItem, ItemDrill } from '../../drill/types'
import { APP_SCOPE } from '../../keys/serpUsage'
import { pageHash } from '../../shell/routes'
import { formatClock, formatDay } from '../../utils/dates'
import { inProject, type ProjectNames } from '../utils/drills'
import { setupKey, type RunningSetupPage } from './useSetupStatus'

const STEP_LABELS: Readonly<Record<SetupRunStep, string>> = {
  read: 'Reading the page',
  profile: 'Buyer profile',
  prompts: 'Buyer questions',
  coverage: 'Coverage'
}

export function setupStepLabel(step: SetupRunStep): string {
  return STEP_LABELS[step]
}

/** Pages that gave up after their retries. They wait for Retry. */
export function gaveUp(status: SetupStatus): readonly SetupFailure[] {
  return status.failures.filter((failure) => failure.retryAt === null)
}

/** A page behind a setup count: from `SetupStatus.pages`, or rebuilt in this window. */
interface PageLine {
  projectId: string
  pageId: string
  label: string | null
  url: string | null
}

function when(iso: string): string {
  return `${formatDay(iso, { year: false })} ${formatClock(iso)}`
}

function pageItem(
  names: ProjectNames,
  page: { projectId: string; pageId: string; label: string | null; url: string | null },
  secondary: string | null,
  cells: Readonly<Record<string, string>>,
  detail: string | null = null
): DrillItem {
  const link = inProject(names, page.projectId, pageHash(page.pageId, 'results'))
  return {
    id: setupKey(page.projectId, page.pageId),
    primary: page.label ?? page.url ?? page.pageId,
    secondary: [secondary, link.note].filter((part): part is string => Boolean(part)).join(' · '),
    target: link.target,
    cells,
    detail
  }
}

function failureDetail(failure: SetupFailure): string {
  return [
    `**What happened:** ${failure.reason}`,
    failure.nextStep ? `**Next step:** ${failure.nextStep}` : null,
    `**Tries:** ${failure.attempts}`
  ]
    .filter((part): part is string => part !== null)
    .join('\n\n')
}

function failedItem(names: ProjectNames, failure: SetupFailure): DrillItem {
  return pageItem(
    names,
    failure,
    `${failure.projectName} · ${failure.reason}`,
    { step: setupStepLabel(failure.step), at: when(failure.failedAt) },
    failureDetail(failure)
  )
}

/** Failed for good: the step, the reason and the next step, each opening its page. */
export function setupFailedDrill(status: SetupStatus, names: ProjectNames): ItemDrill {
  const failed = new Map(
    gaveUp(status).map((failure) => [setupKey(failure.projectId, failure.pageId), failure])
  )
  return {
    kind: 'items',
    id: 'setup:failed',
    title: 'Setup failed',
    description:
      'Pages whose setup stopped after its retries. Expand a row for the reason, or retry them from the Page setup card.',
    noun: ['page', 'pages'],
    primaryLabel: 'Page',
    columns: [
      { id: 'step', label: 'Stopped at', width: '130px' },
      { id: 'at', label: 'When', width: '110px' }
    ],
    items: status.pages
      ? status.pages.failed.map((line) => {
          // `failures` lists at most 50; a page past that still opens, without its reason.
          const failure = failed.get(setupKey(line.projectId, line.pageId)) ?? null
          return failure
            ? failedItem(names, failure)
            : pageItem(names, withUrl(line), line.projectName, { step: '—', at: '—' })
        })
      : gaveUp(status).map((failure) => failedItem(names, failure)),
    note: 'Select a page to open it.',
    scope: APP_SCOPE
  }
}

/**
 * Waiting: pages still setting up that are not running and did not fail for
 * good. A page waiting to retry says when.
 */
export function setupWaitingDrill(
  status: SetupStatus,
  settingUp: readonly PageSummary[] | null,
  running: ReadonlyMap<string, RunningSetupPage>,
  names: ProjectNames
): ItemDrill | null {
  const failedKeys = new Set(gaveUp(status).map((item) => setupKey(item.projectId, item.pageId)))
  const retrying = new Map(
    status.failures
      .filter((failure) => failure.retryAt !== null)
      .map((failure) => [setupKey(failure.projectId, failure.pageId), failure])
  )
  // Main lists the waiting pages; older runners only count them, so fall back to pages:list.
  const waiting: readonly PageLine[] | null = status.pages
    ? status.pages.waiting
    : settingUp
      ? settingUp
          .filter((page) => {
            const key = setupKey(page.projectId, page.id)
            return !failedKeys.has(key) && !running.has(key)
          })
          .map((page) => ({
            projectId: page.projectId,
            pageId: page.id,
            label: page.label ?? page.title,
            url: page.url
          }))
      : null
  if (waiting === null) return null
  return {
    kind: 'items',
    id: 'setup:waiting',
    title: 'Waiting for setup',
    description: status.holdReason
      ? `Pages still setting up. Nothing starts now: ${status.holdReason}`
      : `Pages still setting up. CiteFox starts up to ${status.pagesPerHour} an hour.`,
    noun: ['page', 'pages'],
    primaryLabel: 'Page',
    columns: [
      { id: 'project', label: 'Project', width: '140px' },
      { id: 'next', label: 'Next', width: '140px' }
    ],
    items: waiting.map((page) => {
      const retry = retrying.get(setupKey(page.projectId, page.pageId)) ?? null
      return pageItem(
        names,
        page,
        retry ? `${setupStepLabel(retry.step)} failed: ${retry.reason}` : page.url,
        {
          project: names.name(page.projectId),
          next: retry?.retryAt ? `Retry ${when(retry.retryAt)}` : 'Waiting its turn'
        },
        retry ? failureDetail(retry) : null
      )
    }),
    note: 'Select a page to open it.',
    scope: APP_SCOPE
  }
}

function labelOf(
  page: RunningSetupPage,
  settingUp: readonly PageSummary[] | null
): { label: string | null; url: string } {
  const found = settingUp?.find(
    (item) => item.id === page.pageId && item.projectId === page.projectId
  )
  return { label: found?.label ?? found?.title ?? null, url: found?.url ?? page.pageId }
}

/** Running now, with the step each page is on. */
export function setupRunningDrill(
  running: ReadonlyMap<string, RunningSetupPage>,
  settingUp: readonly PageSummary[] | null,
  names: ProjectNames,
  listed?: readonly PageLine[]
): ItemDrill {
  return {
    kind: 'items',
    id: 'setup:running',
    title: 'Setting up now',
    description: 'Pages CiteFox is setting up right now, with the step each one is on.',
    noun: ['page', 'pages'],
    primaryLabel: 'Page',
    columns: [{ id: 'step', label: 'Step', width: '140px' }],
    items: listed
      ? listed.map((line) => {
          const seen = running.get(setupKey(line.projectId, line.pageId))
          return pageItem(names, withUrl(line), seen?.message ?? null, {
            step: seen ? setupStepLabel(seen.step) : 'Starting'
          })
        })
      : [...running.values()].map((page) =>
          pageItem(
            names,
            { ...labelOf(page, settingUp), projectId: page.projectId, pageId: page.pageId },
            page.message,
            { step: setupStepLabel(page.step) }
          )
        ),
    note: 'Select a page to open it.',
    scope: APP_SCOPE
  }
}

/** Done today, as this window saw them finish. */
export function setupDoneDrill(
  done: readonly RunningSetupPage[],
  settingUp: readonly PageSummary[] | null,
  names: ProjectNames,
  listed?: readonly PageLine[]
): ItemDrill {
  return {
    kind: 'items',
    id: 'setup:done',
    title: 'Set up today',
    description: 'Pages that finished setup today. Their first check runs on their scheduled date.',
    noun: ['page', 'pages'],
    primaryLabel: 'Page',
    columns: [{ id: 'project', label: 'Project', width: '140px' }],
    items: listed
      ? listed.map((line) =>
          pageItem(names, withUrl(line), null, { project: names.name(line.projectId) })
        )
      : done.map((page) =>
          pageItem(
            names,
            { ...labelOf(page, settingUp), projectId: page.projectId, pageId: page.pageId },
            page.message,
            { project: names.name(page.projectId) }
          )
        ),
    note: 'Select a page to open it.',
    scope: APP_SCOPE
  }
}

/** A page removed since it ran has no URL; show its id rather than an empty row. */
function withUrl(line: PageLine): PageLine {
  return line.url ? line : { ...line, url: line.pageId }
}
