import { questionTargetPages } from '../topics/question-targets'
import type { ClaimTone, PageSummary, PromptCheckStatus } from '@shared/domain'
import type {
  QuestionChange,
  QuestionFacets,
  QuestionResult,
  QuestionRow,
  QuestionSource,
  QuestionsList
} from '@shared/ipc'
import { QUESTION_CHANGES, QUESTION_RESULTS } from '@shared/ipc'
import { isOwnHost } from '@shared/own-site'
import { sameTargetPage } from '@shared/target-page'
import { answerTone, toneCounts } from '@shared/sentiment-metrics'
import { askMarketLabel, askPageLabel } from '../ask/query'
import {
  checkCompetitors,
  storedCompetitor,
  type CompetitorLists
} from '../engine/checks/competitor-match'
import { rollupSamples, type ScoreSample } from '../engine/checks/score'
import type { StoredCheckRun } from '../storage/check-records'
import type { SqliteDatabase } from '../storage/database'
import { listPages } from '../storage/pages'
import { listMarkets, readProjectProfile } from '../storage/project-profile'
import type { ProjectRecord } from '../storage/records'
import { listSentimentClaims, type StoredSentimentClaim } from '../storage/sentiment-records'
import {
  chunks,
  readActivePrompts,
  readLineage,
  readPageMarkets,
  readReferences,
  type ActivePrompt,
  type LeanReference,
  type LeanSample,
  type LineageStep
} from './reads'
import { liveQuestions, questionRuns, readQuestionSamples, type QuestionRuns } from './live'

/** Pages and topics whose questions count as tracked. */
const LISTED = new Set<PageSummary['status']>(['tracked', 'setting_up', 'paused'])
const CITED = new Set<PromptCheckStatus>(['page_cited', 'other_own_page'])
const INSTEAD_LIMIT = 3
/** Versions walked back at most, so a damaged lineage chain cannot loop. */
const MAX_STEPS = 200

/** One question's check: the samples of one prompt id in one finished run. */
interface Found {
  run: StoredCheckRun
  promptId: string
  samples: readonly LeanSample[]
}

/**
 * `questions:list`. Every question of every tracked page and topic, with the latest
 * finished check in the market that searched it: a scheduled check, a first check or a
 * re-check of a few questions alike. A saved prompt-set version gives every prompt a new
 * id, so a question follows its lineage back while its wording in the market is the
 * same, into the page or topic it was moved from when it was moved. The status rolls up with the Results rule (`rollupSamples`), competitors are
 * named with `competitorContext()` through the check classification's matcher, and the
 * own site follows the "Own page" rule, so the numbers match prompt detail.
 */
