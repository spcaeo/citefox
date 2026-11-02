import type {
  ApiKeyMetadata,
  ConnectionState,
  DeliveryRecord,
  DueList,
  DuePage,
  ProjectUsageReport,
  QueueProjectUsage
} from '@shared/domain'
import type { CheckJob, ConnectionsOverview, ProjectList, StatusCapsule } from '@shared/ipc'
import type { DrillItem, DrillTarget, ItemDrill } from '../../drill/types'
import { APP_SCOPE, formatCount } from '../../keys/serpUsage'
import { alertsHash, pageHash, projectHash, runningHash, sectionHash } from '../../shell/routes'
import { formatClock, formatDay } from '../../utils/dates'
import { readinessText, type Readiness } from '@shared/permissions/readiness'
import { permissionsHash } from '../../permissions/model'
import { keyProblem, triggerLabel } from './model'

/** The open project's id and every project's name, from `projects:list`. */
export interface ProjectNames {
  activeId: string | null
  name: (projectId: string | null) => string
}

export function projectNames(list: ProjectList | null): ProjectNames {
  return {
    activeId: list?.activeProjectId ?? null,
    name: (projectId) => {
      if (projectId === null) return 'No project'
      return list?.projects.find((project) => project.id === projectId)?.name ?? projectId
    }
  }
}

/**
 * A page or screen in the open project opens directly. One in another project
 * opens through a project route, which switches to that project first, in one
 * step; the note names the project.
 */
export function inProject(
  names: ProjectNames,
  projectId: string,
  hash: string
): { target: DrillTarget; note: string | null } {
  if (names.activeId === projectId) return { target: { kind: 'hash', hash }, note: null }
  return {
    target: { kind: 'hash', hash: projectHash(projectId, hash) },
    note: `In ${names.name(projectId)}`
  }
}

const CONNECTIONS: readonly {
  id: keyof Pick<StatusCapsule, 'serpapi' | 'claudeCode' | 'jina' | 'youtube'>
  label: string
  provider: ApiKeyMetadata['provider'] | null
}[] = [
  { id: 'serpapi', label: 'SerpApi', provider: 'serpapi' },
  { id: 'claudeCode', label: 'Claude Code', provider: null },
  { id: 'jina', label: 'Jina Reader', provider: 'jina' },
  { id: 'youtube', label: 'YouTube Data API', provider: 'youtube' }
]

function problemFor(
  connection: (typeof CONNECTIONS)[number],
  overview: ConnectionsOverview | null,
  keys: readonly ApiKeyMetadata[]
): string {
  if (connection.provider === null) {
    const checkup = overview?.claudeCheckup ?? null
    return checkup?.nextStep ?? checkup?.message ?? 'Run the Claude Code checkup in Connections.'
  }
  const problems = keys
    .filter((key) => key.provider === connection.provider && key.state === 'warning')
    .map((key) => {
      const problem = keyProblem(key)
      return problem ? `${key.name}: ${problem}` : `${key.name} has a warning`
    })
  return problems.length > 0 ? problems.join(' · ') : 'Test the keys in Connections.'
}

/**
 * Open issues (FR-24.1), from the one readiness model: each required item in
 * "What CiteFox needs" that is not ready (it opens that item), then each
 * connection with a warning (it opens Connections). The capsule, its popover and
 * this tile count the same list.
 */
export function issuesDrill(
  ready: Readiness,
  overview: ConnectionsOverview | null,
  keys: readonly ApiKeyMetadata[]
): ItemDrill {
  const items: DrillItem[] = ready.items.map((entry) => {
    const connection = CONNECTIONS.find((item) => item.id === entry.connection)
    if (entry.kind === 'step' || !connection) {
      return {
        id: `step:${entry.id}`,
        primary: entry.title,
        secondary: 'Required. Checks or AI steps cannot run until it is ready.',
        target: { kind: 'hash', hash: permissionsHash(entry.permissionId) },
        cells: { fix: 'What CiteFox needs' }
      }
    }
    return {
      id: connection.id,
      primary: connection.label,
      secondary: problemFor(connection, overview, keys),
      target: { kind: 'hash', hash: sectionHash('connections') },
      cells: { fix: 'Connections' }
    }
  })
  return {
    kind: 'items',
    id: 'status:issues',
    title: 'Open issues',
    description: `${readinessText(ready)}. Fix each one where it opens.`,
    noun: ['issue', 'issues'],
    primaryLabel: 'Item',
    columns: [{ id: 'fix', label: 'Fix in', width: '150px' }],
    items,
    note: 'Select an item to fix it.',
    scope: APP_SCOPE
  }
}

