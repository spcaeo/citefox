import type {
  AioReference,
  ContentChange,
  MarketCheckMetrics,
  PageResults,
  PageSummary,
  PromptCheckDetail,
  PromptCheckRow,
  PromptMarketSnapshot,
  ResultsHistory,
  ResultsScope,
  SampleCapture
} from '@shared/domain'
import { getLatestCoverage, getLatestPromptSet } from '../../storage/content-records'
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
} from '../../storage/check-records'
import type { SqliteDatabase } from '../../storage/database'
import { nextFixNumber } from '../../storage/fix-follow-ups'
import { getPage, listPageMarkets, listPages } from '../../storage/pages'
import { listOverviewReads } from '../../storage/overview-reads'
import { readProjectProfile } from '../../storage/project-profile'
import { rulesOfKind, textProblem } from '../prompt-reword'
import { promptGoogleSearch, promptSampleIds } from './google-search'
import { overviewLens } from './overview-lens'
import { readStoredAioGap, readStoredRunSummary } from './report-files'
import { normalizeUrl } from './url'
import {
  buildPageResults,
  buildPromptRows,
  comparisonColumn,
  contentChangeBetween,
  emptyPageResults,
  isStale,
  metricsFor,
  trendPoint,
  type BuiltPrompt,
  type RunIdentity,
  type ScorePrompt,
  type ScoreSample
} from './score'

export class CheckInputError extends Error {
  constructor(message = 'Invalid request') {
    super(message)
    this.name = 'CheckInputError'
  }
}

export interface ResultsLoad {
  projectId: string
  pageId: string
  marketId: string | null
  runId: string | null
  builtAt: string
  domain: string
  keyLabels: ReadonlyMap<string, string>
  /** Directory of `check-reports`. Omit it and `runSummary` / `aioGap` stay null. */
  reportsRoot?: string | null
  /**
   * Normalized URL → page id of the working pages, from {@link trackedPageMap}.
   * A caller that loads many pages passes one map so each load does not list every page.
   */
  trackedPages?: ReadonlyMap<string, string>
}

/** `results:get`. Every run, capture, and reference is read through storage. */
export function loadPageResults(db: SqliteDatabase, input: ResultsLoad): PageResults {
  const page = requirePage(db, input.projectId, input.pageId)
  const marketId = input.marketId ?? page.defaultMarketId
  if (marketId === null) throw new CheckInputError('Unknown page')
  const profile = readProjectProfile(db)
  const runs = listStoredCheckRuns(db, filterFor(input.projectId, page.id, marketId)).filter(
    (run) => run.pageId === page.id && run.marketId === marketId
  )
  const current = selectRun(db, input, runs, marketId)
  const scope = buildScope(
    db,
    input,
    // A topic has no URL; its scope line names the topic title instead.
    page.url ?? '',
    page.title,
    marketId,
    current,
    profile?.brandNames ?? []
  )
  if (current === null) return emptyPageResults(scope)
  const sameSet = runs.filter(
    (run) =>
      isFullRun(run) &&
      run.promptSetId === current.promptSetId &&
      run.startedAt <= current.startedAt
  )
  const previousRun = sameSet.filter((run) => run.id !== current.id).at(-1) ?? null
  const baselineRun = [...sameSet].reverse().find((run) => run.kind === 'baseline') ?? null
  const previousRows = rowsOf(db, input.projectId, previousRun)
  const change = contentDelta(db, previousRun, current)
  const prompts = attachCoverage(
    db,
    page.id,
    current.contentHash,
    scorePrompts(db, input.projectId, current)
  )
  const gapReasons = new Map(prompts.map((prompt) => [prompt.promptId, prompt.mainGap ?? '']))
  const built = buildPageResults({
    scope: {
      ...scope,
      checkedAt: current.finishedAt,
      stale: isStale(current.finishedAt, input.builtAt)
    },
    identity: identityOf(db, current),
    prompts,
    previousRows,
    contentChanged: change.changed,
    contentChange: change.change,
    baseline:
      baselineRun === null
        ? null
        : baselineRun.id === current.id
          ? null
          : metricsOf(db, input.projectId, baselineRun),
    previous: previousRun === null ? null : metricsOf(db, input.projectId, previousRun),
    ownDomain: input.domain,
    includeSubdomains: profile?.includeSubdomains ?? false,
    gapReasons,
    trackedPages: input.trackedPages ?? trackedPages(db, input.projectId)
  })
  return withStoredSummary(applyBaseline(built, baselineRun, current), input, current.id)
}

