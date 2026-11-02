import {
  ALERT_DELIVERIES,
  ALERT_RULE_STATUSES,
  ALERT_RULE_WHENS,
  ALERT_SCOPE_KINDS,
  DEFAULT_SCORE_DROP,
  type AlertDryRunRequest,
  type AlertRuleIdsRequest,
  type AlertRuleInput,
  type SaveAlertRuleRequest,
  type SetAlertRuleStatusRequest
} from '@shared/ipc'
import { IpcRequestError } from '../ipc-request'
import { containsSecret } from '../logging/redact'

/**
 * Request checks for the alert rule channels. Everything the renderer sends is read
 * here before it reaches storage: unknown keys, wrong types, bad ids, emails and
 * domains are refused with a plain reason.
 */

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/
const DOMAIN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const MAX_IDS = 5000
const MAX_EMAILS = 20

const RULE_KEYS = [
  'name',
  'when',
  'scoreDrop',
  'competitorDomain',
  'scope',
  'marketIds',
  'desktop',
  'emailTo',
  'slack',
  'delivery'
] as const

export function parseRuleProjectId(value: unknown, channel: string): string {
  const record = plain(value, channel, ['projectId'])
  return readId(record.projectId, channel, 'project')
}

export function parseSaveRule(value: unknown): SaveAlertRuleRequest {
  const channel = 'alerts:saveRule'
  const record = plain(value, channel, ['projectId', 'id', ...RULE_KEYS], ['status'])
  const id = record.id === null ? null : readId(record.id, channel, 'rule')
  const rule = readRule(record, channel)
  const status =
    record.status === undefined
      ? undefined
      : readOneOf(record.status, ALERT_RULE_STATUSES, channel, 'status')
  return {
    projectId: readId(record.projectId, channel, 'project'),
    id,
    ...rule,
    ...(status !== undefined ? { status } : {})
  }
}

export function parseRuleIds(value: unknown, channel: string): AlertRuleIdsRequest {
  const record = plain(value, channel, ['projectId', 'ids'])
  return {
    projectId: readId(record.projectId, channel, 'project'),
    ids: readIds(record.ids, channel, 1)
  }
}

export function parseSetStatus(value: unknown): SetAlertRuleStatusRequest {
  const channel = 'alerts:setRuleStatus'
  const record = plain(value, channel, ['projectId', 'ids', 'status'])
  return {
    projectId: readId(record.projectId, channel, 'project'),
    ids: readIds(record.ids, channel, 1),
    status: readOneOf(record.status, ALERT_RULE_STATUSES, channel, 'status')
  }
}

export function parseDryRun(value: unknown): Required<AlertDryRunRequest> {
  const channel = 'alerts:dryRun'
  const record = plain(value, channel, ['projectId', 'rule'], ['days'])
  const rule = plain(record.rule, channel, [...RULE_KEYS])
  let days = 30
  if (record.days !== undefined) {
    if (typeof record.days !== 'number' || !Number.isInteger(record.days)) fail(channel, 'days')
    if (record.days < 1 || record.days > 365) fail(channel, 'days')
    days = record.days
  }
  return {
    projectId: readId(record.projectId, channel, 'project'),
    rule: readRule(rule, channel),
    days
  }
}

export function parseLogRequest(value: unknown): {
  projectId: string
  ruleId: string | null
  limit: number
} {
  const channel = 'alerts:listLog'
  const record = plain(value, channel, ['projectId'], ['ruleId', 'limit'])
  let limit = 200
  if (record.limit !== undefined) {
    if (typeof record.limit !== 'number' || !Number.isInteger(record.limit)) fail(channel, 'limit')
    limit = Math.min(500, Math.max(1, record.limit))
  }
  const ruleId = record.ruleId ?? null
  return {
    projectId: readId(record.projectId, channel, 'project'),
    ruleId: ruleId === null ? null : readId(ruleId, channel, 'rule'),
    limit
  }
}

