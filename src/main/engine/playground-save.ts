import type {
  BuyerProfile,
  BuyerPrompt,
  CheckErrorCode,
  CoverageFindingKind,
  CoverageMatrix,
  KeyTestReason,
  PageSummary
} from '@shared/domain'
import type {
  AioCitedSource,
  PlaygroundAioRequest,
  PlaygroundAioResult,
  PlaygroundSavePart,
  SavePlaygroundRunRequest,
  SavePlaygroundRunResult
} from '@shared/ipc'
import { isPlaygroundSavePart } from '@shared/ipc'
import { IpcRequestError } from '../ipc-request'
import { PipelineError } from '../pipeline/errors'
import type { RememberedPlaygroundRun } from '../pipeline/playground'
import { contentHash, wordCount } from '../pipeline/hash'
import {
  validateBuyerProfile,
  validateBuyerPrompts,
  validateCoverage,
  type CoverageDraftRow,
  type PromptDraft
} from '../pipeline/validate'
import { usageMonth } from '../keys/present'
import { overviewSummary } from '../providers/serpapi/overview'
import { capAllowance } from '../queue/usage'
import type { QueueProjectInput } from '../queue/types'
import { closeProjectDatabase, openProjectDatabase } from '../storage/project-files'
import { readProjectScheduleCap } from '../storage/project-schedule'
import { getProject, listApiKeys, readActiveProjectId } from '../storage/records'
import {
  getLatestBuyerProfile,
  getLatestPromptSet,
  getLatestSnapshot,
  insertBuyerProfile,
  insertCoverage,
  insertPromptSet,
  insertSnapshot,
  nextPromptSetVersion,
  type StoredSnapshot
} from '../storage/content-records'
import { addPageMarket, getPageByUrl, insertPage } from '../storage/pages'
import { readProjectProfile } from '../storage/project-profile'
import type { SqliteDatabase } from '../storage/database'
import type { EngineHost } from './host'
import { pageMarkets } from './page-access'
import { withProject } from './project-db'
import { recordPageRead } from '../pipeline/page-history'
import {
  createCapGate,
  createKeyRotation,
  projectUsedForMonth,
  type RotatedCapture
} from './checks/key-rotation'
import { hostOf, normalizeUrl } from './checks/url'

const NO_MARKET = 'No default market is set. No search was sent.'
const NO_KEY = 'No SerpApi key is turned on. No search was sent.'
const EMPTY_PROMPT = 'Enter a prompt to check. No search was sent.'
const KEYS_OUT = 'Every SerpApi key is out of searches. No search was sent.'
const OVER_CAP = "This search would pass the project's search cap. No search was sent."

/** What the playground check needs from the engine host. */
export type PlaygroundHost = Pick<
  EngineHost,
  'storage' | 'secrets' | 'logger' | 'http' | 'now' | 'createId' | 'knownSecrets' | 'settings'
>

/**
 * One live-style SerpApi check per prompt, through the same capture, key
 * rotation, and project cap as a check (FR-11.2 to FR-11.4). The Google search
 * and its `page_token` follow-up share a key; a failover is recorded on the key
 * that answered. Every search is added to `key_usage` per key as it is sent,
 * with the active project, or null when none is active. Not stored as a run.
 */
