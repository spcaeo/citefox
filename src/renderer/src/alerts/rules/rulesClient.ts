import type {
  AlertDryRunResult,
  AlertLog,
  AlertLogEntry,
  AlertRule,
  AlertRuleIdsResult,
  AlertRuleInput,
  AlertRuleList,
  AlertRuleStatus,
  CiteFoxApi,
  SaveAlertRuleRequest,
  TestSlackResult
} from '@shared/ipc'

/**
 * Alert rules, the dry run, the alert log and the Slack test. The live client calls
 * `alerts:*`; tests and the dev harness use the memory client below.
 */
export interface RulesClient {
  list(projectId: string): Promise<AlertRuleList>
  save(request: SaveAlertRuleRequest): Promise<AlertRule>
  remove(projectId: string, ids: readonly string[]): Promise<AlertRuleIdsResult>
  setStatus(
    projectId: string,
    ids: readonly string[],
    status: AlertRuleStatus
  ): Promise<AlertRuleIdsResult>
  dryRun(projectId: string, rule: AlertRuleInput): Promise<AlertDryRunResult>
  log(projectId: string): Promise<AlertLog>
  /** Without `webhook` the saved one is used. */
  testSlack(projectId: string, webhook?: string): Promise<TestSlackResult>
}

export function createLiveRulesClient(): RulesClient {
  const api = (): CiteFoxApi => {
    if (typeof window === 'undefined' || !window.citefox) {
      throw new Error('The preload bridge is missing.')
    }
    return window.citefox
  }
  return {
    list: (projectId) => Promise.resolve().then(() => api()['alerts:listRules']({ projectId })),
    save: (request) => Promise.resolve().then(() => api()['alerts:saveRule'](request)),
    remove: (projectId, ids) =>
      Promise.resolve().then(() => api()['alerts:deleteRule']({ projectId, ids })),
    setStatus: (projectId, ids, status) =>
      Promise.resolve().then(() => api()['alerts:setRuleStatus']({ projectId, ids, status })),
    dryRun: (projectId, rule) =>
      Promise.resolve().then(() => api()['alerts:dryRun']({ projectId, rule })),
    log: (projectId) => Promise.resolve().then(() => api()['alerts:listLog']({ projectId })),
    testSlack: (projectId, webhook) =>
      Promise.resolve().then(() =>
        api()['alerts:testSlack'](webhook ? { projectId, webhook } : { projectId })
      )
  }
}

/** In-memory rules for unit tests and the Vite dev harness. Nothing is sent. */
export function createMemoryRulesClient(
  seed: {
    rules?: readonly AlertRule[]
    log?: readonly AlertLogEntry[]
    dryRun?: AlertDryRunResult
    slackReady?: boolean
    now?: () => string
  } = {}
): RulesClient & { calls: string[] } {
  let rules = [...(seed.rules ?? [])]
  const log = [...(seed.log ?? [])]
  let next = rules.length
  const now = seed.now ?? ((): string => '2026-10-20T10:00:00.000Z')
  const calls: string[] = []
  return {
    calls,
    async list(projectId) {
      calls.push('list')
      return { projectId, rules: [...rules], slackReady: seed.slackReady ?? false }
    },
    async save(request) {
      calls.push(`save:${request.id ?? 'new'}`)
      const existing = rules.find((rule) => rule.id === request.id)
      const { projectId, id: _id, status, ...input } = request
      void _id
      next += 1
      const saved: AlertRule = {
        ...input,
        id: existing?.id ?? `rule-${next}`,
        projectId,
        status: status ?? existing?.status ?? 'active',
        createdAt: existing?.createdAt ?? now(),
        updatedAt: now(),
        lastFiredAt: existing?.lastFiredAt ?? null,
        firedCount: existing?.firedCount ?? 0
      }
      rules = existing
        ? rules.map((rule) => (rule.id === saved.id ? saved : rule))
        : [...rules, saved]
      return saved
    },
    async remove(_projectId, ids) {
      calls.push(`remove:${ids.join(',')}`)
      const done = rules.filter((rule) => ids.includes(rule.id)).map((rule) => rule.id)
      rules = rules.filter((rule) => !ids.includes(rule.id))
      return { ids: done }
    },
    async setStatus(_projectId, ids, status) {
      calls.push(`status:${status}:${ids.join(',')}`)
      rules = rules.map((rule) => (ids.includes(rule.id) ? { ...rule, status } : rule))
      return { ids: [...ids] }
    },
    async dryRun(_projectId, rule) {
      calls.push(`dryRun:${rule.when}`)
      return seed.dryRun ?? { days: 30, fired: 0, checksRead: 0, events: [] }
    },
    async log(projectId) {
      calls.push('log')
      return { projectId, entries: [...log] }
    },
    async testSlack(_projectId, webhook) {
      calls.push(`testSlack:${webhook ? 'typed' : 'saved'}`)
      const ok = webhook === undefined ? (seed.slackReady ?? false) : !webhook.endsWith('/fail')
      return {
        ok,
        testedAt: now(),
        message: ok
          ? 'Posted to Slack. Look for the message in the channel.'
          : 'The Slack webhook answered 404.'
      }
    }
  }
}
