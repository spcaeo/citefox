import type {
  MatchTrackedTopicRequest,
  MatchTrackedTopicResult,
  TopicPageCandidate
} from '@shared/ipc'
import { normalizeUrl } from '../engine/checks/url'
import { runTopicTemplate } from './claude'
import { TopicInputError } from './drafts'
import { brandVars, type OpenedProject, type TopicEnv } from './env'
import { candidateOpenings } from './page-context'
import { readProjectProfile } from '../storage/project-profile'
import { activePromptSetId, loadTopicResults } from './results'
import { listTopicPrompts, setTopicPromptTarget } from './records'
import {
  candidatesText,
  MATCH_BATCH,
  MATCH_MIN_CONFIDENCE,
  matchProblem,
  MAX_MATCH_CANDIDATES,
  pageCandidates,
  rankCandidates
} from './steps-pages'

/**
 * `topics:matchTracked`: CiteFox AI picks each tracked question's best page on the
 * site, with a fit %, from the page list and the page Google already cites for it
 * (template `topic_page_match`). A page you picked is kept. The fit decides the
 * result: Google citing the best page is "Right page"; a weak fit (under
 * {@link SURE_FIT}) is never used to call a cited page "other" (topicPromptMetas).
 * Spends no search.
 */

export { SURE_FIT } from '@shared/topic-scoring'

type MatchReply = {
  matches: { id: string; url: string | null; confidence: number; reason: string }[]
}

export async function matchTrackedTopic(
  env: TopicEnv,
  opened: OpenedProject,
  input: MatchTrackedTopicRequest
): Promise<MatchTrackedTopicResult> {
  const { db, project } = opened
  const setId = activePromptSetId(db, input.topicId)
  if (setId === null) throw new TopicInputError('This topic has no questions yet.')
  const records = listTopicPrompts(db, setId)
  const results = loadTopicResults(db, {
    projectId: project.id,
    topicId: input.topicId,
    marketId: input.marketId ?? null,
    runId: null,
    domain: project.domain,
    builtAt: env.host.now().toISOString()
  })
  const cited = new Map(results.rows.map((row) => [row.promptId, row.citedOwnUrl]))
  const texts = new Map(results.rows.map((row) => [row.promptId, row.text]))
  // Your picks stay; everything else is (re)matched.
  const targets = records.filter(
    (record) =>
      texts.has(record.promptId) && !(record.matchSetBy === 'user' || record.matchConfirmed)
  )
  if (targets.length === 0) return { matched: 0, noPage: 0, kept: records.length }

  const all: TopicPageCandidate[] = [...pageCandidates(db, project.id).candidates]
  // A page Google cites is always a candidate, even when the page list lacks it.
  const known = new Set(all.map((item) => normalizeUrl(item.url) ?? item.url))
  const citedUrls = new Set<string>()
  for (const url of cited.values()) {
    if (url === null) continue
    citedUrls.add(url)
    const key = normalizeUrl(url) ?? url
    if (known.has(key)) continue
    known.add(key)
    all.unshift({ url, title: null, pageId: null, source: 'sitemap', outline: [] })
  }
  // Pages Google cites first, then the ones closest to these questions, before the cut.
  const candidates = rankCandidates(
    all,
    targets.map((record) => texts.get(record.promptId) ?? ''),
    citedUrls
  )
  const byUrl = new Map(candidates.map((item) => [normalizeUrl(item.url) ?? item.url, item]))
  const listed = new Set(
    candidates.slice(0, MAX_MATCH_CANDIDATES).map((item) => normalizeUrl(item.url) ?? item.url)
  )
  const pages = candidatesText(candidates, candidateOpenings(db, candidates))
  const brands = readProjectProfile(db)?.brandNames ?? []

  let matched = 0
  let noPage = 0
  for (let start = 0; start < targets.length; start += MATCH_BATCH) {
    const batch = targets.slice(start, start + MATCH_BATCH)
    const ids = batch.map((_, index) => `P${index + 1}`)
    const reply = await runTopicTemplate<MatchReply>({
      host: env.host,
      db,
      projectId: project.id,
      pageId: input.topicId,
      kind: 'topic_page_match',
      channel: 'topics:matchTracked',
      context: {
        website: project.domain,
        pages,
        questions: batch
          .map((record, index) => {
            const now = cited.get(record.promptId)
            const hint = now ? ` · Google now cites your page ${now}` : ''
            return `${ids[index]} · ${texts.get(record.promptId) ?? ''}${hint}`
          })
          .join('\n'),
        ...brandVars(brands)
      },
      check: (value) => matchProblem(value, ids, listed)
    })
    for (const match of reply.value.matches) {
      const record = batch[ids.indexOf(match.id)]
      if (record === undefined) continue
      const candidate =
        match.url === null || match.confidence < MATCH_MIN_CONFIDENCE
          ? undefined
          : byUrl.get(normalizeUrl(match.url) ?? match.url)
      if (candidate === undefined) {
        noPage += 1
        setTopicPromptTarget(db, record.promptId, {
          pageId: null,
          url: null,
          confidence: null,
          reason: match.reason,
          setBy: 'claude',
          confirmed: false
        })
        continue
      }
      matched += 1
      setTopicPromptTarget(db, record.promptId, {
        pageId: candidate.pageId,
        url: candidate.url,
        confidence: Math.max(0, Math.min(100, Math.round(match.confidence))),
        reason: match.reason,
        setBy: 'claude',
        confirmed: false
      })
    }
  }
  return { matched, noPage, kept: records.length - targets.length }
}