export async function checkPlaygroundAio(
  host: PlaygroundHost,
  request: PlaygroundAioRequest,
  memory: { find(runId: string): RememberedPlaygroundRun | null }
): Promise<PlaygroundAioResult> {
  const channel = 'playground:checkAio'
  const market = resolveMarket(host, request)
  const active = readActiveProjectId(host.storage.db)
  const project = playgroundProject(host, active)
  const month = usageMonth(host.now())
  const rotation = createKeyRotation(host, {
    project,
    usageProjectId: active,
    month,
    chargeUsage: true
  })
  const gate = createCapGate({
    allowance: project.cap === null ? null : capAllowance(project.cap, project.capRule),
    used: active === null ? 0 : projectUsedForMonth(host.storage, active, month)
  })
  const labels = new Map(listApiKeys(host.storage.db).map((key) => [key.id, key.name]))
  const prompts = []
  let searches = 0
  for (const prompt of request.prompts) {
    if (prompt.trim().length === 0) {
      prompts.push(emptyPrompt(prompt, EMPTY_PROMPT, 'other'))
      continue
    }
    if (market === null) {
      prompts.push(emptyPrompt(prompt, NO_MARKET, 'other'))
      continue
    }
    if (rotation.keys().length === 0) {
      prompts.push(emptyPrompt(prompt, NO_KEY, 'other'))
      continue
    }
    const capture = await rotation.capture(
      {
        q: prompt,
        gl: market.country,
        hl: market.language,
        location: market.location,
        device: market.device
      },
      gate
    )
    searches += capture.searches
    prompts.push(fromCapture(prompt, request.url, capture, labels))
  }
  const result: PlaygroundAioResult = { url: request.url, runId: request.runId, prompts }
  if (request.runId !== null) {
    const stored = memory.find(request.runId)
    if (stored !== null) {
      stored.aio = result
      stored.result.usage = {
        ...stored.result.usage,
        serpapiSearches: stored.result.usage.serpapiSearches + searches
      }
    }
  }
  if (prompts.length === 0) throw new IpcRequestError(channel, 'Invalid request')
  return result
}

export function savePlaygroundRun(
  host: EngineHost,
  request: SavePlaygroundRunRequest,
  stored: RememberedPlaygroundRun
): Promise<SavePlaygroundRunResult> {
  const channel = 'playground:saveToProject'
  return withProject(host, request.projectId, channel, (opened) => {
    if (request.parts.includes('prompts')) {
      const existing = getPageByUrl(opened.db, stored.page.url, request.projectId)
      const profile = existing === null ? null : getLatestBuyerProfile(opened.db, existing.id)
      if (profile === null) {
        throw new PipelineError('This page has no buyer profile.', {
          code: 'not_found',
          nextStep: 'Generate a buyer profile for that page first.'
        })
      }
    }
    const page = ensurePage(host, opened.db, request.projectId, stored)
    const wanted = uniqueParts(request.parts)
    const written: PlaygroundSavePart[] = []
    let coverageRunId: string | null = null
    if (wanted.includes('pageRead')) {
      const snapshot = storeSnapshot(host, opened.db, page.id, stored)
      if (snapshot !== null) written.push('pageRead')
    }
    if (wanted.includes('buyerProfile') && stored.kind === 'buyer_profile') {
      const profile = storeProfile(host, opened.db, page.id, stored)
      if (profile !== null) written.push('buyerProfile')
    }
    if (wanted.includes('prompts') && stored.kind === 'buyer_prompts') {
      const view = storePrompts(host, opened.db, page, stored)
      if (view) written.push('prompts')
    }
    if (wanted.includes('coverage') && stored.kind === 'coverage') {
      const matrix = storeCoverage(host, opened.db, page.id, stored)
      if (matrix !== null) {
        coverageRunId = matrix.runId
        written.push('coverage')
      }
    }
    if (wanted.includes('aioChecks') && stored.aio !== null) written.push('aioChecks')
    return {
      projectId: request.projectId,
      pageId: page.id,
      runId: coverageRunId ?? stored.result.runId,
      parts: written
    }
  })
}

function resolveMarket(
  host: PlaygroundHost,
  request: PlaygroundAioRequest
): {
  country: string
  language: string
  location: string | null
  device: 'desktop' | 'mobile'
} | null {
  if (request.market !== null) return request.market
  const settings = host.settings()
  if (settings.defaultCountry === null || settings.defaultLanguage === null) return null
  return {
    country: settings.defaultCountry,
    language: settings.defaultLanguage,
    location: settings.defaultLocation,
    device: settings.defaultDevice
  }
}