/** `results:history`. Newest last. Partial checks stay flagged. */
export function loadResultsHistory(
  db: SqliteDatabase,
  input: Omit<ResultsLoad, 'runId' | 'keyLabels'>
): ResultsHistory {
  const page = requirePage(db, input.projectId, input.pageId)
  const marketId = input.marketId ?? page.defaultMarketId
  if (marketId === null) throw new CheckInputError('Unknown page')
  const runs = listStoredCheckRuns(db, filterFor(input.projectId, page.id, marketId)).filter(
    (run) => run.status === 'finished'
  )
  const points = runs.map((run) =>
    trendPoint(metricsOf(db, input.projectId, run), enabledCount(db, run))
  )
  return {
    pageId: page.id,
    marketId,
    promptSetVersion: points.at(-1)?.promptSetVersion ?? null,
    points
  }
}

/** `checks:getPrompt`. */
export function loadPromptDetail(
  db: SqliteDatabase,
  input: ResultsLoad & { promptId: string }
): PromptCheckDetail {
  const page = requirePage(db, input.projectId, input.pageId)
  const marketId = input.marketId ?? page.defaultMarketId
  if (marketId === null) throw new CheckInputError('Unknown page')
  const results = loadPageResults(db, { ...input, marketId })
  const runId = results.run?.runId ?? null
  const captures =
    runId === null
      ? []
      : listStoredSerpResults(
          db,
          filterFor(input.projectId, page.id, marketId, runId, input.promptId)
        )
  const references =
    runId === null
      ? []
      : listStoredAioReferences(
          db,
          filterFor(input.projectId, page.id, marketId, runId, input.promptId)
        )
  const samples = captures.map((capture) => toSample(capture, references, input.keyLabels))
  const coverage = getLatestCoverage(db, page.id, results.run?.contentHash ?? null)
  const covered = coverage?.rows.find((row) => row.promptId === input.promptId)
  const others = otherMarkets(db, input, page.id, marketId)
  const lens = overviewLens(db, page.id, input.domain)
  const rules = rulesOfKind(page.kind === 'topic' ? 'question' : 'buyer_prompt', lens.brandNames)
  return {
    pageId: page.id,
    marketId,
    runId,
    row: results.prompts.find((prompt) => prompt.promptId === input.promptId) ?? null,
    samples,
    searchesUsed: samples.reduce((sum, sample) => sum + sample.searches, 0),
    otherMarkets: others,
    aioGap:
      input.reportsRoot === undefined || input.reportsRoot === null || runId === null
        ? null
        : readStoredAioGap(input.reportsRoot, input.projectId, runId, input.promptId),
    whereCovered: covered === undefined ? [] : [...covered.whereCovered],
    lens,
    overviewReads: listOverviewReads(
      db,
      samples.map((sample) => sample.id)
    ),
    google: promptGoogleSearch(db, {
      sampleIds: samples.map((sample) => sample.id),
      otherSampleIds: promptSampleIds(
        db,
        others.flatMap((other) => (other.runId === null ? [] : [other.runId])),
        input.promptId
      ),
      pageUrl: page.url,
      site: lens,
      trackable: (text) => textProblem(text, rules) === null
    })
  }
}

export function filterFor(
  projectId: string,
  pageId: string | null,
  marketId: string | null,
  runId: string | null = null,
  promptId: string | null = null,
  from: string | null = null,
  to: string | null = null
): CheckReadFilter {
  return {
    projectId,
    pageIds: pageId === null ? null : [pageId],
    marketId,
    from,
    to,
    runId,
    promptId
  }
}