export function loadQuestions(
  db: SqliteDatabase,
  project: ProjectRecord,
  requestedMarketId: string | null
): QuestionsList {
  const profile = readProjectProfile(db)
  const markets = listMarkets(db)
  const marketId =
    requestedMarketId !== null && markets.some((market) => market.id === requestedMarketId)
      ? requestedMarketId
      : (markets[0]?.id ?? null)
  const lens = {
    brandNames: [...(profile?.brandNames ?? [])],
    ownDomain: project.domain,
    includeSubdomains: profile?.includeSubdomains ?? false
  }
  const pages = listPages(db, project.id).filter((page) => LISTED.has(page.status))
  const pageMarkets = readPageMarkets(db)
  const prompts = readActivePrompts(db, marketId)
  const byPage = groupBy(prompts, (prompt) => prompt.pageId)
  const ordered = [
    ...pages.filter((page) => page.kind === 'topic'),
    ...pages.filter((page) => page.kind !== 'topic')
  ].filter((page) => (byPage.get(page.id)?.length ?? 0) > 0)
  const sources = ordered.map((page) => toSource(page, pageMarkets.get(page.id) ?? []))

  const lineage = readLineage(db, marketId)
  // Finished checks, and the questions a running or stopped check has scored so far.
  const read: QuestionRuns =
    marketId === null ? { runs: [], states: new Map() } : questionRuns(db, project.id, marketId)
  const runs = read.runs
  const samples = marketId === null ? [] : readQuestionSamples(db, marketId, read)
  const checking = liveQuestions(db, read)
  const byRunPrompt = groupBy(samples, (sample) => `${sample.runId}|${sample.promptId}`)
  const runsOf = runsByPrompt(runs, samples)

  const drafts: Array<{
    prompt: ActivePrompt
    source: QuestionSource
    inMarket: boolean
    current: Found | null
    previous: Found | null
  }> = []
  for (const source of sources) {
    const inMarket = marketId !== null && source.marketIds.includes(marketId)
    for (const prompt of byPage.get(source.id) ?? []) {
      const chain = lineageChain(prompt, lineage)
      const [current, previous] = inMarket ? latestTwo(runsOf, chain, byRunPrompt) : [null, null]
      drafts.push({ prompt, source, inMarket, current, previous })
    }
  }

  // The winning capture of each check: its references, and the current one's sentiment.
  const rolled = drafts.map((draft) => (draft.current ? rollup(draft.current.samples) : null))
  const before = drafts.map((draft) => (draft.previous ? rollup(draft.previous.samples) : null))
  const winningIds = [...rolled, ...before].flatMap((item) =>
    item?.winningId ? [item.winningId] : []
  )
  const references = groupBy(readReferences(db, winningIds), (ref) => ref.serpResultId)
  const refsOf = (item: Rolled): readonly LeanReference[] =>
    item.winningId === null ? [] : (references.get(item.winningId) ?? [])
  const runIds = [
    ...new Set(drafts.flatMap((draft) => (draft.current ? [draft.current.run.id] : [])))
  ]
  const claims = groupBy(
    chunks(runIds).flatMap((ids) => listSentimentClaims(db, ids)),
    (claim) => claim.captureId
  )
  const competitors = new Map<string, CompetitorLists>()
  const listsFor = (source: QuestionSource): CompetitorLists => {
    const found = competitors.get(source.id)
    if (found) return found
    const lists = checkCompetitors(db, { id: source.id, kind: source.kind })
    competitors.set(source.id, lists)
    return lists
  }

  // A topic question's target: its own sure pick, else the topic's page (the classify and
  // `topics:results` rule; a CiteFox AI pick under SURE_FIT is a hint only).
  const topicTargets = new Map<string, Map<string, readonly string[]>>()
  const targetOf = (source: QuestionSource, promptId: string): string | null => {
    let pages = topicTargets.get(source.id)
    if (pages === undefined) {
      pages = questionTargetPages(db, source.id)
      topicTargets.set(source.id, pages)
    }
    return pages.get(promptId)?.[0] ?? null
  }

  const rows = drafts.map((draft, index): QuestionRow => {
    const page = draft.source.kind !== 'topic'
    const topicTarget = page ? null : targetOf(draft.source, draft.prompt.id)
    const base = {
      promptId: draft.prompt.id,
      sourceId: draft.source.id,
      text: draft.prompt.text,
      enabled: draft.prompt.enabled,
      inMarket: draft.inMarket,
      stage: draft.prompt.stage,
      promptKind: draft.prompt.kind,
      // A page's question is answered by the page itself.
      targetPageId: page
        ? draft.source.id
        : topicTarget !== null &&
            (draft.prompt.targetUrl === null || sameTargetPage(topicTarget, draft.prompt.targetUrl))
          ? draft.prompt.targetPageId
          : null,
      targetUrl: page ? draft.source.url : topicTarget
    }
    const current = draft.current
    const now = rolled[index] ?? null
    const live = draft.inMarket ? checking.rowState(draft.prompt.id, current?.run.id ?? null) : null
    if (current === null || now === null) return { ...notChecked(base), live }
    const refs = refsOf(now)
    const outcome = outcomeOf(draft.source.kind, now, refs, base.targetUrl)
    const prior = before[index] ?? null
    const priorOutcome =
      prior === null || draft.previous === null
        ? null
        : outcomeOf(draft.source.kind, prior, refsOf(prior), base.targetUrl)
    return {
      ...base,
      ...outcome,
      citedInstead:
        outcome.overview === true ? insteadNames(refs, lens, () => listsFor(draft.source)) : [],
      sentiment: sentimentOf(current.samples, claims),
      change: changeOf(priorOutcome, outcome),
      checkedAt: current.run.finishedAt ?? current.run.startedAt,
      live,
      partialCheck: read.states.get(current.run.id) !== 'finished',
      runId: current.run.id,
      resultPromptId: current.promptId,
      resultPageId: current.run.pageId,
      previous:
        priorOutcome === null || draft.previous === null
          ? null
          : {
              overview: priorOutcome.overview,
              cited: priorOutcome.cited,
              status: priorOutcome.status,
              checkedAt: draft.previous.run.finishedAt,
              runId: draft.previous.run.id,
              promptId: draft.previous.promptId,
              pageId: draft.previous.run.pageId
            }
    }
  })

  return {
    projectId: project.id,
    marketId,
    markets: markets.map((market, index) => ({
      id: market.id,
      label: askMarketLabel(market),
      isDefault: index === 0
    })),
    sources,
    rows,
    facets: facetsOf(rows, sources),
    lens,
    hasSentiment: rows.some((row) => row.sentiment !== null),
    live: checking.live
  }
}

