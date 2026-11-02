import type {
  AioReference,
  CommunityAio,
  Market,
  PageSummary,
  PromptCheckStatus
} from '@shared/domain'
import { isOwnHost } from '../engine/checks/classify'
import { isFullRun } from '../engine/checks/results'
import { rollupSamples, type ScoreSample } from '../engine/checks/score'
import {
  listStoredAioReferences,
  listStoredCheckRuns,
  listStoredMarketPrompts,
  listStoredSerpResults,
  type StoredAioReference,
  type StoredCheckRun,
  type StoredSerpResult
} from '../storage/check-records'
import type { SqliteDatabase } from '../storage/database'
import { listPages } from '../storage/pages'
import { listMarkets, readProjectProfile } from '../storage/project-profile'

/** Section 7.1. Statuses that mean an AI Overview was shown. */
const AIO_STATUSES = new Set<PromptCheckStatus>([
  'page_cited',
  'other_own_page',
  'brand_mentioned',
  'not_cited'
])

/** FR-17.2 compares the newest three checks. */
export const CHECK_DEPTH = 3

export interface EvidenceQuery {
  projectId: string
  /** Null is every page that is not removed. */
  pageId: string | null
  /** Null is every market. */
  marketId: string | null
  /** Full checks kept per page and market, newest first. */
  depth: number
}

/** One prompt in one market in one check, with the winning sample's references (section 7.1). */
export interface EvidenceAnswer {
  aio: CommunityAio
  hasAio: boolean
  /** Distinct by normalized URL, in source order. Empty without an overview. */
  references: readonly AioReference[]
  /** The overview links any own-domain page (FR-6.5). */
  ownCited: boolean
  /** 0 is the newest full check of that page and market. */
  checkIndex: number
}

export interface EvidenceProfile {
  domain: string
  brandNames: readonly string[]
  competitors: readonly string[]
  includeSubdomains: boolean
}

export interface Evidence {
  profile: EvidenceProfile
  /** Every market in the project. */
  markets: readonly Market[]
  pages: ReadonlyMap<string, PageSummary>
  answers: readonly EvidenceAnswer[]
}

/**
 * The stored answers behind Communities and YouTube. Reads only what checks
 * already saved: no search, no fetch (FR-17.1). Partial and cancelled runs are
 * left out, so these counts match Results (section 7.4).
 */
export function loadEvidence(db: SqliteDatabase, domain: string, query: EvidenceQuery): Evidence {
  const profile = readProjectProfile(db)
  const evidenceProfile: EvidenceProfile = {
    domain,
    brandNames: profile?.brandNames ?? [],
    competitors: profile?.competitors ?? [],
    includeSubdomains: profile?.includeSubdomains ?? false
  }
  const pages = new Map(
    listPages(db, query.projectId)
      .filter((page) => page.status !== 'removed')
      .filter((page) => query.pageId === null || page.id === query.pageId)
      .map((page) => [page.id, page] as const)
  )
  const runs = listStoredCheckRuns(db, {
    projectId: query.projectId,
    pageIds: query.pageId === null ? null : [query.pageId],
    marketId: query.marketId,
    from: null,
    to: null,
    runId: null,
    promptId: null
  }).filter((run) => isFullRun(run) && run.finishedAt !== null && pages.has(run.pageId))
  const answers: EvidenceAnswer[] = []
  for (const [run, checkIndex] of newestRuns(runs, query.depth)) {
    const page = pages.get(run.pageId)
    if (page === undefined) continue
    answers.push(...answersOf(db, query.projectId, run, checkIndex, page, evidenceProfile))
  }
  return { profile: evidenceProfile, markets: listMarkets(db), pages, answers }
}