/**
 * Section 7.4. A finished run that searched every prompt. A targeted follow-up
 * (`partial`) stays readable by its run id but never becomes the headline, the
 * previous check, or the baseline.
 */
export function isFullRun(run: StoredCheckRun): boolean {
  return run.status === 'finished' && !run.partial
}

/**
 * The prompt rows of one stored run, scored exactly as Results scores them
 * (status, named, references of the winning sample), without the page-level
 * extras. For readers that walk many runs, such as the AI visibility home.
 */
export function runPromptRows(
  db: SqliteDatabase,
  projectId: string,
  run: StoredCheckRun
): PromptCheckRow[] {
  return runBuiltPrompts(db, projectId, run).map((item) => item.row)
}

/** A follow-up that never ran is not a finished sample and must not score as no AIO. */
function completeSample(sample: StoredSerpResult): boolean {
  if (sample.errorCode !== null) return true
  if (sample.neededFollowup && sample.rawAioJson === null) return false
  return true
}

function applyBaseline(
  built: PageResults,
  baselineRun: StoredCheckRun | null,
  current: StoredCheckRun
): PageResults {
  if (baselineRun?.id !== current.id || built.run === null) return built
  const score = built.run.visibilityScore
  const previousColumn = built.comparison[1]
  const currentColumn = built.comparison[2]
  if (previousColumn === undefined || currentColumn === undefined) return built
  return {
    ...built,
    scoreChange: { ...built.scoreChange, sinceBaseline: score === null ? null : 0 },
    comparison: [comparisonColumn('baseline', built.run), previousColumn, currentColumn]
  }
}

function withStoredSummary(built: PageResults, input: ResultsLoad, runId: string): PageResults {
  if (input.reportsRoot === undefined || input.reportsRoot === null) return built
  const summary = readStoredRunSummary(input.reportsRoot, input.projectId, runId)
  if (summary === null) return built
  return { ...built, runSummary: summary }
}

function selectRun(
  db: SqliteDatabase,
  input: ResultsLoad,
  runs: readonly StoredCheckRun[],
  marketId: string
): StoredCheckRun | null {
  if (input.runId === null) return runs.filter(isFullRun).at(-1) ?? null
  const found =
    runs.find((run) => run.id === input.runId) ??
    listStoredCheckRuns(db, filterFor(input.projectId, null, null, input.runId)).find(
      (run) => run.id === input.runId
    )
  if (found === undefined || found.pageId !== input.pageId) throw new CheckInputError('Unknown run')
  if (found.marketId !== marketId && input.marketId !== null)
    throw new CheckInputError('Unknown run')
  return found
}

/**
 * The prompts of one stored run with the sample whose status won, as Results scores
 * them (section 7.1). Project-wide readers (Competitors) aggregate these, so a cited
 * domain counts the same references the page's Citations screen lists.
 */
export function runBuiltPrompts(
  db: SqliteDatabase,
  projectId: string,
  run: StoredCheckRun
): BuiltPrompt[] {
  return buildPromptRows(scorePrompts(db, projectId, run), new Map())
}

function scorePrompts(db: SqliteDatabase, projectId: string, run: StoredCheckRun): ScorePrompt[] {
  const facts = listStoredMarketPrompts(db, run.promptSetId, run.marketId)
  const samples = listStoredSerpResults(db, filterFor(projectId, run.pageId, run.marketId, run.id))
  const references = listStoredAioReferences(
    db,
    filterFor(projectId, run.pageId, run.marketId, run.id)
  )
  const grouped = new Map<string, StoredSerpResult[]>()
  for (const sample of samples) {
    const list = grouped.get(sample.promptId) ?? []
    list.push(sample)
    grouped.set(sample.promptId, list)
  }
  const prompts: ScorePrompt[] = []
  for (const fact of facts) {
    const group = grouped.get(fact.id) ?? []
    const usable = run.status === 'finished' ? group : group.filter(completeSample)
    if (usable.length === 0) continue
    if (run.status !== 'finished' && usable.length < run.samples) continue
    prompts.push({
      promptId: fact.id,
      promptPosition: fact.position,
      label: fact.label,
      text: fact.text,
      source: fact.source,
      intentStage: fact.intentStage,
      samples: usable.map((sample) => toScoreSample(sample, references)),
      coverage: null,
      action: null,
      mainGap: null,
      checkedAt: run.finishedAt
    })
  }
  return prompts
}

