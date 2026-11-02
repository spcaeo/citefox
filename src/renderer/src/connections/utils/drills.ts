import type {
  ActivityKeyEvent,
  ActivityLogEntry,
  ApiKeyMetadata,
  ConnectionActivityLog
} from '@shared/domain'
import type { ClaudeCheckupResult } from '@shared/ipc'
import type { DrillItem, DrillScope, ItemDrill } from '../../drill'
import { formatClock, formatDay } from '../../utils/dates'
import { projectSettingsLink } from './projectLinks'
import { limitOf, usedOf, type ProjectRef } from './model'

/** Connections drawers belong to no page, market or check. */
export function connectionsScope(checkDateLabel: string): DrillScope {
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

const LAST_DAY = 'Last 24 hours'

export type ActivityCountKind = 'search' | 'claude_call' | 'jina_read'

const COUNT_COPY: Readonly<
  Record<ActivityCountKind, { id: string; title: string; noun: readonly [string, string] }>
> = {
  search: { id: 'activity:searches', title: 'SerpApi searches', noun: ['search', 'searches'] },
  claude_call: { id: 'activity:claude', title: 'Claude calls', noun: ['call', 'calls'] },
  jina_read: { id: 'activity:jina', title: 'Jina reads', noun: ['read', 'reads'] }
}

/** "Oct 19 · 14:02" in the computer's timezone. */
export function whenLabel(iso: string): string {
  return `${formatDay(iso, { year: false })} · ${formatClock(iso)}`
}

function projectName(entry: { projectId: string | null; projectName: string | null }): string {
  if (entry.projectId === null) return 'No project'
  return entry.projectName ?? 'Removed project'
}

/**
 * The calls behind one last-24-hours count (FR-11.10). One row per search,
 * call or read: a SerpApi call that made two searches is two rows, so the
 * drawer total always equals the number on the strip (NFR-14).
 */
export function activityDrill(
  log: ConnectionActivityLog,
  kind: ActivityCountKind,
  activeProjectId: string | null
): ItemDrill {
  const copy = COUNT_COPY[kind]
  const items: DrillItem[] = []
  const groups = new Map<string, string>()
  for (const entry of log.entries) {
    if (entry.kind !== kind) continue
    const group = kind === 'search' ? (entry.keyId ?? 'none') : (entry.projectId ?? 'none')
    groups.set(
      group,
      kind === 'search'
        ? (entry.keyName ?? (entry.keyId ? 'Removed key' : 'No key'))
        : projectName(entry)
    )
    for (let index = 1; index <= entry.count; index += 1) {
      items.push(activityItem(entry, index, group, activeProjectId))
    }
  }
  const summary =
    groups.size > 1 ? [...groups].map(([group, label]) => ({ group, label })) : undefined
  return {
    kind: 'items',
    id: copy.id,
    title: copy.title,
    description:
      kind === 'search'
        ? 'Every SerpApi search CiteFox made in the last 24 hours, newest first, with the key that answered. An AI Overview follow-up is a second search on the same key.'
        : kind === 'claude_call'
          ? 'Every Claude call in the last 24 hours, newest first, with the project it was for.'
          : 'Every page read through Jina Reader in the last 24 hours, newest first.',
    noun: copy.noun,
    primaryLabel: 'When',
    columns: [
      ...(kind === 'search' ? [{ id: 'key', label: 'Key', width: 'minmax(96px, 1fr)' }] : []),
      { id: 'project', label: 'Project', width: 'minmax(96px, 1fr)' }
    ],
    items,
    ...(summary ? { summary } : {}),
    note: 'Select a row to open its project.',
    scope: connectionsScope(LAST_DAY)
  }
}

function activityItem(
  entry: ActivityLogEntry,
  index: number,
  group: string,
  activeProjectId: string | null
): DrillItem {
  const project =
    entry.projectId !== null && entry.projectName !== null
      ? projectSettingsLink({ id: entry.projectId, name: entry.projectName }, activeProjectId)
      : null
  return {
    id: entry.count > 1 ? `${entry.id}:${index}` : entry.id,
    primary: whenLabel(entry.at),
    secondary:
      entry.count > 1 ? `Search ${index} of ${entry.count} in this call` : (entry.detail ?? null),
    target: project?.target ?? null,
    cells: {
      key: entry.keyName ?? (entry.keyId ? 'Removed key' : '—'),
      project: projectName(entry)
    },
    group
  }
}

const EVENT_WORDS: Readonly<Record<string, string>> = {
  rate_limited: 'Rate-limited',
  failover: 'Moved to next key',
  cap_reached: 'Reached its cap',
  failed: 'Failed',
  claude_limit: 'Claude limit',
  claude_fallback: 'Claude fallback',
  jina_failover: 'Jina failover'
}

export function eventWords(kind: string): string {
  return EVENT_WORDS[kind] ?? kind
}

function eventItem(event: ActivityKeyEvent): DrillItem {
  return {
    id: event.id,
    primary: whenLabel(event.at),
    secondary: event.detail,
    cells: { what: eventWords(event.kind), key: event.keyName ?? '—' },
    group: event.kind
  }
}

const EVENT_COLUMNS = [
  { id: 'what', label: 'What happened', width: 'minmax(120px, 1fr)' },
  { id: 'key', label: 'Key', width: 'minmax(96px, 1fr)' }
] as const

/** The stored events the latest failover sentence tells (FR-11.10). */
export function latestEventDrill(log: ConnectionActivityLog): ItemDrill {
  return {
    kind: 'items',
    id: 'activity:latest',
    title: 'Latest failover',
    description: log.latestEvent?.sentence ?? 'No failovers in the last 24 hours.',
    noun: ['event', 'events'],
    primaryLabel: 'When',
    columns: EVENT_COLUMNS,
    items: log.latestEvents.map(eventItem),
    note: 'Events within 15 minutes on the same key are told as one burst.',
    scope: connectionsScope('')
  }
}

/** One key's stored events in the last 30 days (limits, failures, caps, failovers). */
export function keyEventsDrill(key: ApiKeyMetadata, log: ConnectionActivityLog): ItemDrill {
  return {
    kind: 'items',
    id: `key-events:${key.id}`,
    title: `Events on ${key.name}`,
    description: 'Rate limits, failures, caps and failovers recorded on this key, newest first.',
    noun: ['event', 'events'],
    primaryLabel: 'When',
    columns: EVENT_COLUMNS,
    items: log.keyEvents.filter((event) => event.keyId === key.id).map(eventItem),
    note: 'CiteFox keeps 30 days of key events.',
    scope: connectionsScope('Last 30 days')
  }
}

/**
 * This month's searches on one key, per project. The Searches column adds up
 * to CiteFox's own count for the key; SerpApi's account count can be higher.
 */
export function keyUsageDrill(
  key: ApiKeyMetadata,
  log: ConnectionActivityLog | null,
  activeProjectId: string | null
): ItemDrill {
  const rows = (log?.keyMonth ?? []).filter((row) => row.keyId === key.id)
  const counted = rows.reduce((sum, row) => sum + row.searches, 0)
  const used = usedOf(key)
  const limit = limitOf(key)
  const reset = log?.resetsOn ? formatDay(`${log.resetsOn}T12:00:00.000Z`) : null
  const items: DrillItem[] = rows.map((row) => {
    const link =
      row.projectId !== null && row.projectName !== null
        ? projectSettingsLink({ id: row.projectId, name: row.projectName }, activeProjectId)
        : null
    return {
      id: `${key.id}:${row.projectId ?? 'none'}`,
      primary: projectName(row),
      secondary: row.projectId === null ? 'Playground and checks outside a project' : null,
      target: link?.target ?? null,
      cells: { searches: row.searches.toLocaleString('en-US') }
    }
  })
  const parts = [
    `${used.toLocaleString('en-US')} ${used === 1 ? 'search' : 'searches'} this month on ${key.name}`,
    limit === null ? 'no monthly limit' : `limit ${limit.toLocaleString('en-US')}`,
    reset ? `counts restart ${reset}` : null
  ].filter((part): part is string => part !== null)
  const serp = key.serpapiUsage?.used ?? null
  return {
    kind: 'items',
    id: `key-usage:${key.id}`,
    title: `${key.name}: ${used.toLocaleString('en-US')} searches this month`,
    omitCount: true,
    description: `${parts.join(' · ')}.`,
    noun: ['project', 'projects'],
    primaryLabel: 'Project',
    columns: [{ id: 'searches', label: 'Searches', align: 'end', width: '96px' }],
    items,
    note:
      serp !== null && serp > counted
        ? `The Searches column adds up to ${counted.toLocaleString('en-US')}, CiteFox's own count. SerpApi reports ${serp.toLocaleString('en-US')} on this account, which includes searches made outside CiteFox.`
        : `The Searches column adds up to ${counted.toLocaleString('en-US')}, CiteFox's count for this key.`,
    scope: connectionsScope('This month')
  }
}

/** The projects a key serves. An empty list means every project (FR-11.1). */
export function keyProjectsDrill(
  key: ApiKeyMetadata,
  projects: readonly ProjectRef[],
  activeProjectId: string | null
): ItemDrill {
  const all = key.projectIds.length === 0
  const listed = all
    ? projects
    : key.projectIds.map(
        (id) => projects.find((project) => project.id === id) ?? { id, name: 'Removed project' }
      )
  return {
    kind: 'items',
    id: `key-projects:${key.id}`,
    title: `Projects that use ${key.name}`,
    description: all
      ? 'This key is shared: every project can use it.'
      : 'This key is kept for these projects only.',
    noun: ['project', 'projects'],
    primaryLabel: 'Project',
    items: listed.map((project) => {
      const known = projects.some((item) => item.id === project.id)
      const link = known ? projectSettingsLink(project, activeProjectId, 'Search') : null
      return {
        id: project.id,
        primary: project.name,
        secondary: link?.label ?? null,
        target: link?.target ?? null
      }
    }),
    note: 'Select a project to open its settings.',
    scope: connectionsScope('')
  }
}

/** The three checkup rows of Claude Code or Codex (LLM-8). */
export function checkupDrill(checkup: ClaudeCheckupResult): ItemDrill {
  const program = checkup.provider === 'codex' ? 'Codex' : 'Claude Code'
  const rows = [
    { id: 'binary', title: `${program} installed`, row: checkup.rows.binary },
    { id: 'login', title: 'Logged in', row: checkup.rows.login },
    { id: 'roundTrip', title: 'Test reply', row: checkup.rows.roundTrip }
  ]
  const facts = [
    checkup.binaryPath,
    checkup.version ? `version ${checkup.version}` : null,
    checkup.plan,
    checkup.durationMs !== null ? `test reply in ${checkup.durationMs} ms` : null,
    checkup.resolvedModel
  ].filter((part): part is string => Boolean(part))
  return {
    kind: 'items',
    id: 'claude:checkup',
    title: `${program} checkup`,
    description: [checkup.message, checkup.nextStep, facts.join(' · ')]
      .filter((part): part is string => Boolean(part))
      .join('\n\n'),
    noun: ['step', 'steps'],
    primaryLabel: 'Step',
    columns: [{ id: 'status', label: 'Status', width: 'minmax(96px, 0.8fr)' }],
    items: rows.map((item) => ({
      id: item.id,
      primary: item.title,
      secondary: item.row.detail,
      cells: { status: item.row.statusLabel },
      detail: item.row.nextStep,
      group: item.row.state
    })),
    note: 'Run checkup again after you change anything.',
    scope: connectionsScope('')
  }
}
