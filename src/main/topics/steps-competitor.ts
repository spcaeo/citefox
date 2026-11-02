import type { CompetitorClaim, TopicDraft, TopicStage } from '@shared/domain'
import type { CompetitorQuestionsResult, ReadCompetitorPageResult } from '@shared/ipc'
import { competitorContext } from '../engine/competitor-context'
import { evidenceBlock, stageRules } from '../prompts/blocks'
import { bullets, runTopicTemplate } from './claude'
import {
  cleanHeading,
  cleanHeadings,
  cleanPageText,
  competitorName,
  fenceSafe,
  snapSection
} from './competitor-page'
import { newDraftPrompt, saveDraft, TopicInputError } from './drafts'
import { brandVars, type OpenedProject, type TopicEnv } from './env'
import { nameKeys, namesAny, topicOptions } from './keyword-rules'
import { ownEvidencePages } from './own-evidence'
import { cachedSiteReads, competitorRead, readOne, readSite } from './site'
import { marketBlockFor, topicBuyerBlock, topicScope } from './step-blocks'
import { namesBrand } from './text'

/**
 * The competitor's page path of the Add wizard (Docs/TOPICS-SPEC.md section 3;
 * Docs/PROMPT-AUDIT.md, package P4): read their page once, then two calls in
 * parallel, the questions their page is built to win for this topic's buyer
 * (`competitor_page_questions_v2`) and the claims it makes that the business's own
 * pages do not (`competitor_page_claims`).
 */

/** Questions asked of their page. */
export const COMPETITOR_QUESTION_COUNT = 24
/** Characters of their page text sent, after links and images are removed. */
const PAGE_TEXT_CHARS = 12000
/** Characters of each own page the claims step sees: enough to find a claim made once. */
const CLAIM_EVIDENCE_CHARS = 5000

const TAG = 'competitor_page'

export async function readCompetitorPage(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft,
  url: string
): Promise<ReadCompetitorPageResult> {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    throw new TopicInputError(
      'That is not a page address.',
      'Paste the full address, starting with https://.'
    )
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
    throw new TopicInputError('That is not a page address.')
  const read = await readOne(env.host, opened.db, parsed.toString(), 'competitor', true)
  const page = competitorRead(read)
  const next = saveDraft(
    opened.db,
    { ...draft, competitorUrl: page.url, competitorPage: page, step: 'competitor' },
    env.host.now()
  )
  return { draft: next, page }
}

interface QuestionReply {
  questions: { stage: TopicStage; text: string; section: string }[]
}

interface ClaimReply {
  claims: {
    claim: string
    section: string | null
    onYourSite: CompetitorClaim['onYourSite']
    yourEvidence: string | null
  }[]
}

const CLAIM_ORDER: Readonly<Record<CompetitorClaim['onYourSite'], number>> = {
  no: 0,
  partly: 1,
  yes: 2
}

