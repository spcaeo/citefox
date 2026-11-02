import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EngineId } from '@shared/domain'
import type { HttpRequest, HttpResponse } from '../../providers/http'
import type { SecretStore } from '../../secrets/secret-store'
import type { AppStorage } from '../../storage/app-storage'
import type { SqliteDatabase } from '../../storage/database'
import { insertApiKey } from '../../storage/records'

/**
 * cloro fixtures and raw row reads for the multi-engine check tests. Every response is
 * built from the recorded fixtures; nothing here reaches the network.
 */
export const CLORO_FIXTURES = join(process.cwd(), 'src/main/providers/fixtures/cloro')
export const CLORO_SECRET = 'cloro-test-key-0000'
export const CLORO_HOST = 'https://api.cloro.dev'
/** The seeded page, so an answer citing it is `cited`. */
export const OWN_URL = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'

/** Saves a cloro key (on, every project, Lite plan) and its secret in the fake keychain. */
export function addCloroKey(
  storage: AppStorage,
  secrets: SecretStore,
  id = 'cloro-1',
  rotationOrder = 1
): string {
  const secret = id === 'cloro-1' ? CLORO_SECRET : `${CLORO_SECRET}-${id}`
  insertApiKey(storage.db, {
    id,
    provider: 'cloro',
    name: `cloro ${id}`,
    keychainRef: `citefox.cloro.${id}`,
    hint: secret.slice(-4),
    rotationOrder,
    cap: null,
    on: true,
    projectIds: [],
    state: 'ok',
    lastReason: null,
    serpapiUsage: null,
    plan: null
  })
  secrets.set(`citefox.cloro.${id}`, secret)
  return secret
}

/** The engine a cloro request is for, from its path. Null for any other host. */
export function cloroEngineOf(request: HttpRequest): EngineId | null {
  if (!request.url.startsWith(CLORO_HOST)) return null
  const path = new URL(request.url).pathname
  const engines: Record<string, EngineId> = {
    '/v1/monitor/google': 'google_aio',
    '/v1/monitor/chatgpt': 'chatgpt',
    '/v1/monitor/perplexity': 'perplexity',
    '/v1/monitor/aimode': 'google_ai_mode',
    '/v1/monitor/gemini': 'gemini',
    '/v1/monitor/copilot': 'copilot'
  }
  return engines[path] ?? null
}

/** A recorded cloro body as text, with optional string swaps (e.g. a source URL). */
export function cloroFixture(name: string, swaps: Readonly<Record<string, string>> = {}): string {
  let text = readFileSync(join(CLORO_FIXTURES, name), 'utf8')
  for (const [from, to] of Object.entries(swaps)) text = text.split(from).join(to)
  return JSON.stringify(JSON.parse(text) as unknown)
}

export function cloroResponse(body: string, credits: number | null, status = 200): HttpResponse {
  return {
    status,
    body,
    headers: credits === null ? {} : { 'X-Credits-Charged': String(credits) }
  }
}

/** ChatGPT's recorded answer, with its third source moved to the seeded page. */
export function citingAnswer(): string {
  return cloroFixture('chatgpt.json', { 'https://www.emailtotxt.com/carriers/att': OWN_URL })
}

/** A canned reply: no sources and well under 160 characters. */
export function shortAnswer(): string {
  return JSON.stringify({
    success: true,
    result: { text: 'I cannot help with that.', sources: [], markdown: null }
  })
}

export function bearerOf(request: HttpRequest): string | null {
  const header = request.headers?.authorization ?? null
  return header === null ? null : header.replace(/^Bearer /, '')
}

export interface RunRow {
  id: string
  engines: EngineId[]
  googleAio: number
  status: string
}

export function runRows(db: SqliteDatabase): RunRow[] {
  return db
    .prepare<unknown[], { id: string; engines_json: string; google_aio: number; status: string }>(
      'SELECT id, engines_json, google_aio, status FROM runs ORDER BY started_at, id'
    )
    .all()
    .map((row) => ({
      id: row.id,
      engines: JSON.parse(row.engines_json) as EngineId[],
      googleAio: row.google_aio,
      status: row.status
    }))
}

export interface SerpRow {
  runId: string
  provider: string
  keyId: string | null
  status: string
  hasAio: number
  searches: number
  credits: number
  costMicros: number
  aioMarkdown: string | null
}

export function serpRowsRaw(db: SqliteDatabase): SerpRow[] {
  return db
    .prepare<
      unknown[],
      {
        run_id: string
        provider: string
        key_id: string | null
        status: string
        has_aio: number
        searches: number
        credits: number
        cost_micros: number
        aio_markdown: string | null
      }
    >(
      `SELECT run_id, provider, key_id, status, has_aio, searches, credits, cost_micros,
              aio_markdown FROM serp_results ORDER BY id`
    )
    .all()
    .map((row) => ({
      runId: row.run_id,
      provider: row.provider,
      keyId: row.key_id,
      status: row.status,
      hasAio: row.has_aio,
      searches: row.searches,
      credits: row.credits,
      costMicros: row.cost_micros,
      aioMarkdown: row.aio_markdown
    }))
}

export interface JobSpendRow {
  status: string
  provider: string | null
  creditsUsed: number
  costMicros: number
}

export function jobSpend(db: SqliteDatabase, jobId: string): JobSpendRow | null {
  const row = db
    .prepare<
      unknown[],
      { status: string; provider: string | null; credits_used: number; cost_micros: number }
    >('SELECT status, provider, credits_used, cost_micros FROM check_jobs WHERE id = ?')
    .get(jobId)
  return row === undefined
    ? null
    : {
        status: row.status,
        provider: row.provider,
        creditsUsed: row.credits_used,
        costMicros: row.cost_micros
      }
}

/** Month totals per key from `key_usage`. */
export function usageByKey(
  storage: AppStorage
): Record<string, { searches: number; credits: number }> {
  const rows = storage.db
    .prepare<unknown[], { key_id: string; searches: number; credits: number }>(
      `SELECT key_id, SUM(searches) AS searches, SUM(credits) AS credits FROM key_usage
       GROUP BY key_id ORDER BY key_id`
    )
    .all()
  return Object.fromEntries(
    rows.map((row) => [row.key_id, { searches: row.searches, credits: row.credits }])
  )
}