/** Running check jobs in every project. Each row opens its Checking screen. */
export function jobsDrill(jobs: readonly CheckJob[], names: ProjectNames): ItemDrill {
  const running = jobs.filter((job) => job.status === 'running')
  return {
    kind: 'items',
    id: 'queue:running',
    title: 'Checks running',
    description: 'Checks running now in every project, with their progress.',
    noun: ['check', 'checks'],
    primaryLabel: 'Check',
    columns: [
      { id: 'progress', label: 'Done', align: 'end', width: '96px' },
      { id: 'searches', label: 'Searches', align: 'end', width: '96px' }
    ],
    items: running.map((job) => {
      const pageId = job.pageIds[0] ?? null
      const link = pageId ? inProject(names, job.projectId, runningHash(pageId)) : null
      const pages = job.pageIds.length === 1 ? '1 page' : `${job.pageIds.length} pages`
      return {
        id: job.id,
        primary: `${names.name(job.projectId)} · ${pages}`,
        secondary: [`Started ${formatClock(job.startedAt)}`, link?.note ?? null]
          .filter((part): part is string => Boolean(part))
          .join(' · '),
        target: link?.target ?? null,
        cells: {
          progress: `${formatCount(job.done)} / ${formatCount(job.total)}`,
          searches: formatCount(job.searchesUsed)
        }
      }
    }),
    note: 'Select a check to open its progress.',
    scope: APP_SCOPE
  }
}

function dueReason(page: DuePage): string {
  switch (page.reason) {
    case 'follow_up':
      return 'Fix follow-up'
    case 'catch_up':
      return 'Catch-up'
    default:
      return 'Scheduled'
  }
}

/** Pages due in every project (`schedule:listDue`). Each row opens the page. */
export function dueDrill(due: DueList, names: ProjectNames): ItemDrill {
  return {
    kind: 'items',
    id: 'queue:due',
    title: 'Pages due',
    description: `Pages whose next check is due, in every project (${formatDay(`${due.day}T12:00:00.000Z`, { year: false })}).`,
    noun: ['page', 'pages'],
    primaryLabel: 'Page',
    columns: [
      { id: 'project', label: 'Project', width: '140px' },
      { id: 'reason', label: 'Why', width: '110px' },
      { id: 'due', label: 'Due', width: '96px' }
    ],
    items: due.pages.map((page, index) => {
      const link = inProject(names, page.projectId, pageHash(page.pageId, 'results'))
      return {
        id: `${page.projectId}:${page.pageId}:${page.fixId ?? index}`,
        primary: page.label ?? page.title ?? page.url ?? page.pageId,
        secondary: page.url,
        target: link.target,
        cells: {
          project: names.name(page.projectId),
          reason: dueReason(page),
          due: formatClock(page.dueAt)
        }
      }
    }),
    note: 'Select a page to open it. Check them all from Check now.',
    scope: APP_SCOPE
  }
}

function deliveryItem(record: DeliveryRecord, names: ProjectNames): DrillItem {
  const detail = [
    record.recipients.length > 0 ? `**To:** ${record.recipients.join(', ')}` : null,
    record.reason ? `**What happened:** ${record.reason}` : null,
    record.nextStep ? `**Next step:** ${record.nextStep}` : null
  ].filter((part): part is string => part !== null)
  return {
    id: record.id,
    primary: triggerLabel(record),
    secondary: `${formatDay(record.at, { year: false })} ${formatClock(record.at)} · ${names.name(record.projectId)}`,
    target: {
      kind: 'hash',
      hash: record.ok ? sectionHash('reports') : alertsHash('email')
    },
    cells: {
      outcome:
        record.outcome === 'sent' ? 'Sent' : record.outcome === 'failed' ? 'Failed' : 'Draft',
      recipients: formatCount(record.recipients.length)
    },
    detail: detail.length > 0 ? detail.join('\n\n') : null,
    group: record.outcome === 'failed' ? 'failed' : 'sent'
  }
}

