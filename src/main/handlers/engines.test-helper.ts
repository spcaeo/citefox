/**
 * Seeds for the `engines:*` handler tests: the Progress TextBolt project (one page,
 * three prompts, 🇺🇸 US and 🇬🇧 UK) plus a cloro key, runs, Google samples, answer-engine
 * replies, brand captures and key usage written straight to storage. Test-only.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CLORO_CREDITS,
  type AnswerEngineId,
  type BuyerPrompt,
  type CheckRunStatus,
  type EngineAnswerStatus,
  type EngineId,
  type PromptCheckStatus,
  type SearchProvider
} from '@shared/domain'
import type { IpcHandlerMap } from '@shared/ipc'
import { contentHash } from '../pipeline/hash'
import { insertBrandPromptSet } from '../storage/brand-records'
import {
  finishStoredCheckJob,
  finishStoredRun,
  insertStoredCheckJob,
  insertStoredRun,
  insertStoredSerpResult,
  type NewSerpResult
} from '../storage/check-records'
import { insertPromptSet } from '../storage/content-records'
import {
  insertEngineAnswer,
  setStoredJobSpend,
  type NewEngineAnswer,
  type NewEngineSource
} from '../storage/engine-records'
import { closeProjectDatabase, openProjectDatabase } from '../storage/project-files'
import { insertApiKey } from '../storage/records'
import { insertBrandCapture } from '../storage/sentiment-records'
import {
  openProgressSeed,
  PAGE_URL,
  PROGRESS_SEED,
  type ProgressSeed
} from './progress.test-helper'

export { PAGE_URL, PROGRESS_SEED }

export type ProjectDb = ReturnType<typeof openProjectDatabase>

/** Lite: $30 for 37,500 credits, so one credit is 800 micro-dollars. */
export const MICROS_PER_LITE_CREDIT = 800

const opened: ProgressSeed[] = []
const directories: string[] = []

export function cleanupEngineSeeds(): void {
  for (const seed of opened.splice(0)) seed.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
}

/** A fresh TextBolt project; `cloro: true` also saves an on cloro key for every project. */
export function openEngineSeed(options: { cloro?: boolean } = {}): ProgressSeed {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-engines-'))
  directories.push(directory)
  const seed = openProgressSeed(directory)
  opened.push(seed)
  if (options.cloro === true) addCloroKey(seed)
  return seed
}

export function withDb<T>(seed: ProgressSeed, run: (db: ProjectDb) => T): T {
  const db = openProjectDatabase(seed.storage.paths.projectsDirectory, 'textbolt')
  try {
    return run(db)
  } finally {
    closeProjectDatabase(db)
  }
}

export function addCloroKey(
  seed: ProgressSeed,
  options: { id?: string; on?: boolean; projectIds?: readonly string[] } = {}
): void {
  const id = options.id ?? 'key-cloro'
  insertApiKey(seed.storage.db, {
    id,
    provider: 'cloro',
    name: 'cloro',
    keychainRef: `citefox.cloro.${id}`,
    hint: 'cl01',
    rotationOrder: 2,
    cap: null,
    on: options.on ?? true,
    projectIds: [...(options.projectIds ?? [])],
    state: 'ok',
    lastReason: null,
    serpapiUsage: null,
    plan: null
  })
}

/** The seeded SerpApi key (`key-1`) on a paid plan: Starter is $25 for 1,000 searches. */
export function serpApiOnStarter(seed: ProgressSeed): void {
  seed.storage.db.prepare(`UPDATE api_keys SET plan = 'Starter' WHERE id = 'key-1'`).run()
}

export interface RunSeed {
  id: string
  startedAt: string
  /** Default: `job-<id>`, created here. Pass an existing job to attach the run to it. */
  jobId?: string
  engines?: readonly EngineId[]
  marketId?: string
  pageId?: string
  promptSetId?: string
  /** Default `finished`. `running` leaves the run unfinished. */
  status?: CheckRunStatus
}