/** Rotation and cap inputs for the active project, or an uncapped stand-in when none is active. */
function playgroundProject(host: PlaygroundHost, projectId: string | null): QueueProjectInput {
  const none: QueueProjectInput = {
    projectId: '',
    name: '',
    cap: null,
    capRule: 'pause',
    dedicatedKeyId: null,
    paused: false
  }
  if (projectId === null) return none
  const project = getProject(host.storage.db, projectId)
  if (project === null) return none
  const db = openProjectDatabase(host.storage.paths.projectsDirectory, project.slug)
  try {
    const cap = readProjectScheduleCap(db)
    return {
      projectId: project.id,
      name: project.name,
      cap: cap.cap,
      capRule: cap.capRule,
      dedicatedKeyId: cap.dedicatedKeyId,
      paused: false
    }
  } finally {
    closeProjectDatabase(db)
  }
}

function emptyPrompt(
  prompt: string,
  message: string,
  reason: KeyTestReason
): PlaygroundAioResult['prompts'][number] {
  return {
    prompt,
    ok: false,
    keyId: null,
    keyLabel: null,
    reason,
    message,
    cited: null,
    citedSources: [],
    position: null,
    summary: null
  }
}

function fromCapture(
  prompt: string,
  pageUrl: string,
  capture: RotatedCapture,
  labels: ReadonlyMap<string, string>
): PlaygroundAioResult['prompts'][number] {
  if (capture.exhausted) return emptyPrompt(prompt, KEYS_OUT, 'out_of_searches')
  if (capture.halted && capture.searches === 0) return emptyPrompt(prompt, OVER_CAP, 'other')
  const keyId = capture.keyId
  const keyLabel = keyId === null ? null : (labels.get(keyId) ?? null)
  if (capture.errorCode !== null || capture.halted) {
    return {
      ...emptyPrompt(prompt, capture.message ?? OVER_CAP, reasonFor(capture.errorCode)),
      keyId,
      keyLabel
    }
  }
  const target = normalizeUrl(pageUrl)
  const citedSources: AioCitedSource[] = capture.references
    .map((reference) => ({ url: reference.url, domain: hostOf(reference.url) }))
    .filter((source) => source.domain.length > 0)
    .map((source, index) => ({ ...source, position: index + 1 }))
  const match = citedSources.find(
    (source) => target !== null && normalizeUrl(source.url) === target
  )
  return {
    prompt,
    ok: true,
    keyId,
    keyLabel,
    reason: null,
    message: null,
    cited: match !== undefined,
    citedSources,
    position: match?.position ?? null,
    summary: capture.hasAio
      ? overviewSummary({ text: capture.aioText, references: capture.references })
      : null
  }
}

/** Playground reasons are the key-test reasons; capture-only codes read as `other`. */
function reasonFor(code: CheckErrorCode | null): KeyTestReason {
  if (code === 'rejected' || code === 'out_of_searches' || code === 'rate_limited') return code
  if (code === 'timeout') return code
  return 'other'
}

function uniqueParts(parts: readonly PlaygroundSavePart[]): PlaygroundSavePart[] {
  const seen = new Set<PlaygroundSavePart>()
  const ordered: PlaygroundSavePart[] = []
  for (const part of parts) {
    if (!isPlaygroundSavePart(part) || seen.has(part)) continue
    seen.add(part)
    ordered.push(part)
  }
  return ordered
}

function ensurePage(
  host: EngineHost,
  db: SqliteDatabase,
  projectId: string,
  stored: RememberedPlaygroundRun
): PageSummary {
  const existing = getPageByUrl(db, stored.page.url, projectId)
  if (existing !== null) return existing
  const market = readProjectProfile(db)?.market ?? null
  if (market === null) {
    throw new IpcRequestError('playground:saveToProject', 'Add a market or set the project default')
  }
  const settings = host.settings()
  const page: PageSummary = {
    id: `page-${host.createId()}`,
    projectId,
    url: stored.page.url,
    title: blankToNull(stored.page.title),
    label: null,
    folder: folderFromUrl(stored.page.url),
    status: 'setting_up',
    setupStep: 'read',
    intervalDays: settings.defaultIntervalDays,
    samples: settings.defaultSamples,
    promptCount: settings.defaultPromptCount,
    defaultMarketId: market.id,
    pinned: false,
    score: null,
    promptSetVersion: null
  }
  insertPage(db, page)
  addPageMarket(db, {
    pageId: page.id,
    marketId: market.id,
    addedAt: host.now().toISOString(),
    baselineRunId: null
  })
  return getPageByUrl(db, stored.page.url, projectId) ?? page
}