export async function competitorQuestions(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft,
  marketId: string | null
): Promise<CompetitorQuestionsResult> {
  const page = draft.competitorPage
  if (page === null || !page.ok || draft.competitorUrl === null) {
    throw new TopicInputError('Read their page first.')
  }
  const read = await readOne(env.host, opened.db, page.url, 'competitor', false)
  const cached = cachedSiteReads(opened.db)
  const ownReads =
    cached.length > 0
      ? cached
      : await readSite(env.host, opened.db, draft.website || opened.project.domain)
  const options = topicOptions(competitorContext(opened.db, topicScope(opened.db, draft)), draft)
  const name = competitorName(
    { domain: page.domain, title: page.title, h1: page.h1, text: read.text },
    [...options.competitors, ...options.partial]
  )
  const headings = cleanHeadings(page.outline)
  const h1 = page.h1 === null ? null : cleanHeading(page.h1)
  const sections = h1 === null || headings.includes(h1) ? headings : [h1, ...headings]
  const market = marketBlockFor(opened.db, marketId ?? draft.marketIds[0] ?? null)
  const shared = {
    competitor_url: page.url,
    competitor_name: name,
    outline: fenceSafe(bullets(headings), TAG),
    page_text: fenceSafe(cleanPageText(read.text, PAGE_TEXT_CHARS), TAG),
    seed: draft.seed,
    market_block: market,
    ...brandVars(draft.brandNames)
  }
  // Own paragraphs that share words with their page come first, so a claim they make
  // is checked against the part of the business's page that would make it too.
  const subject = [draft.seed, page.title ?? '', h1 ?? '', ...headings, shared.page_text].join('\n')
  const evidencePages = ownEvidencePages(ownReads, subject, CLAIM_EVIDENCE_CHARS)
  const ownPaths = new Set(evidencePages.map((item) => item.path))
  const started = Date.now()
  const [asked, claimed] = await Promise.all([
    runTopicTemplate<QuestionReply>({
      host: env.host,
      db: opened.db,
      projectId: opened.project.id,
      pageId: draft.topicId,
      kind: 'competitor_page_questions_v2',
      channel: 'topics:competitorQuestions',
      context: {
        ...shared,
        title: fenceSafe(page.title ?? '', TAG),
        meta_description: fenceSafe(page.metaDescription ?? '', TAG),
        h1: fenceSafe(h1 ?? '', TAG),
        count: COMPETITOR_QUESTION_COUNT,
        buyer_block: topicBuyerBlock(draft),
        stage_rules: stageRules()
      }
    }),
    runTopicTemplate<ClaimReply>({
      host: env.host,
      db: opened.db,
      projectId: opened.project.id,
      pageId: draft.topicId,
      kind: 'competitor_page_claims',
      channel: 'topics:competitorQuestions',
      context: {
        ...shared,
        evidence: evidenceBlock(evidencePages, CLAIM_EVIDENCE_CHARS)
      }
    })
  ])

  // Code checks: no question names either brand or any competitor; every section is
  // one of their headings, copied exactly (a near miss is snapped, a miss dropped).
  const nameKeysToAvoid = [...nameKeys(name, page.domain), ...options.competitorKeys]
  let dropped = 0
  const kept: { stage: TopicStage; text: string; section: string }[] = []
  for (const item of asked.value.questions) {
    const text = item.text.replace(/\s+/gu, ' ').trim()
    if (namesBrand(text, draft.brandNames) || namesAny(text, nameKeysToAvoid)) {
      dropped += 1
      continue
    }
    const section = snapSection(item.section, sections)
    if (section === null) continue
    kept.push({ stage: item.stage, text, section })
  }
  const prompts = kept.map((item) =>
    newDraftPrompt(
      {
        kind: 'question',
        text: item.text,
        stage: item.stage,
        source: 'competitor',
        sourceNote: `From their section: ${item.section}`
      },
      `tq-${env.host.createId()}`,
      draft.brandNames
    )
  )

  // Claims: sections snapped to their headings; yourEvidence must be a page we sent.
  const claims: CompetitorClaim[] = claimed.value.claims
    .filter((claim) => !namesBrand(claim.claim, draft.brandNames))
    .map((claim) => {
      const evidence = ownPath(claim.yourEvidence, ownPaths)
      return {
        id: `claim-${env.host.createId()}`,
        claim: claim.claim.replace(/\s+/gu, ' ').trim(),
        onYourSite: claim.onYourSite,
        section: snapSection(claim.section, sections),
        yourEvidence: claim.onYourSite === 'no' ? null : evidence
      }
    })
    .map((claim, index) => ({ claim, index }))
    .sort(
      (a, b) =>
        CLAIM_ORDER[a.claim.onYourSite] - CLAIM_ORDER[b.claim.onYourSite] || a.index - b.index
    )
    .map((item) => item.claim)

  const next = saveDraft(
    opened.db,
    {
      ...draft,
      step: 'questions',
      marketIds: marketId === null ? draft.marketIds : [marketId],
      prompts: [...draft.prompts.filter((prompt) => prompt.source !== 'competitor'), ...prompts],
      competitorClaims: claims
    },
    env.host.now()
  )
  return {
    draft: next,
    claims,
    droppedForBrand: dropped,
    info: { ...asked.info, durationMs: Math.max(0, Date.now() - started) }
  }
}

/** A reply's evidence path as one of the pages sent ("/pricing", "[/pricing]", a full URL). */
function ownPath(value: string | null, paths: ReadonlySet<string>): string | null {
  if (value === null) return null
  let path = value.trim().replace(/^\[|\]$/gu, '')
  try {
    if (/^https?:\/\//iu.test(path)) path = new URL(path).pathname || '/'
  } catch {
    return null
  }
  if (paths.has(path)) return path
  const trimmed = path.replace(/\/+$/u, '') || '/'
  for (const known of paths) if ((known.replace(/\/+$/u, '') || '/') === trimmed) return known
  return null
}