function attachCoverage(
  db: SqliteDatabase,
  pageId: string,
  contentHash: string,
  prompts: ScorePrompt[]
): ScorePrompt[] {
  const coverage = getLatestCoverage(db, pageId, contentHash)
  if (coverage === null) return prompts
  return prompts.map((prompt) => {
    const row = coverage.rows.find((item) => item.promptId === prompt.promptId)
    if (row === undefined) return prompt
    return { ...prompt, coverage: row.coverage, action: row.whatToUpdate, mainGap: row.mainGap }
  })
}

function rowsOf(
  db: SqliteDatabase,
  projectId: string,
  run: StoredCheckRun | null
): Map<string, { status: ScorePrompt['samples'][number]['status']; position: number | null }> {
  const map = new Map<
    string,
    { status: ScorePrompt['samples'][number]['status']; position: number | null }
  >()
  if (run === null) return map
  for (const item of buildPromptRows(scorePrompts(db, projectId, run), new Map())) {
    map.set(item.row.promptId, { status: item.row.status, position: item.row.position })
  }
  return map
}

function metricsOf(db: SqliteDatabase, projectId: string, run: StoredCheckRun): MarketCheckMetrics {
  const previous = previousFinished(db, projectId, run)
  const change = contentDelta(db, previous, run)
  return metricsFor(
    identityOf(db, run),
    buildPromptRows(scorePrompts(db, projectId, run), rowsOf(db, projectId, previous)),
    change.changed,
    change.change
  )
}

function previousFinished(
  db: SqliteDatabase,
  projectId: string,
  run: StoredCheckRun
): StoredCheckRun | null {
  return (
    listStoredCheckRuns(db, filterFor(projectId, run.pageId, run.marketId))
      .filter(
        (item) =>
          isFullRun(item) && item.promptSetId === run.promptSetId && item.startedAt < run.startedAt
      )
      .at(-1) ?? null
  )
}

function identityOf(db: SqliteDatabase, run: StoredCheckRun): RunIdentity {
  const facts = readStoredPromptSet(db, run.promptSetId)
  return {
    runId: run.id,
    pageId: run.pageId,
    marketId: run.marketId,
    promptSetId: run.promptSetId,
    promptSetVersion: facts?.version ?? 0,
    snapshotId: run.snapshotId,
    contentHash: run.contentHash,
    kind: run.kind,
    partial: run.partial,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt
  }
}

function contentDelta(
  db: SqliteDatabase,
  previous: StoredCheckRun | null,
  current: StoredCheckRun
): { changed: boolean; change: ContentChange | null } {
  if (previous === null || previous.contentHash === current.contentHash) {
    return { changed: false, change: null }
  }
  const before = readStoredSnapshotFacts(db, previous.snapshotId)
  const after = readStoredSnapshotFacts(db, current.snapshotId)
  if (before === null || after === null) return { changed: true, change: null }
  return { changed: true, change: contentChangeBetween(before, after) }
}

function enabledCount(db: SqliteDatabase, run: StoredCheckRun): number {
  return listStoredMarketPrompts(db, run.promptSetId, run.marketId).filter(
    (prompt) => prompt.enabled
  ).length
}