/** A run (and its job unless `jobId` is given), finished 90 seconds after it started. */
export function addRun(db: ProjectDb, run: RunSeed): void {
  const pageId = run.pageId ?? PROGRESS_SEED.pageId
  const marketId = run.marketId ?? PROGRESS_SEED.us
  const jobId = run.jobId ?? `job-${run.id}`
  if (run.jobId === undefined) {
    insertStoredCheckJob(db, {
      id: jobId,
      startedAt: run.startedAt,
      status: 'running',
      pageIds: [pageId],
      marketIds: [marketId],
      promptIds: null,
      reason: 'manual',
      message: null,
      nextStep: null
    })
  }
  const snapshot = db
    .prepare<unknown[], { id: string; content_hash: string }>(
      'SELECT id, content_hash FROM snapshots ORDER BY fetched_at DESC LIMIT 1'
    )
    .get()!
  insertStoredRun(db, {
    id: run.id,
    jobId,
    pageId,
    promptSetId: run.promptSetId ?? 'pset-1',
    snapshotId: snapshot.id,
    marketId,
    startedAt: run.startedAt,
    kind: 'manual',
    partial: false,
    samples: 1,
    contentHash: snapshot.content_hash,
    engines: run.engines ?? ['google_aio']
  })
  const status = run.status ?? 'finished'
  if (status !== 'running') finishStoredRun(db, run.id, finishedAt(run.startedAt), status)
}

export function finishedAt(startedAt: string): string {
  return new Date(Date.parse(startedAt) + 90_000).toISOString()
}

/** One Google AI Overview sample. Returns its id. */
export function addGoogle(
  db: ProjectDb,
  runId: string,
  promptId: string,
  sampleNo: number,
  status: PromptCheckStatus,
  extra: Partial<NewSerpResult> = {}
): string {
  const id = `${runId}-g-${promptId}-${sampleNo}`
  const aio = status !== 'no_aio' && status !== 'error'
  insertStoredSerpResult(db, {
    id,
    runId,
    promptId,
    sampleNo,
    keyId: null,
    hasAio: aio,
    neededFollowup: false,
    searches: 1,
    status,
    named: null,
    citedUrl: null,
    position: null,
    aioText: aio ? `Overview ${sampleNo}` : null,
    errorCode: status === 'error' ? 'timeout' : null,
    message: status === 'error' ? 'Search failed.' : null,
    nextStep: null,
    rawSearchJson: null,
    rawAioJson: null,
    references: [],
    ...extra
  })
  return id
}

/** One answer-engine reply, charged at cloro's list price on Lite unless `extra` says. */
export function addAnswer(
  db: ProjectDb,
  runId: string,
  promptId: string,
  engine: AnswerEngineId,
  status: EngineAnswerStatus,
  sampleNo = 1,
  extra: Partial<NewEngineAnswer> = {}
): string {
  const id = `${runId}-${engine}-${promptId}-${sampleNo}`
  const credits = status === 'unavailable' ? 0 : CLORO_CREDITS[engine]
  insertEngineAnswer(db, {
    id,
    runId,
    promptId,
    sampleNo,
    engine,
    keyId: 'key-cloro',
    status,
    citedUrl: status === 'cited' ? PAGE_URL : null,
    position: status === 'cited' ? 1 : null,
    named: status === 'named',
    answerText: `${engine} answer ${sampleNo}`,
    answerMarkdown: `**${engine}** answer ${sampleNo}`,
    errorCode: status === 'error' ? 'timeout' : null,
    message: status === 'error' ? 'cloro timed out' : null,
    searches: 1,
    credits,
    costMicros: credits * MICROS_PER_LITE_CREDIT,
    rawJson: null,
    checkedAt: '2026-10-20T12:00:30.000Z',
    sources: [],
    ...extra
  })
  return id
}

export function source(
  id: string,
  position: number,
  domain: string,
  classification: NewEngineSource['classification'] = 'other'
): NewEngineSource {
  const url = `https://${domain}/p${position}`
  return {
    id,
    position,
    url,
    normalizedUrl: url,
    domain,
    title: `${domain} ${position}`,
    classification
  }
}