function storeSnapshot(
  host: EngineHost,
  db: SqliteDatabase,
  pageId: string,
  stored: RememberedPlaygroundRun
): StoredSnapshot | null {
  const body = stored.page.pageText.trim()
  if (body.length === 0) return null
  const snapshot: StoredSnapshot = {
    id: `snap-${host.createId()}`,
    pageId,
    fetchedAt: host.now().toISOString(),
    method: 'direct',
    httpStatus: 200,
    durationMs: 0,
    title: blankToNull(stored.page.title),
    metaDescription: blankToNull(stored.page.metaDescription),
    h1: blankToNull(stored.page.h1),
    canonical: null,
    publishedAt: null,
    modifiedAt: null,
    outline: [],
    faqs: [],
    h2Count: 0,
    h3Count: 0,
    tableCount: 0,
    bodyText: body,
    wordCount: wordCount(body),
    contentHash: contentHash(body),
    summary: null
  }
  insertSnapshot(db, snapshot)
  // The page's change history starts with this read.
  recordPageRead(db, {
    pageId,
    snapshot,
    readAt: snapshot.fetchedAt,
    publishedAt: null,
    modifiedAt: null
  })
  return snapshot
}

function storeProfile(
  host: EngineHost,
  db: SqliteDatabase,
  pageId: string,
  stored: RememberedPlaygroundRun
): BuyerProfile | null {
  const parsed = parseJson(stored.result.modelOutput)
  if (parsed === null || validateBuyerProfile(parsed) !== null) return null
  const snapshot = latestOrStore(host, db, pageId, stored)
  if (snapshot === null) return null
  const body = parsed as Omit<
    BuyerProfile,
    | 'id'
    | 'pageId'
    | 'snapshotId'
    | 'templateId'
    | 'templateName'
    | 'templateHash'
    | 'templateUpdatedAt'
    | 'createdAt'
    | 'promptsStale'
  >
  const profile: BuyerProfile = {
    ...body,
    id: `icp-${host.createId()}`,
    pageId,
    snapshotId: snapshot.id,
    templateId: stored.result.templateId,
    templateName: stored.result.templateName,
    templateHash: stored.result.templateHash,
    templateUpdatedAt: stored.result.templateUpdatedAt,
    createdAt: host.now().toISOString(),
    promptsStale: false
  }
  insertBuyerProfile(db, profile)
  return profile
}

function storePrompts(
  host: EngineHost,
  db: SqliteDatabase,
  page: PageSummary,
  stored: RememberedPlaygroundRun
): boolean {
  const parsed = parseJson(stored.result.modelOutput)
  if (parsed === null || !isPromptDrafts(parsed)) return false
  const brands = readProjectProfile(db)?.brandNames ?? []
  const markets = pageMarkets(db, page.id)
  const market = markets[0]
  if (market === undefined) return false
  const problem = validateBuyerPrompts(parsed, {
    count: parsed.prompts.length,
    brands,
    canonical: null,
    language: market.language,
    canonicalLanguage: market.language
  })
  if (problem !== null) return false
  const snapshot = latestOrStore(host, db, page.id, stored)
  if (snapshot === null) return false
  const profile = getLatestBuyerProfile(db, page.id)
  if (profile === null) {
    throw new PipelineError('This page has no buyer profile.', {
      code: 'not_found',
      nextStep: 'Generate a buyer profile for that page first.'
    })
  }
  const prompts: BuyerPrompt[] = parsed.prompts.map((draft, index) => ({
    id: `prompt-${host.createId()}`,
    position: index + 1,
    label: draft.label,
    source: draft.source,
    intentStage: draft.intentStage,
    mappedElement: draft.mappedElement,
    enabled: true,
    variants: markets.map((item) => ({
      marketId: item.id,
      language: item.language,
      text: draft.text,
      originalText: null
    }))
  }))
  insertPromptSet(
    db,
    {
      id: `pset-${host.createId()}`,
      pageId: page.id,
      version: nextPromptSetVersion(db, page.id),
      savedAt: host.now().toISOString(),
      icpId: profile.id,
      templateId: stored.result.templateId,
      templateName: stored.result.templateName,
      templateHash: stored.result.templateHash,
      templateUpdatedAt: stored.result.templateUpdatedAt,
      prompts
    },
    brands
  )
  return true
}

