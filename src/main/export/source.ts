import { exportSentimentRows } from './sections/reputation'
import type {
  AioReference,
  ContentChange,
  Market,
  PageSummary,
  PromptCheckStatus
} from '@shared/domain'
import {
  buildBuckets,
  buildCannibalizing,
  buildFunnel,
  buildLeaderboard,
  buildPromptRows,
  buildTopActions,
  contentChangeBetween,
  isStale,
  metricsFor,
  type RunIdentity,
  type ScorePrompt,
  type ScoreSample
} from '../engine/checks/score'
import { normalizeUrl } from '../engine/checks/url'
import { getLatestCoverage, getLatestSnapshot } from '../storage/content-records'
import {
  listStoredAioReferences,
  listStoredCheckRuns,
  listStoredMarketPrompts,
  listStoredSerpResults,
  readStoredPromptSet,
  readStoredSnapshotFacts,
  type CheckReadFilter,
  type StoredAioReference,
  type StoredCheckRun,
  type StoredSerpResult
} from '../storage/check-records'
import type { SqliteDatabase } from '../storage/database'
import { listFixFollowUps } from '../storage/fix-follow-ups'
import { listPages } from '../storage/pages'
import { closeProjectDatabase, openProjectDatabase } from '../storage/project-files'
import { listMarkets, readProjectProfile } from '../storage/project-profile'
import { getProject, type ProjectRecord } from '../storage/records'
import { slugFromLabel } from '../storage/slug'
import { isCalendarDate } from './prepare'
import { readReportFacts } from './report-facts'
import { inclusiveFinishedBounds, isIanaTimeZone } from './timezone'
import type {
  ExportCheck,
  ExportDataSource,
  ExportDataset,
  ExportLoadQuery,
  ExportMarketSlice,
  ExportPage,
  ExportRawSample
} from './types'

interface FinishedRun extends StoredCheckRun {
  finishedAt: string
}

/**
 * Project-file reads for every export format.
 * Check rows come from `listStoredCheckRuns`, `listStoredSerpResults`, and
 * `listStoredAioReferences`. Raw SerpApi JSON is copied onto the dataset only when
 * `includeRaw` is set, which only a JSON export does (FR-22.3, NFR-5).
 * Sentiment rows come from `sections/reputation.ts`. Notes and saved views have no table.
 */
export function createStorageExportSource(deps: {
  app: SqliteDatabase
  projectsDirectory: string
  now: () => Date
}): ExportDataSource {
  return {
    async loadExportDataset(query) {
      const project = getProject(deps.app, query.projectId)
      if (project === null) throw new Error('That project was not found')
      const db = openProjectDatabase(deps.projectsDirectory, project.slug)
      try {
        return readDataset(db, project, query, deps.now())
      } finally {
        closeProjectDatabase(db)
      }
    }
  }
}

function readDataset(
  db: SqliteDatabase,
  project: ProjectRecord,
  query: ExportLoadQuery,
  now: Date
): ExportDataset {
  const filter = readFilter(query)
  const runs = finishedRuns(listStoredCheckRuns(db, filter))
  const captures = listStoredSerpResults(db, filter)
  const references = listStoredAioReferences(db, filter)
  const profile = readProjectProfile(db)
  const marketById = new Map(listMarkets(db).map((market) => [market.id, market]))
  const capturesByRun = groupBy(captures, (capture) => capture.runId)
  const referencesByCapture = groupBy(references, (reference) => reference.serpResultId)
  const runsByPage = groupBy(runs, (run) => run.pageId)
  const tracked = trackedPages(db, project.id)
  const pages = listPages(db, project.id)
    .filter((page) => page.status !== 'removed')
    .map((page) =>
      toPage(
        db,
        page,
        runsByPage.get(page.id) ?? [],
        capturesByRun,
        referencesByCapture,
        marketById,
        profile?.includeSubdomains ?? false,
        project.domain,
        tracked,
        query.includeRaw === true,
        now
      )
    )
  return {
    projectName: project.name,
    projectSlug: project.slug,
    clientName: project.clientName,
    views: [],
    pages,
    report: readReportFacts(db, {
      domain: project.domain,
      profile,
      pages,
      promptSetIds: runs.map((run) => run.promptSetId)
    })
  }
}

