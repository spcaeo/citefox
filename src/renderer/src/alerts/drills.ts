import type { DueList, EmailAccountUse } from '@shared/domain'
import { projectSettingsLink } from '../connections/utils/projectLinks'
import type { DrillItem, DrillScope, ItemDrill } from '../drill'
import { sectionHash } from '../shell/routes'
import { formatMoment } from '../utils/dates'
import type { EmailAccountRow } from './model'

function scope(checkDateLabel: string): DrillScope {
  return {
    pageId: null,
    marketId: null,
    runId: null,
    marketLabel: '',
    checkDateLabel,
    brand: '',
    domain: ''
  }
}

/**
 * The projects and live report schedules that send through one account
 * (FR-23.5). A schedule opens Scheduled reports; a project opens its settings.
 */
export function accountUsesDrill(
  account: EmailAccountRow,
  uses: readonly EmailAccountUse[],
  activeProjectId: string | null
): ItemDrill {
  const items: DrillItem[] = uses.map((use, index) => {
    if (use.scheduleId) {
      return {
        id: `schedule:${use.scheduleId}`,
        primary: use.label,
        secondary: use.projectId === null ? 'Scheduled report · all projects' : 'Scheduled report',
        target: { kind: 'hash', hash: sectionHash('reports') },
        cells: { kind: 'Report schedule' },
        group: 'schedule'
      }
    }
    const link =
      use.projectId !== null
        ? projectSettingsLink({ id: use.projectId, name: use.label }, activeProjectId, 'Email')
        : null
    return {
      id: `project:${use.projectId ?? index}`,
      primary: use.label,
      secondary: link?.label ?? null,
      target: link?.target ?? null,
      cells: { kind: 'Project alerts' },
      group: 'project'
    }
  })
  const kinds = new Set(items.map((item) => item.group))
  return {
    kind: 'items',
    id: `email-uses:${account.id}`,
    title: `What ${account.fromAddress} sends`,
    description: account.isDefault
      ? 'The default account: it also sends everything no project or schedule gives to another account.'
      : 'Projects and live report schedules that picked this account.',
    noun: ['use', 'uses'],
    primaryLabel: 'Project or schedule',
    columns: [{ id: 'kind', label: 'Kind', width: 'minmax(110px, 0.8fr)' }],
    items,
    ...(kinds.size > 1
      ? {
          summary: [
            { label: 'Projects', group: 'project' },
            { label: 'Report schedules', group: 'schedule' }
          ]
        }
      : {}),
    note: 'Select a row to open that project or schedule.',
    scope: scope('')
  }
}

const REASON_WORDS: Readonly<Record<string, string>> = {
  scheduled: 'Scheduled re-check',
  follow_up: 'Follow-up after a fix',
  catch_up: 'Catching up'
}

/** The pages due at a project's next run (`schedule:listDue`). Each opens its Results. */
export function duePagesDrill(due: DueList, projectName: string): ItemDrill {
  return {
    kind: 'items',
    id: 'due:next',
    title: `Pages due in ${projectName}`,
    description: 'Pages whose next check is due at the next run, in the order they are queued.',
    noun: ['page', 'pages'],
    primaryLabel: 'Page',
    columns: [
      { id: 'when', label: 'Due', width: 'minmax(96px, 0.7fr)' },
      { id: 'why', label: 'Why', width: 'minmax(120px, 0.9fr)' }
    ],
    items: due.pages.map((page) => ({
      id: page.pageId,
      primary: page.label ?? page.title ?? page.url ?? page.pageId,
      secondary: page.label || page.title ? page.url : null,
      target: { kind: 'page', pageId: page.pageId, tab: 'results' },
      cells: {
        when: formatMoment(page.dueAt),
        why: REASON_WORDS[page.reason] ?? page.reason
      },
      group: page.reason
    })),
    note: 'Select a page to open its results.',
    scope: scope('')
  }
}