/** What a job spent, as the check engine stores it when the job ends. */
export function finishJob(
  db: ProjectDb,
  jobId: string,
  spend: {
    status?: 'finished' | 'cancelled' | 'error'
    searches: number
    credits: number
    costMicros: number
    provider: SearchProvider | null
    at: string
  }
): void {
  finishStoredCheckJob(db, jobId, spend.at, spend.status ?? 'finished', spend.searches, null, null)
  setStoredJobSpend(db, jobId, {
    provider: spend.provider,
    credits: spend.credits,
    costMicros: spend.costMicros
  })
}

/** A job with no run (refused before it searched). */
export function addEmptyJob(db: ProjectDb, jobId: string, startedAt: string): void {
  insertStoredCheckJob(db, {
    id: jobId,
    startedAt,
    status: 'running',
    pageIds: [PROGRESS_SEED.pageId],
    marketIds: null,
    promptIds: null,
    reason: 'manual',
    message: null,
    nextStep: null
  })
}

/** Brand prompts on the page: `en` ones run in both markets, the `es` one in neither. */
export function addBrandPrompts(db: ProjectDb): void {
  insertBrandPromptSet(db, {
    pageId: PROGRESS_SEED.pageId,
    savedAt: PROGRESS_SEED.first,
    templateId: null,
    templateHash: null,
    prompts: [
      { id: 'bp-review', kind: 'review', language: 'en', text: 'TextBolt reviews' },
      { id: 'bp-pricing', kind: 'pricing', language: 'en', text: 'TextBolt pricing' },
      { id: 'bp-es', kind: 'review', language: 'es', text: 'TextBolt opiniones' }
    ]
  })
}

export function addBrandCapture(
  db: ProjectDb,
  runId: string,
  spend: { searches: number; credits: number; costMicros: number }
): void {
  insertBrandCapture(db, {
    id: `${runId}-brand`,
    runId,
    brandPromptId: 'bp-review',
    promptText: 'TextBolt reviews',
    keyId: null,
    hasAio: false,
    neededFollowup: false,
    searches: spend.searches,
    status: 'no_aio',
    aioText: null,
    references: [],
    errorCode: null,
    message: null,
    rawSearchJson: null,
    rawAioJson: null,
    capturedAt: '2026-10-10T12:00:30.000Z',
    credits: spend.credits,
    costMicros: spend.costMicros
  })
}

/** Saves a new prompt set on the page, so `pset-1` (prompt-1 to 3) is no longer active. */
export function replacePromptSet(db: ProjectDb, promptId: string): void {
  const text = 'Which tool texts a crew from Outlook?'
  const prompt: BuyerPrompt = {
    id: promptId,
    position: 1,
    label: 'Outlook texts',
    source: 'title_meta_h1',
    intentStage: 'problem',
    mappedElement: 'intro',
    enabled: true,
    variants: [
      { marketId: PROGRESS_SEED.us, language: 'en', text, originalText: null },
      { marketId: PROGRESS_SEED.uk, language: 'en', text, originalText: null }
    ]
  }
  insertPromptSet(
    db,
    {
      id: 'pset-2',
      pageId: PROGRESS_SEED.pageId,
      version: 2,
      savedAt: '2026-10-15T12:00:00.000Z',
      icpId: 'icp-1',
      templateId: 'tpl-buyer-prompts',
      templateName: 'CiteFox default',
      templateHash: contentHash('template'),
      templateUpdatedAt: null,
      prompts: [prompt]
    },
    ['TextBolt']
  )
}

/** Calls a handler with a raw (possibly malformed) request; a refusal rejects. */
export function callRaw(
  handlers: IpcHandlerMap,
  channel: keyof IpcHandlerMap,
  request: unknown
): Promise<unknown> {
  const handler = handlers[channel] as (request: unknown) => unknown
  return Promise.resolve().then(() => handler(request))
}