function readFilter(query: ExportLoadQuery): CheckReadFilter {
  let from: string | null = null
  let to: string | null = null
  if (
    query.checks === 'range' &&
    isCalendarDate(query.from) &&
    isCalendarDate(query.to) &&
    isIanaTimeZone(query.timeZone)
  ) {
    const bounds = inclusiveFinishedBounds(query.from, query.to, query.timeZone)
    from = bounds.from
    to = bounds.to
  }
  return {
    projectId: query.projectId,
    pageIds: query.scope === 'page' || query.scope === 'selected' ? query.pageIds : null,
    marketId: null,
    from,
    to,
    runId: null,
    promptId: null
  }
}

function toPage(
  db: SqliteDatabase,
  page: PageSummary,
  runs: readonly FinishedRun[],
  capturesByRun: ReadonlyMap<string, StoredSerpResult[]>,
  referencesByCapture: ReadonlyMap<string, StoredAioReference[]>,
  marketById: ReadonlyMap<string, Market>,
  includeSubdomains: boolean,
  domain: string,
  tracked: ReadonlyMap<string, string>,
  includeRaw: boolean,
  now: Date
): ExportPage {
  const snapshot = getLatestSnapshot(db, page.id)
  const coverage = getLatestCoverage(db, page.id, snapshot?.contentHash ?? null)
  const byMarket = groupBy(runs, (run) => run.marketId)
  const markets: ExportMarketSlice[] = []
  for (const marketId of marketOrder(marketById, byMarket)) {
    const marketRuns = byMarket.get(marketId) ?? []
    markets.push({
      marketId,
      code: marketCode(marketById.get(marketId), marketId),
      checks: marketRuns.map((run) =>
        toCheck(
          db,
          run,
          marketRuns,
          capturesByRun,
          referencesByCapture,
          coverage,
          includeSubdomains,
          domain,
          tracked,
          includeRaw
        )
      )
    })
  }
  let latest = ''
  let promptSetVersion = page.promptSetVersion
  for (const market of markets) {
    for (const check of market.checks) {
      if (check.finishedAt < latest) continue
      latest = check.finishedAt
      promptSetVersion = check.metrics.promptSetVersion
    }
  }
  return {
    pageId: page.id,
    // A topic has no URL; its sections name the topic title instead.
    url: page.url ?? '',
    ...(page.kind === 'topic' ? { kind: 'topic' as const } : {}),
    title: snapshot?.title ?? page.title,
    slug: pageSlug(page),
    metaDescription: snapshot?.metaDescription ?? null,
    h1: snapshot?.h1 ?? null,
    snapshotAt: snapshot?.fetchedAt ?? null,
    modifiedAt: snapshot?.modifiedAt ?? null,
    promptSetVersion,
    stale: isStale(latest.length === 0 ? null : latest, now.toISOString()),
    markets,
    gaps: coverage,
    // REPORT-SPEC section 5: every claim of the page's latest full checks.
    sentiment: exportSentimentRows(db, page.projectId, page.id, null),
    notes: [],
    fixes: listFixFollowUps(db, page.id).map((fix) => ({
      number: fix.number,
      goLiveAt: fix.goLiveAt,
      description: fix.description,
      status: fix.status,
      promptIds: fix.promptIds,
      marketIds: fix.marketIds,
      verdict: fix.verdict
    }))
  }
}