function readRule(record: Record<string, unknown>, channel: string): AlertRuleInput {
  const when = readOneOf(record.when, ALERT_RULE_WHENS, channel, 'alert kind')
  const name = record.name
  if (typeof name !== 'string') fail(channel, 'name')
  const trimmed = name.trim().replace(/\s+/g, ' ')
  if (trimmed.length === 0) fail(channel, 'name', 'Give the rule a name.')
  if (trimmed.length > 120) fail(channel, 'name', 'Keep the name under 120 characters.')
  if (containsSecret(trimmed)) fail(channel, 'name')

  let scoreDrop: number | null = null
  if (when === 'score_drop') {
    const raw = record.scoreDrop ?? DEFAULT_SCORE_DROP
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > 100) {
      fail(channel, 'score drop', 'The score drop is a whole number from 1 to 100.')
    }
    scoreDrop = raw
  }

  // Only the kind that uses a value keeps it; switching kind in the drawer drops it.
  let competitorDomain: string | null = null
  const domain = record.competitorDomain
  if (when === 'competitor_cited' && domain !== null && domain !== '') {
    competitorDomain = readDomain(domain, channel)
  }

  const scopeRecord = plain(record.scope, channel, ['kind', 'ids'])
  const kind = readOneOf(scopeRecord.kind, ALERT_SCOPE_KINDS, channel, 'scope')
  const ids = readIds(scopeRecord.ids, channel, 0)
  if (kind === 'tracked' && ids.length > 0) fail(channel, 'scope')
  if (kind !== 'tracked' && ids.length === 0) {
    fail(channel, 'scope', 'Pick at least one page, group, cluster or topic.')
  }

  const desktop = readBoolean(record.desktop, channel, 'desktop')
  const slack = readBoolean(record.slack, channel, 'slack')
  const emailTo = readEmails(record.emailTo, channel)
  if (!desktop && !slack && emailTo.length === 0) {
    fail(channel, 'send to', 'Choose where the alert goes: desktop, email or Slack.')
  }
  return {
    name: trimmed,
    when,
    scoreDrop,
    competitorDomain,
    scope: { kind, ids },
    marketIds: readIds(record.marketIds, channel, 0),
    desktop,
    emailTo,
    slack,
    delivery: readOneOf(record.delivery, ALERT_DELIVERIES, channel, 'delivery')
  }
}

function readDomain(value: unknown, channel: string): string {
  if (typeof value !== 'string') fail(channel, 'competitor')
  let domain = value.trim().toLowerCase()
  domain = domain
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '')
  if (!DOMAIN.test(domain)) {
    fail(channel, 'competitor', 'Type the competitor as a domain, such as competitor.example.com.')
  }
  return domain
}

function readEmails(value: unknown, channel: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_EMAILS) fail(channel, 'email')
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') fail(channel, 'email')
    const email = item.trim()
    if (!EMAIL.test(email) || email.length > 320) {
      fail(channel, 'email', `“${email.slice(0, 80)}” is not an email address.`)
    }
    const key = email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(email)
  }
  return out
}

function readIds(value: unknown, channel: string, min: number): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > MAX_IDS) fail(channel, 'ids')
  const out: string[] = []
  for (const item of value) {
    const id = readId(item, channel, 'id')
    if (!out.includes(id)) out.push(id)
  }
  return out
}

function readId(value: unknown, channel: string, what: string): string {
  if (typeof value !== 'string' || !ID.test(value)) fail(channel, what)
  return value
}

function readBoolean(value: unknown, channel: string, what: string): boolean {
  if (typeof value !== 'boolean') fail(channel, what)
  return value
}

function readOneOf<T extends string>(
  value: unknown,
  options: readonly T[],
  channel: string,
  what: string
): T {
  const found = options.find((option) => option === value)
  if (found === undefined) fail(channel, what)
  return found
}

function plain(
  value: unknown,
  channel: string,
  required: readonly string[],
  optional: readonly string[] = []
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(channel, 'request')
  const record = value as Record<string, unknown>
  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) fail(channel, 'request')
  }
  for (const key of required) {
    if (!(key in record)) fail(channel, 'request')
  }
  return record
}

function fail(channel: string, what: string, reason?: string): never {
  throw new IpcRequestError(channel, reason ?? `Invalid ${what}`)
}