function toSource(page: PageSummary, marketIds: readonly string[]): QuestionSource {
  const topic = page.kind === 'topic'
  return {
    id: page.id,
    kind: topic ? 'topic' : 'page',
    name: topic ? page.title?.trim() || 'Topic' : askPageLabel(page),
    url: topic ? null : page.url,
    path: topic || page.url === null ? null : pathOf(page.url),
    samples: page.samples,
    marketIds: [...marketIds]
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || '/'
  } catch {
    return url
  }
}

/** The prompt, then the versions it was carried from while its wording stayed the same. */
function lineageChain(prompt: ActivePrompt, lineage: ReadonlyMap<string, LineageStep>): string[] {
  const chain = [prompt.id]
  const seen = new Set(chain)
  const wording = prompt.text.trim()
  let at = lineage.get(prompt.id)
  while (at !== undefined && chain.length < MAX_STEPS && !seen.has(at.previousId)) {
    if ((at.previousText ?? '').trim() !== wording) break
    chain.push(at.previousId)
    seen.add(at.previousId)
    at = lineage.get(at.previousId)
  }
  return chain
}

/** A finished run with its place in the newest-first order. */
interface RankedRun {
  run: StoredCheckRun
  rank: number
}

/**
 * Prompt id → the finished runs that searched it, newest first. A prompt id belongs
 * to one page, so these are that page's runs; after a move the lineage chain reaches
 * back into the page or topic the question came from, and its runs come with it.
 */
function runsByPrompt(
  runs: readonly StoredCheckRun[],
  samples: readonly LeanSample[]
): Map<string, RankedRun[]> {
  const ranked = new Map<string, RankedRun>()
  ;[...runs].reverse().forEach((run, rank) => ranked.set(run.id, { run, rank }))
  const out = new Map<string, RankedRun[]>()
  const seen = new Set<string>()
  for (const sample of samples) {
    const key = `${sample.runId}|${sample.promptId}`
    const run = ranked.get(sample.runId)
    if (run === undefined || seen.has(key)) continue
    seen.add(key)
    const list = out.get(sample.promptId)
    if (list) list.push(run)
    else out.set(sample.promptId, [run])
  }
  for (const list of out.values()) list.sort((a, b) => a.rank - b.rank)
  return out
}

/** The newest and the one-before finished checks that searched the question (any version). */
function latestTwo(
  runsOf: ReadonlyMap<string, readonly RankedRun[]>,
  chain: readonly string[],
  byRunPrompt: ReadonlyMap<string, readonly LeanSample[]>
): [Found | null, Found | null] {
  const candidates: { ranked: RankedRun; promptId: string }[] = []
  const runIds = new Set<string>()
  for (const promptId of chain) {
    for (const ranked of runsOf.get(promptId) ?? []) {
      if (runIds.has(ranked.run.id)) continue
      runIds.add(ranked.run.id)
      candidates.push({ ranked, promptId })
    }
  }
  candidates.sort((a, b) => a.ranked.rank - b.ranked.rank)
  const found: Found[] = []
  for (const { ranked, promptId } of candidates) {
    const samples = byRunPrompt.get(`${ranked.run.id}|${promptId}`)
    if (samples === undefined || samples.length === 0) continue
    found.push({ run: ranked.run, promptId, samples })
    if (found.length === 2) break
  }
  return [found[0] ?? null, found[1] ?? null]
}

