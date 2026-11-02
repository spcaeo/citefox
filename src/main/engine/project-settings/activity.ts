import type {
  ActivityKeyEvent,
  ActivityLogEntry,
  ConnectionActivity,
  ConnectionActivityEvent,
  ConnectionActivityLog,
  KeyProjectUsage
} from '@shared/domain'
import {
  countActivitySince,
  latestActivityNotice,
  listActivitySince,
  type ActivityRecord
} from '../../storage/activity-events'
import type { AppStorage } from '../../storage/app-storage'
import { redactString } from '../../logging/redact'
import { getKeyUsageForMonth } from '../../storage/key-usage'
import { localZone, monthWindow } from './month'

const DAY_MS = 86_400_000
/** Failovers this close to the latest SerpApi event are told as one burst. */
const BURST_MS = 15 * 60_000

interface SerpEventSql {
  key_id: string
  at: string
  kind: string
  name: string
}

/**
 * FR-11.10. Searches, Claude calls, and Jina reads in the last 24 hours, and the latest
 * failover or limit event told in plain words, such as
 * `At 14:02, SerpApi rate-limited "My plan". 18 searches moved to the next key.`
 */
export function connectionActivity(
  storage: AppStorage,
  now: Date,
  timeZone: string = localZone()
): ConnectionActivity {
  const since = new Date(now.getTime() - DAY_MS).toISOString()
  const counts = countActivitySince(storage.db, since)
  return { since, ...counts, latestEvent: latestTold(storage, now, timeZone).event }
}

/**
 * FR-11.10 drill-down: every row behind the Connections activity numbers. The counts
 * are summed from the same rows the list holds, so a drawer always matches its number.
 */
export function connectionActivityLog(
  storage: AppStorage,
  now: Date,
  timeZone: string = localZone()
): ConnectionActivityLog {
  const since = new Date(now.getTime() - DAY_MS).toISOString()
  const entries: ActivityLogEntry[] = listActivitySince(storage.db, since).map((row) => ({
    id: row.id,
    at: row.at,
    kind: row.kind,
    keyId: row.keyId,
    keyName: row.keyName,
    projectId: row.projectId,
    projectName: row.projectName,
    count: row.count,
    detail: row.detail
  }))
  const total = (kind: ActivityLogEntry['kind']): number =>
    entries.filter((entry) => entry.kind === kind).reduce((sum, entry) => sum + entry.count, 0)
  const told = latestTold(storage, now, timeZone)
  const window = monthWindow(now, timeZone)
  const names = new Map(
    storage.db
      .prepare<unknown[], { id: string; name: string }>(`SELECT id, name FROM projects`)
      .all()
      .map((row) => [row.id, row.name])
  )
  const keyMonth: KeyProjectUsage[] = getKeyUsageForMonth(storage.db, window.month).keys.flatMap(
    (key) =>
      key.projects
        .filter((project) => project.searches > 0)
        .map((project) => ({
          keyId: key.keyId,
          projectId: project.projectId,
          projectName: project.projectId === null ? null : (names.get(project.projectId) ?? null),
          searches: project.searches
        }))
  )
  return {
    since,
    searches: total('search'),
    claudeCalls: total('claude_call'),
    jinaReads: total('jina_read'),
    latestEvent: told.event,
    entries,
    latestEvents: told.events,
    month: window.month,
    resetsOn: window.resetsOn,
    keyMonth,
    keyEvents: recentKeyEvents(storage, now)
  }
}

/** Every key's stored events in the last 30 days, newest first (at most 500). */
function recentKeyEvents(storage: AppStorage, now: Date): ActivityKeyEvent[] {
  const since = new Date(now.getTime() - 30 * DAY_MS).toISOString()
  return storage.db
    .prepare<
      unknown[],
      {
        id: string
        at: string
        kind: string
        detail: string | null
        key_id: string
        name: string
        provider: string
      }
    >(
      `SELECT e.id, e.at, e.kind, e.detail, e.key_id, k.name, k.provider
       FROM connection_events e JOIN api_keys k ON k.id = e.key_id
       WHERE e.at >= ? ORDER BY e.at DESC, e.rowid DESC LIMIT 500`
    )
    .all(since)
    .map((row) => ({
      id: row.id,
      at: row.at,
      provider:
        row.provider === 'jina' ? 'jina' : row.provider === 'serpapi' ? 'serpapi' : 'claude',
      kind: row.kind,
      keyId: row.key_id,
      keyName: row.name,
      detail: row.detail === null ? null : redactString(row.detail, { hexKeys: true })
    }))
}

interface Told {
  event: ConnectionActivityEvent | null
  events: ActivityKeyEvent[]
}