/** The newest `depth` full runs per page and market, each with its 0-based age. */
function newestRuns(
  runs: readonly StoredCheckRun[],
  depth: number
): Array<[StoredCheckRun, number]> {
  const grouped = new Map<string, StoredCheckRun[]>()
  for (const run of runs) {
    const key = `${run.pageId}\n${run.marketId}`
    const list = grouped.get(key) ?? []
    list.push(run)
    grouped.set(key, list)
  }
  const picked: Array<[StoredCheckRun, number]> = []
  for (const list of grouped.values()) {
    const newest = [...list].sort(byFinishedDesc).slice(0, depth)
    newest.forEach((run, index) => picked.push([run, index]))
  }
  return picked
}

function byFinishedDesc(left: StoredCheckRun, right: StoredCheckRun): number {
  const a = left.finishedAt ?? ''
  const b = right.finishedAt ?? ''
  if (a !== b) return a < b ? 1 : -1
  return left.startedAt < right.startedAt ? 1 : -1
}

function answersOf(
  db: SqliteDatabase,
  projectId: string,
  run: StoredCheckRun,
  checkIndex: number,
  page: PageSummary,
  profile: EvidenceProfile
): EvidenceAnswer[] {
  const filter = {
    projectId,
    pageIds: [run.pageId],
    marketId: run.marketId,
    from: null,
    to: null,
    runId: run.id,
    promptId: null
  }
  const prompts = listStoredMarketPrompts(db, run.promptSetId, run.marketId)
  const samples = listStoredSerpResults(db, filter)
  const references = listStoredAioReferences(db, filter)
  const byPrompt = new Map<string, StoredSerpResult[]>()
  for (const sample of samples) {
    const list = byPrompt.get(sample.promptId) ?? []
    list.push(sample)
    byPrompt.set(sample.promptId, list)
  }
  const pageLabel = labelOf(page)
  const answers: EvidenceAnswer[] = []
  for (const prompt of prompts) {
    const group = byPrompt.get(prompt.id)
    if (group === undefined || group.length === 0) continue
    const rolled = rollupSamples(group.map((sample) => scoreSample(sample, references)))
    const hasAio = AIO_STATUSES.has(rolled.status)
    const refs = hasAio ? distinct(rolled.winning?.references ?? []) : []
    answers.push({
      aio: {
        key: `${run.id}|${prompt.id}`,
        runId: run.id,
        pageId: page.id,
        pageLabel,
        marketId: run.marketId,
        promptId: prompt.id,
        promptPosition: prompt.position,
        label: prompt.label,
        text: prompt.text,
        status: rolled.status,
        named: rolled.named,
        checkedAt: run.finishedAt ?? run.startedAt,
        latest: checkIndex === 0
      },
      hasAio,
      references: refs,
      ownCited: refs.some(
        (reference) =>
          reference.classification === 'target' ||
          reference.classification === 'own' ||
          isOwnHost(reference.domain, profile.domain, profile.includeSubdomains)
      ),
      checkIndex
    })
  }
  return answers
}

function scoreSample(
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
      .map((reference) => ({
        id: reference.id,
        position: reference.position,
        url: reference.url,
        normalizedUrl: reference.normalizedUrl,
        domain: reference.domain,
        title: reference.title,
        classification: reference.classification,
        untracked: reference.untracked,
        sourceType: reference.sourceType
      }))
  }
}

/** One link per URL per answer, so a video cited at two timestamps counts once. */
function distinct(references: readonly AioReference[]): AioReference[] {
  const seen = new Set<string>()
  const kept: AioReference[] = []
  for (const reference of [...references].sort((a, b) => a.position - b.position)) {
    if (seen.has(reference.normalizedUrl)) continue
    seen.add(reference.normalizedUrl)
    kept.push(reference)
  }
  return kept
}

/** Label, else title, else the URL path. */
export function labelOf(page: Pick<PageSummary, 'label' | 'title' | 'url'>): string {
  if (page.label !== null && page.label.trim().length > 0) return page.label
  if (page.title !== null && page.title.trim().length > 0) return page.title
  if (page.url === null) return 'Topic'
  try {
    return new URL(page.url).pathname
  } catch {
    return page.url
  }
}