interface Rolled {
  status: PromptCheckStatus
  position: number | null
  named: boolean | null
  winningId: string | null
}

type Outcome = Pick<
  QuestionRow,
  'result' | 'status' | 'overview' | 'cited' | 'position' | 'named' | 'citedOwnUrl'
>

/** Section 7.1 rollup of one question's samples in one check, with the winning capture's id. */
function rollup(samples: readonly LeanSample[]): Rolled {
  const ids = new Map<ScoreSample, string>()
  const scored = samples.map((sample) => {
    const item: ScoreSample = {
      sampleNo: sample.sampleNo,
      status: sample.status,
      named: sample.named,
      citedUrl: sample.citedUrl,
      position: sample.position,
      aioText: null,
      references: []
    }
    ids.set(item, sample.id)
    return item
  })
  const result = rollupSamples(scored)
  return {
    status: result.status,
    position: result.position,
    named: result.named,
    winningId: result.winning === null ? null : (ids.get(result.winning) ?? null)
  }
}

/**
 * What one check showed. A page reads its rolled-up status, as Results and prompt
 * detail do. A topic has no URL of its own, so it reads the own-site references of the
 * winning capture, as `topics:results` does (`citedOwn`): cited at its best position.
 * Its status says which own page, as the topic's row state does: `page_cited` when the
 * question's target page is cited, `other_own_page` for another own page.
 */
function outcomeOf(
  kind: QuestionSource['kind'],
  rolled: Rolled,
  references: readonly LeanReference[],
  targetUrl: string | null = null
): Outcome {
  const status =
    kind === 'topic' ? topicStatus(rolled.status, references, targetUrl) : rolled.status
  if (status === 'error') {
    return {
      result: 'error',
      status,
      overview: null,
      cited: null,
      position: null,
      named: null,
      citedOwnUrl: null
    }
  }
  if (status === 'no_aio') {
    return {
      result: 'no_overview',
      status,
      overview: false,
      cited: null,
      position: null,
      named: null,
      citedOwnUrl: null
    }
  }
  const ownRefs = references.filter(
    (ref) => ref.classification === 'target' || ref.classification === 'own'
  )
  const own = ownRefs.map((ref) => ref.position)
  const cited = kind === 'topic' ? own.length > 0 : CITED.has(status)
  const position = !cited ? null : kind === 'topic' ? Math.min(...own) : rolled.position
  const result: QuestionResult = cited
    ? 'cited'
    : status === 'brand_mentioned' || rolled.named === true
      ? 'named'
      : 'not_cited'
  return {
    result,
    status,
    overview: true,
    cited,
    position,
    named: rolled.named,
    citedOwnUrl: cited ? citedOwnUrlOf(ownRefs, status, targetUrl) : null
  }
}

/**
 * The own page a cited overview cites, by the topic rule (`citedOwn`): the target page
 * when one of its links is, else the best placed own link. A page's question cited with
 * no own link stored reads as its own page (`page_cited`).
 */
function citedOwnUrlOf(
  own: readonly LeanReference[],
  status: PromptCheckStatus,
  targetUrl: string | null
): string | null {
  const ordered = [...own].sort((a, b) => a.position - b.position)
  const pick =
    ordered.find((ref) => ref.classification === 'target') ??
    ordered.find((ref) => sameTargetPage(ref.url, targetUrl)) ??
    ordered[0]
  if (pick !== undefined) return pick.url
  return status === 'page_cited' ? targetUrl : null
}