const DELIVERY_COLUMNS = [
  { id: 'outcome', label: 'Result', width: '84px' },
  { id: 'recipients', label: 'To', align: 'end' as const, width: '56px' }
]

/** Report emails sent (FR-24.2), newest first. Each row opens Scheduled reports. */
export function sentDrill(records: readonly DeliveryRecord[], names: ProjectNames): ItemDrill {
  return {
    kind: 'items',
    id: 'email:sent',
    title: 'Reports sent',
    description: 'Report emails CiteFox sent, newest first. Expand a row to see who got it.',
    noun: ['report', 'reports'],
    primaryLabel: 'Report',
    columns: DELIVERY_COLUMNS,
    items: records.map((record) => deliveryItem(record, names)),
    note: 'Select a report to open Scheduled reports, where you can send it again.',
    scope: APP_SCOPE
  }
}

/** Failed report sends since the last good one. Each row opens Email setup. */
export function failedDrill(records: readonly DeliveryRecord[], names: ProjectNames): ItemDrill {
  return {
    kind: 'items',
    id: 'email:failed',
    title: 'Failed sends',
    description:
      'Report emails that failed after the last one that went out. Expand a row for the reason and the next step.',
    noun: ['failed send', 'failed sends'],
    primaryLabel: 'Report',
    columns: DELIVERY_COLUMNS,
    items: records.map((record) => deliveryItem(record, names)),
    note: 'Select a send to fix it in Email setup. Resend it from Scheduled reports › Delivery history.',
    scope: APP_SCOPE
  }
}

/**
 * One project's searches this month (FR-11.4), split into shared keys, its
 * own key and Claude calls. The searches add up to the project's count.
 */
export function projectUsageDrill(
  project: QueueProjectUsage,
  usage: ProjectUsageReport | null,
  names: ProjectNames
): ItemDrill {
  const row = usage?.projects.find((item) => item.projectId === project.projectId) ?? null
  const link = inProject(names, project.projectId, sectionHash('project-settings'))
  const items: DrillItem[] = row
    ? [
        {
          id: 'shared',
          primary: 'Shared keys',
          target: link.target,
          cells: { searches: formatCount(row.sharedSearches) }
        },
        {
          id: 'own',
          primary: 'Own key',
          secondary: row.dedicatedKeyId ? null : 'This project has no key of its own',
          target: link.target,
          cells: { searches: formatCount(row.searches - row.sharedSearches) }
        }
      ]
    : [
        {
          id: 'all',
          primary: 'All keys',
          secondary: 'The split by key could not be read',
          target: link.target,
          cells: { searches: formatCount(project.used) }
        }
      ]
  const searches = row ? row.searches : project.used
  return {
    kind: 'items',
    id: `project:${project.projectId}:usage`,
    title: `${project.name} · ${formatCount(searches)} searches this month`,
    omitCount: true,
    description: [
      project.cap === null
        ? 'No monthly cap.'
        : `Cap ${formatCount(project.cap)} searches a month.`,
      row ? `${formatCount(row.claudeCalls)} Claude calls this month (${row.claudeLabel}).` : null,
      link.note ? `${link.note}.` : null
    ]
      .filter((part): part is string => part !== null)
      .join(' '),
    noun: ['part', 'parts'],
    primaryLabel: 'Searches on',
    columns: [{ id: 'searches', label: 'Searches', align: 'end', width: '96px' }],
    items,
    note: 'The Searches column adds up to the total in the title. Select a row to change the cap in Project settings.',
    scope: APP_SCOPE
  }
}

/** The connection state chip's word, for row cells. */
export function stateWord(state: ConnectionState): string {
  if (state === 'ok') return 'OK'
  if (state === 'warning') return 'Warning'
  if (state === 'off') return 'Off'
  return 'Not tested'
}