function storeCoverage(
  host: EngineHost,
  db: SqliteDatabase,
  pageId: string,
  stored: RememberedPlaygroundRun
): CoverageMatrix | null {
  const parsed = parseJson(stored.result.modelOutput)
  const brands = readProjectProfile(db)?.brandNames ?? []
  const promptSet = getLatestPromptSet(db, pageId, brands)
  if (promptSet === null || promptSet.prompts.length === 0) return null
  const snapshot = latestOrStore(host, db, pageId, stored)
  if (snapshot === null || parsed === null) return null
  const pageText = [
    snapshot.title ?? '',
    snapshot.metaDescription ?? '',
    snapshot.h1 ?? '',
    snapshot.bodyText
  ].join('\n')
  if (validateCoverage(parsed, { count: promptSet.prompts.length, pageText }) !== null) return null
  const draft = parsed as { rows: CoverageDraftRow[]; findings: FindingDraft[] }
  if (draft.rows.some((row) => !promptSet.prompts.some((item) => item.position === row.position))) {
    return null
  }
  const runId = `run-${host.createId()}`
  const matrix: CoverageMatrix = {
    runId,
    pageId,
    recordedAt: host.now().toISOString(),
    templateId: stored.result.templateId,
    templateName: stored.result.templateName,
    templateHash: stored.result.templateHash,
    templateUpdatedAt: stored.result.templateUpdatedAt,
    contentHash: snapshot.contentHash,
    reused: false,
    stale: false,
    rows: draft.rows.map((row) => {
      const prompt = promptSet.prompts.find((item) => item.position === row.position)
      const first = row.actions[0]
      if (prompt === undefined || first === undefined) {
        throw new IpcRequestError('playground:saveToProject', 'Invalid request')
      }
      return {
        id: `cov-${host.createId()}`,
        runId,
        pageId,
        promptId: prompt.id,
        coverage: row.coverage as CoverageMatrix['rows'][number]['coverage'],
        whereCovered: row.whereCovered,
        currentContent: row.currentContent,
        whatToUpdate: row.whatToUpdate,
        mainGap: row.mainGap,
        priority: row.priority as CoverageMatrix['rows'][number]['priority'],
        actions: [first, ...row.actions.slice(1)],
        suggestedFaq:
          row.suggestedFaq === null
            ? null
            : {
                question: row.suggestedFaq.question,
                answer: row.suggestedFaq.answer,
                wordCount: wordCount(row.suggestedFaq.answer)
              },
        done: false
      }
    }),
    findings: draft.findings.map((finding) => ({
      id: `find-${host.createId()}`,
      runId,
      pageId,
      kind: finding.kind,
      summary: finding.summary,
      detail: finding.detail
    }))
  }
  insertCoverage(db, matrix)
  return matrix
}

interface FindingDraft {
  kind: CoverageFindingKind
  summary: string
  detail: string
}

function latestOrStore(
  host: EngineHost,
  db: SqliteDatabase,
  pageId: string,
  stored: RememberedPlaygroundRun
): StoredSnapshot | null {
  return getLatestSnapshot(db, pageId) ?? storeSnapshot(host, db, pageId, stored)
}

function parseJson(text: string): unknown | null {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match?.[1] === undefined) return null
    try {
      return JSON.parse(match[1]) as unknown
    } catch {
      return null
    }
  }
}

function isPromptDrafts(value: unknown): value is { prompts: PromptDraft[] } {
  return typeof value === 'object' && value !== null && 'prompts' in value
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function folderFromUrl(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split('/').filter((part) => part.length > 0)
    if (parts.length < 2) return null
    return parts[0] ?? null
  } catch {
    return null
  }
}
