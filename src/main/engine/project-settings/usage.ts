import type {
  ProjectClaudeRow,
  ProjectUsageReport,
  ProjectUsageRow,
  SearchSource
} from '@shared/domain'
import { readStoredCheckCatalog } from '../../headless/storage-pass'
import { effectiveMonthlyLimit } from '../../keys/present'
import { capAllowance } from '../../queue/usage'
import { claudeCallsByProject } from '../../storage/activity-events'
import type { AppStorage } from '../../storage/app-storage'
import { getKeyUsageForMonth } from '../../storage/key-usage'
import { listApiKeysByProvider, listProjects, type ApiKeyRecord } from '../../storage/records'
import { connectionLabel, planProjectClaude, readProjectClaude } from '../claude'
import { localZone, monthWindow } from './month'

/**
 * FR-10.6. Searches this month per project from `key_usage` (the numbers Results and
 * Connections show, NFR-14), each project's share of the shared keys, Claude calls, and
 * how much shared capacity no project cap has promised.
 */
export function projectUsageReport(
  storage: AppStorage,
  now: Date,
  timeZone: string = localZone()
): ProjectUsageReport {
  const window = monthWindow(now, timeZone)
  const queueProjects = readStoredCheckCatalog(storage).queueProjects
  const capOf = new Map(queueProjects.map((project) => [project.projectId, project]))
  const dedicated = new Set(
    queueProjects.map((project) => project.dedicatedKeyId).filter((id): id is string => id !== null)
  )
  const serp = listApiKeysByProvider(storage.db, 'serpapi')
  const shared = serp.filter((key) => !dedicated.has(key.id))
  const usage = getKeyUsageForMonth(storage.db, window.month)
  const calls = claudeCallsByProject(storage.db, window.start, window.end)
  const settings = storage.readSettings()
  const capacity = sharedCapacity(shared)
  let sharedUsed = 0
  let dedicatedUsed = 0
  const searchesBy = new Map<string, { all: number; shared: number }>()
  for (const key of usage.keys) {
    // Every key_usage row is SerpApi searches; a removed key still counts as shared.
    const onDedicated = dedicated.has(key.keyId)
    for (const row of key.projects) {
      if (onDedicated) dedicatedUsed += row.searches
      else sharedUsed += row.searches
      if (row.projectId === null) continue
      const current = searchesBy.get(row.projectId) ?? { all: 0, shared: 0 }
      current.all += row.searches
      if (!onDedicated) current.shared += row.searches
      searchesBy.set(row.projectId, current)
    }
  }
  const projects = listProjects(storage.db).map((project): ProjectUsageRow => {
    const cap = capOf.get(project.id)
    const source: SearchSource = cap?.dedicatedKeyId ? 'dedicated' : 'shared'
    const used = searchesBy.get(project.id) ?? { all: 0, shared: 0 }
    const plan = planProjectClaude(storage, settings, project.id)
    return {
      projectId: project.id,
      name: project.name,
      clientName: project.clientName,
      status: project.status,
      source,
      searches: used.all,
      sharedSearches: used.shared,
      cap: cap?.cap ?? null,
      capRule: cap?.capRule ?? 'pause',
      allowance:
        cap?.cap === null || cap?.cap === undefined ? null : capAllowance(cap.cap, cap.capRule),
      dedicatedKeyId: cap?.dedicatedKeyId ?? null,
      sharePercent: capacity === null || capacity === 0 ? null : percent(used.shared, capacity),
      claudeCalls: calls.get(project.id) ?? 0,
      claudeLabel:
        plan.connection === null
          ? 'Claude not set up'
          : plan.claude.connection === 'app_default'
            ? `${connectionLabel(plan.connection)} (app default)`
            : connectionLabel(plan.connection)
    }
  })
  const promised = projects
    .filter((row) => row.source === 'shared' && row.status !== 'archived')
    .map((row) => row.cap)
  const unassigned =
    capacity === null || promised.some((cap) => cap === null)
      ? null
      : capacity - promised.reduce<number>((sum, cap) => sum + (cap ?? 0), 0)
  let claudeCalls = 0
  for (const value of calls.values()) claudeCalls += value
  return {
    month: window.month,
    projects,
    sharedUsed,
    sharedCapacity: capacity,
    unassigned,
    dedicatedUsed,
    claudeCalls
  }
}

/** Sum of the shared keys' monthly limits. Null when a key that is on has no limit. */
function sharedCapacity(keys: readonly ApiKeyRecord[]): number | null {
  let total = 0
  for (const key of keys) {
    if (!key.on) continue
    const limit = effectiveMonthlyLimit(key.cap, key.serpapiUsage?.planLimit ?? null)
    if (limit === null) return null
    total += limit
  }
  return total
}

function percent(used: number, capacity: number): number {
  return Math.min(100, Math.round((used / capacity) * 100))
}

/** FR-11.7. Each project's Claude settings, for the table on Connections. */
export function projectClaudeRows(storage: AppStorage): ProjectClaudeRow[] {
  return listProjects(storage.db)
    .filter((project) => project.status !== 'archived')
    .map((project) => ({
      projectId: project.id,
      name: project.name,
      clientName: project.clientName,
      claude: readProjectClaude(storage, project.id).claude
    }))
}