function toCheck(
  db: SqliteDatabase,
  run: FinishedRun,
  marketRuns: readonly FinishedRun[],
  capturesByRun: ReadonlyMap<string, StoredSerpResult[]>,
  referencesByCapture: ReadonlyMap<string, StoredAioReference[]>,
  coverage: ReturnType<typeof getLatestCoverage>,
  includeSubdomains: boolean,
  domain: string,
  tracked: ReadonlyMap<string, string>,
  includeRaw: boolean
): ExportCheck {
  const previous =
    marketRuns
      .filter((item) => item.promptSetId === run.promptSetId && item.startedAt < run.startedAt)
      .at(-1) ?? null
  const prompts = scorePrompts(db, run, capturesByRun, referencesByCapture, coverage)
  const previousMap = previousRows(db, previous, capturesByRun, referencesByCapture)
  const built = buildPromptRows(prompts, previousMap)
  const change = contentDelta(db, previous, run)
  const rows = built.map((item) => item.row)
  const gapReasons = new Map(prompts.map((prompt) => [prompt.promptId, prompt.mainGap ?? '']))
  return {
    finishedAt: run.finishedAt,
    role: null,
    metrics: metricsFor(identityOf(db, run), built, change.changed, change.change),
    prompts: rows,
    details: built.map((item) => ({
      promptId: item.row.promptId,
      aioText: item.winning?.aioText ?? null,
      references: item.winning?.references ?? [],
      aioGap: []
    })),
    funnel: buildFunnel(rows),
    buckets: buildBuckets(rows),
    topActions: buildTopActions(rows, gapReasons),
    leaderboard: buildLeaderboard(built, domain, includeSubdomains),
    cannibalizing: buildCannibalizing(built, tracked).map((hit) => ({
      url: hit.url,
      tracked: hit.tracked,
      promptIds: unique(hit.prompts.map((prompt) => prompt.promptId))
    })),
    ...(includeRaw ? { raw: rawSamples(capturesByRun.get(run.id) ?? []) } : {})
  }
}

function rawSamples(captures: readonly StoredSerpResult[]): ExportRawSample[] {
  return captures.map((capture) => ({
    promptId: capture.promptId,
    sampleNo: capture.sampleNo,
    searchJson: capture.rawSearchJson,
    aioJson: capture.rawAioJson
  }))
}

function scorePrompts(
  db: SqliteDatabase,
  run: FinishedRun,
  capturesByRun: ReadonlyMap<string, StoredSerpResult[]>,
  referencesByCapture: ReadonlyMap<string, StoredAioReference[]>,
  coverage: ReturnType<typeof getLatestCoverage>
): ScorePrompt[] {
  const facts = listStoredMarketPrompts(db, run.promptSetId, run.marketId)
  const byPrompt = groupBy(capturesByRun.get(run.id) ?? [], (capture) => capture.promptId)
  const prompts: ScorePrompt[] = []
  for (const fact of facts) {
    const samples = byPrompt.get(fact.id) ?? []
    if (samples.length === 0) continue
    const row = coverage?.rows.find((item) => item.promptId === fact.id)
    prompts.push({
      promptId: fact.id,
      promptPosition: fact.position,
      label: fact.label,
      text: fact.text,
      source: fact.source,
      intentStage: fact.intentStage,
      samples: samples.map((sample) => toSample(sample, referencesByCapture)),
      coverage: row?.coverage ?? null,
      action: row?.whatToUpdate ?? null,
      mainGap: row?.mainGap ?? null,
      checkedAt: run.finishedAt
    })
  }
  return prompts
}

function previousRows(
  db: SqliteDatabase,
  previous: FinishedRun | null,
  capturesByRun: ReadonlyMap<string, StoredSerpResult[]>,
  referencesByCapture: ReadonlyMap<string, StoredAioReference[]>
): Map<string, { status: PromptCheckStatus; position: number | null }> {
  const map = new Map<string, { status: PromptCheckStatus; position: number | null }>()
  if (previous === null) return map
  for (const item of buildPromptRows(
    scorePrompts(db, previous, capturesByRun, referencesByCapture, null),
    new Map()
  )) {
    map.set(item.row.promptId, { status: item.row.status, position: item.row.position })
  }
  return map
}