/** The latest failover or limit, in words, and the stored events that sentence tells. */
function latestTold(storage: AppStorage, now: Date, timeZone: string): Told {
  const serp = latestSerpEvent(storage, now, timeZone)
  const notice = latestActivityNotice(storage.db)
  const fromNotice: ConnectionActivityEvent | null =
    notice === null || notice.detail === null
      ? null
      : {
          at: notice.at,
          provider: notice.kind === 'jina_failover' ? 'jina' : 'claude',
          sentence: `${when(notice.at, now, timeZone)}, ${lowerFirst(notice.detail)}`
        }
  if (serp !== null && (fromNotice === null || serp.event.at >= fromNotice.at)) {
    return { event: serp.event, events: serp.events }
  }
  if (fromNotice === null || notice === null) return { event: null, events: [] }
  return { event: fromNotice, events: [noticeEvent(storage, notice)] }
}

function noticeEvent(storage: AppStorage, notice: ActivityRecord): ActivityKeyEvent {
  const keyName =
    notice.keyId === null
      ? null
      : (storage.db
          .prepare<unknown[], { name: string }>(`SELECT name FROM api_keys WHERE id = ?`)
          .get(notice.keyId)?.name ?? null)
  return {
    id: notice.id,
    at: notice.at,
    provider: notice.kind === 'jina_failover' ? 'jina' : 'claude',
    kind: notice.kind,
    keyId: notice.keyId,
    keyName,
    detail: notice.detail
  }
}

function latestSerpEvent(
  storage: AppStorage,
  now: Date,
  timeZone: string
): { event: ConnectionActivityEvent; events: ActivityKeyEvent[] } | null {
  const latest = storage.db
    .prepare<unknown[], SerpEventSql>(
      `SELECT e.key_id, e.at, e.kind, k.name FROM connection_events e
       JOIN api_keys k ON k.id = e.key_id
       WHERE k.provider = 'serpapi' AND e.kind IN ('rate_limited', 'failover', 'cap_reached')
       ORDER BY e.at DESC, e.rowid DESC LIMIT 1`
    )
    .get()
  if (latest === undefined) return null
  const from = new Date(Date.parse(latest.at) - BURST_MS).toISOString()
  const to = new Date(Date.parse(latest.at) + BURST_MS).toISOString()
  const events: ActivityKeyEvent[] = storage.db
    .prepare<unknown[], { id: string; at: string; kind: string; detail: string | null }>(
      `SELECT id, at, kind, detail FROM connection_events
       WHERE key_id = ? AND kind IN ('rate_limited', 'failover', 'cap_reached') AND at >= ? AND at <= ?
       ORDER BY at DESC, rowid DESC`
    )
    .all(latest.key_id, from, to)
    .map((row) => ({
      id: row.id,
      at: row.at,
      provider: 'serpapi',
      kind: row.kind,
      keyId: latest.key_id,
      keyName: latest.name,
      detail: row.detail === null ? null : redactString(row.detail, { hexKeys: true })
    }))
  const moved =
    storage.db
      .prepare<unknown[], { total: number }>(
        `SELECT COUNT(*) AS total FROM connection_events
         WHERE key_id = ? AND kind = 'failover' AND at >= ? AND at <= ?`
      )
      .get(latest.key_id, from, to)?.total ?? 0
  // A failover is the effect; tell the burst by its cause (a rate limit or the cap) when
  // one was recorded on the same key in the same burst.
  const cause =
    latest.kind === 'failover'
      ? storage.db
          .prepare<unknown[], { kind: string; at: string }>(
            `SELECT kind, at FROM connection_events
             WHERE key_id = ? AND kind IN ('rate_limited', 'cap_reached') AND at >= ? AND at <= ?
             ORDER BY at DESC, rowid DESC LIMIT 1`
          )
          .get(latest.key_id, from, to)
      : undefined
  const kind = cause?.kind ?? latest.kind
  const at = when(cause?.at ?? latest.at, now, timeZone)
  const movedText =
    moved === 0 ? '' : ` ${moved} ${moved === 1 ? 'search' : 'searches'} moved to the next key.`
  let sentence: string
  if (kind === 'rate_limited') {
    sentence = `${at}, SerpApi rate-limited "${latest.name}".${movedText || ' The searches waited and tried again.'}`
  } else if (kind === 'cap_reached') {
    sentence = `${at}, "${latest.name}" reached its monthly cap, so CiteFox moved on to the next key.`
  } else {
    sentence = `${at}, SerpApi did not take a search on "${latest.name}".${movedText}`
  }
  return { event: { at: latest.at, provider: 'serpapi', sentence }, events }
}

/** "At 14:02" today, "On Oct 19 at 14:02" before that, in the computer's timezone. */
export function when(iso: string, now: Date, timeZone: string): string {
  const date = new Date(iso)
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone
  }).format(date)
  const day = (value: Date): string =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(value)
  if (day(date) === day(now)) return `At ${time}`
  const label = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone
  }).format(date)
  return `On ${label} at ${time}`
}

function lowerFirst(text: string): string {
  if (text.startsWith('Claude') || text.startsWith('Jina') || text.startsWith('Anthropic'))
    return text
  return text.charAt(0).toLowerCase() + text.slice(1)
}