function buildScope(
  db: SqliteDatabase,
  input: ResultsLoad,
  pageUrl: string,
  pageTitle: string | null,
  marketId: string,
  current: StoredCheckRun | null,
  brands: readonly string[]
): ResultsScope {
  const facts = current === null ? null : readStoredPromptSet(db, current.promptSetId)
  const latest = facts ?? null
  const saved = latest === null ? getLatestPromptSet(db, input.pageId, brands) : null
  const version = latest?.version ?? saved?.version ?? null
  const savedAt = latest?.savedAt ?? saved?.savedAt ?? null
  const promptCount =
    latest !== null
      ? listStoredMarketPrompts(db, latest.id, marketId).filter((prompt) => prompt.enabled).length
      : (saved?.prompts.filter((prompt) => prompt.enabled).length ?? 0)
  return {
    promptCount,
    marketCount: listPageMarkets(db, input.pageId).length,
    brands,
    pageUrl,
    pageTitle,
    checkedAt: null,
    builtAt: input.builtAt,
    promptSetVersion: version,
    promptSetSavedAt: savedAt,
    stale: false,
    nextFixNumber: nextFixNumber(db, input.pageId)
  }
}

function otherMarkets(
  db: SqliteDatabase,
  input: ResultsLoad & { promptId: string },
  pageId: string,
  marketId: string
): PromptMarketSnapshot[] {
  return listPageMarkets(db, pageId)
    .map((market) => market.marketId)
    .filter((id) => id !== marketId)
    .map((id) => {
      const latest =
        listStoredCheckRuns(db, filterFor(input.projectId, pageId, id))
          .filter(isFullRun)
          .at(-1) ?? null
      const text =
        latest === null
          ? ''
          : (listStoredMarketPrompts(db, latest.promptSetId, id).find(
              (prompt) => prompt.id === input.promptId
            )?.text ?? '')
      const row =
        latest === null
          ? null
          : buildPromptRows(scorePrompts(db, input.projectId, latest), new Map()).find(
              (item) => item.row.promptId === input.promptId
            )?.row
      return {
        marketId: id,
        text,
        status: row?.status ?? null,
        position: row?.position ?? null,
        runId: latest?.id ?? null
      }
    })
}

function trackedPages(db: SqliteDatabase, projectId: string): Map<string, string> {
  return trackedPageMap(listPages(db, projectId))
}

/** Normalized URL → page id for pages that are set up, tracked, or paused. */
export function trackedPageMap(list: readonly PageSummary[]): Map<string, string> {
  const pages = new Map<string, string>()
  for (const page of list) {
    if (page.status !== 'tracked' && page.status !== 'setting_up' && page.status !== 'paused')
      continue
    if (page.url === null) continue
    const normalized = normalizeUrl(page.url)
    if (normalized !== null) pages.set(normalized, page.id)
  }
  return pages
}

function toScoreSample(
  sample: StoredSerpResult,
  references: readonly StoredAioReference[]
): ScoreSample {
  return {
    sampleNo: sample.sampleNo,
    status: sample.status,
    named: sample.named,
    citedUrl: sample.citedUrl,
    position: sample.position,
    aioText: sample.aioText,
    references: references
      .filter((reference) => reference.serpResultId === sample.id)
      .map((reference) => toAio(reference))
  }
}

function toSample(
  sample: StoredSerpResult,
  references: readonly StoredAioReference[],
  keyLabels: ReadonlyMap<string, string>
): SampleCapture {
  return {
    id: sample.id,
    sampleNo: sample.sampleNo,
    keyId: sample.keyId,
    keyLabel: sample.keyId === null ? null : (keyLabels.get(sample.keyId) ?? null),
    hasAio: sample.hasAio,
    neededFollowup: sample.neededFollowup,
    searches: sample.searches,
    errorCode: sample.errorCode,
    message: sample.message,
    nextStep: sample.nextStep,
    aioText: sample.aioText,
    aioMarkdown: sample.aioMarkdown,
    references: references
      .filter((reference) => reference.serpResultId === sample.id)
      .map((reference) => toAio(reference)),
    rawSearchJson: sample.rawSearchJson,
    rawAioJson: sample.rawAioJson
  }
}

function toAio(reference: StoredAioReference): AioReference {
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

function requirePage(db: SqliteDatabase, projectId: string, pageId: string): PageSummary {
  const page = getPage(db, pageId, projectId)
  if (page === null) throw new CheckInputError('Unknown page')
  return page
}