function identityOf(db: SqliteDatabase, run: FinishedRun): RunIdentity {
  const facts = readStoredPromptSet(db, run.promptSetId)
  // RunIdentity still types this as number. Engine owns that type. The value stays null.
  return {
    runId: run.id,
    pageId: run.pageId,
    marketId: run.marketId,
    promptSetId: run.promptSetId,
    promptSetVersion: facts?.version ?? null,
    snapshotId: run.snapshotId,
    contentHash: run.contentHash,
    kind: run.kind,
    partial: run.partial,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt
  } as RunIdentity
}

function contentDelta(
  db: SqliteDatabase,
  previous: FinishedRun | null,
  current: FinishedRun
): { changed: boolean; change: ContentChange | null } {
  if (previous === null || previous.contentHash === current.contentHash) {
    return { changed: false, change: null }
  }
  const before = readStoredSnapshotFacts(db, previous.snapshotId)
  const after = readStoredSnapshotFacts(db, current.snapshotId)
  if (before === null || after === null) return { changed: true, change: null }
  return { changed: true, change: contentChangeBetween(before, after) }
}

function toSample(
  sample: StoredSerpResult,
  referencesByCapture: ReadonlyMap<string, StoredAioReference[]>
): ScoreSample {
  return {
    sampleNo: sample.sampleNo,
    status: sample.status,
    named: sample.named,
    citedUrl: sample.citedUrl,
    position: sample.position,
    aioText: sample.aioText,
    references: (referencesByCapture.get(sample.id) ?? []).map((reference) =>
      toReference(reference)
    )
  }
}

function toReference(reference: StoredAioReference): AioReference {
  return {
    id: reference.id,
    position: reference.position,
    url: reference.url,
    normalizedUrl: reference.normalizedUrl,
    domain: reference.domain,
    title: reference.title,
    classification: reference.classification,
    untracked: reference.untracked,
    sourceType: reference.sourceType
  }
}

function finishedRuns(runs: readonly StoredCheckRun[]): FinishedRun[] {
  return runs.flatMap((run) =>
    run.status === 'finished' && run.finishedAt !== null
      ? [{ ...run, finishedAt: run.finishedAt }]
      : []
  )
}

function marketOrder(
  marketById: ReadonlyMap<string, Market>,
  byMarket: ReadonlyMap<string, FinishedRun[]>
): string[] {
  const ordered = [...marketById.keys()].filter((id) => byMarket.has(id))
  for (const id of byMarket.keys()) {
    if (!ordered.includes(id)) ordered.push(id)
  }
  return ordered
}

function marketCode(market: Market | undefined, marketId: string): string {
  if (market === undefined) return marketId
  return `${market.country}-${market.language}`.toLowerCase()
}

function pageSlug(page: PageSummary): string {
  let label = page.label ?? page.id
  if (page.url === null) return slugFromLabel(page.label ?? page.title ?? page.id) ?? page.id
  try {
    const last = new URL(page.url).pathname
      .split('/')
      .filter((part) => part.length > 0)
      .at(-1)
    if (last !== undefined) label = decodeURIComponent(last)
  } catch {
    label = page.label ?? page.id
  }
  return slugFromLabel(label) ?? page.id
}

function trackedPages(db: SqliteDatabase, projectId: string): Map<string, string> {
  const pages = new Map<string, string>()
  for (const page of listPages(db, projectId)) {
    if (page.status !== 'tracked' && page.status !== 'setting_up' && page.status !== 'paused')
      continue
    if (page.url === null) continue
    const normalized = normalizeUrl(page.url)
    if (normalized !== null) pages.set(normalized, page.id)
  }
  return pages
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const id = key(item)
    const list = map.get(id)
    if (list === undefined) map.set(id, [item])
    else list.push(item)
  }
  return map
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}