/** A topic question's status from its own-site references (see `deriveRowState`). */
function topicStatus(
  status: PromptCheckStatus,
  references: readonly LeanReference[],
  targetUrl: string | null
): PromptCheckStatus {
  if (status === 'error' || status === 'no_aio') return status
  const own = references.filter(
    (ref) => ref.classification === 'target' || ref.classification === 'own'
  )
  // The check (and the re-judge after pages change) marks the question's own pages
  // (Primary + Also OK) `target`; with no target page yet any own page counts, which the
  // stored `page_cited` says. The same rule as classify and `topics:results`.
  if (own.some((ref) => ref.classification === 'target' || sameTargetPage(ref.url, targetUrl))) {
    return 'page_cited'
  }
  if (own.length > 0) return status === 'page_cited' ? 'page_cited' : 'other_own_page'
  return CITED.has(status) ? 'not_cited' : status
}

/** A citation change wins over an overview change; a failed capture compares as nothing. */
export function changeOf(
  previous: Pick<Outcome, 'overview' | 'cited'> | null,
  current: Pick<Outcome, 'overview' | 'cited'>
): QuestionChange {
  if (previous === null || previous.overview === null || current.overview === null) return 'none'
  const was = previous.cited === true
  const is = current.cited === true
  if (is && !was) return 'gained'
  if (was && !is) return 'lost'
  if (!previous.overview && current.overview) return 'new_overview'
  if (previous.overview && !current.overview) return 'gone'
  return 'none'
}

/** Sources cited instead of the own site: a competitor's name, else the bare domain. */
function insteadNames(
  references: readonly LeanReference[],
  lens: { ownDomain: string; includeSubdomains: boolean },
  lists: () => CompetitorLists
): string[] {
  const out: string[] = []
  for (const ref of references) {
    const own =
      ref.classification === 'target' ||
      ref.classification === 'own' ||
      isOwnHost(ref.domain.replace(/^www\./, ''), lens.ownDomain, lens.includeSubdomains)
    if (own) continue
    const name =
      storedCompetitor(ref, lists())?.name ?? ref.domain.replace(/^www\./, '').toLowerCase()
    if (!out.includes(name)) out.push(name)
    if (out.length >= INSTEAD_LIMIT) break
  }
  return out
}

/** The tone of the brand claims read from this question's captures in the check. */
function sentimentOf(
  samples: readonly LeanSample[],
  claims: ReadonlyMap<string, readonly StoredSentimentClaim[]>
): ClaimTone | null {
  const own = samples
    .flatMap((sample) => claims.get(sample.id) ?? [])
    .filter((claim) => claim.source === 'buyer' && claim.isOwn)
  return own.length === 0 ? null : answerTone(toneCounts(own))
}

function notChecked(
  base: Pick<
    QuestionRow,
    | 'promptId'
    | 'sourceId'
    | 'text'
    | 'enabled'
    | 'inMarket'
    | 'stage'
    | 'promptKind'
    | 'targetPageId'
    | 'targetUrl'
  >
): QuestionRow {
  return {
    ...base,
    result: 'not_checked',
    status: null,
    overview: null,
    cited: null,
    position: null,
    named: null,
    citedOwnUrl: null,
    citedInstead: [],
    sentiment: null,
    change: 'none',
    checkedAt: null,
    runId: null,
    resultPromptId: null,
    resultPageId: null,
    previous: null
  }
}

function facetsOf(
  rows: readonly QuestionRow[],
  sources: readonly QuestionSource[]
): QuestionFacets {
  const kindOf = new Map(sources.map((source) => [source.id, source.kind]))
  const kind = { page: 0, topic: 0 }
  const source: Record<string, number> = {}
  const result = Object.fromEntries(QUESTION_RESULTS.map((key) => [key, 0])) as Record<
    QuestionResult,
    number
  >
  const change = Object.fromEntries(QUESTION_CHANGES.map((key) => [key, 0])) as Record<
    QuestionChange,
    number
  >
  for (const row of rows) {
    kind[kindOf.get(row.sourceId) ?? 'page'] += 1
    source[row.sourceId] = (source[row.sourceId] ?? 0) + 1
    result[row.result] += 1
    change[row.change] += 1
  }
  return { kind, source, result, change }
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const item of items) {
    const at = key(item)
    const list = out.get(at)
    if (list) list.push(item)
    else out.set(at, [item])
  }
  return out
}
