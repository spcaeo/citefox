/**
 * TextBolt topic fixture: "Text alerts for teams without a developer".
 * 28 buyer questions across the six stages, 118 keywords in 22 groups, two
 * finished checks on real dates (Oct 5 and Oct 19, 2026) with a mix of match
 * states. Dev, test and e2e data only: renderer previews (`mocks/`), main's
 * e2e stub and unit tests import it; no production path does.
 *
 * `textboltTopicResults()` builds the `topics:results` payload through the
 * same pure functions main uses, so every number agrees with a real check.
 */

import type { CitationClass, TopicDraft, TopicDraftPrompt, TopicStage } from '../domain'
import { DEFAULT_TOPIC_BANDS } from '../domain'
import type { TopicMeta, TopicResults } from '../ipc/topics'
import { assembleTopicResults, type TopicPromptMeta, type TopicRunOutcomes } from '../topic-results'
import type { ScoredReference, TopicOutcome } from '../topic-scoring'
import {
  G,
  PAGES,
  PROFILE,
  Q,
  SITE,
  type Code,
  type GroupSeed,
  type PageKey
} from './textbolt-topic-data'

export const TEXTBOLT_TOPIC_PROJECT_ID = 'proj-1'
export const TEXTBOLT_TOPIC_ID = 'topic-textbolt-alerts'
export const TEXTBOLT_TOPIC_NAME = 'Text alerts for teams without a developer'
export const TEXTBOLT_TOPIC_MARKET = 'mkt-us'
export const TEXTBOLT_TOPIC_CHECKS = [
  { runId: 'run-topic-1', finishedAt: '2026-10-05T09:12:00.000Z' },
  { runId: 'run-topic-2', finishedAt: '2026-10-19T09:14:00.000Z' }
] as const

const ODD_DOMAINS = [
  'reddit.com',
  'simpletexting.com',
  'twilio.com',
  'g2.com',
  'capterra.com',
  'textedly.com'
]

/** Keyword outcomes are spread deterministically to land 77 overviews, 19 cited, 27 named. */
function keywordCodes(index: number): readonly [Code, Code] {
  const second: Code = index % 41 < 14 ? 'A' : index % 5 === 0 ? 'R' : index % 11 === 1 ? 'O' : 'N'
  const first: Code = index % 41 < 18 ? 'A' : index % 9 === 0 ? 'R' : 'N'
  return [first, second]
}

function classOf(domain: string): CitationClass {
  if (domain === 'textbolt.com') return 'own'
  if (['simpletexting.com', 'twilio.com'].includes(domain)) return 'competitor'
  return 'other'
}

function refs(
  code: Code,
  target: PageKey | null,
  instead: readonly string[],
  ownOther: string
): ScoredReference[] {
  if (code === 'A' || code === 'F' || code === '-') return []
  const out: ScoredReference[] = []
  const add = (url: string, domain: string): void => {
    out.push({
      url,
      normalizedUrl: url.replace(/^https:\/\//, '').replace(/\/$/, ''),
      domain,
      position: out.length + 1,
      classification: classOf(domain)
    })
  }
  const others = instead.length > 0 ? instead : ['reddit.com']
  if (code === 'R' && target !== null) {
    add(
      others[0] ? `https://${others[0]}/guide` : 'https://reddit.com/r/sysadmin',
      others[0] ?? 'reddit.com'
    )
    add(PAGES[target].url, 'textbolt.com')
    for (const domain of others.slice(1)) add(`https://${domain}/alerts`, domain)
    return out
  }
  for (const domain of others) add(`https://${domain}/alerts`, domain)
  if (code === 'O') add(ownOther, 'textbolt.com')
  return out
}

function normalized(url: string | null): string | null {
  return url === null ? null : url.replace(/^https:\/\//, '').replace(/\/$/, '')
}

function outcome(
  code: Code,
  references: ScoredReference[],
  check: (typeof TEXTBOLT_TOPIC_CHECKS)[number],
  named: boolean
): TopicOutcome {
  const status =
    code === '-'
      ? null
      : code === 'A'
        ? 'no_aio'
        : code === 'F'
          ? 'error'
          : code === 'R' || code === 'O'
            ? 'other_own_page'
            : named
              ? 'brand_mentioned'
              : 'not_cited'
  const hasAio = status !== null && status !== 'no_aio' && status !== 'error'
  return {
    status,
    references,
    named: hasAio ? named : null,
    runId: status === null ? null : check.runId,
    checkedAt: status === null ? null : check.finishedAt,
    aioSummary: hasAio ? 'AI Overview text for this prompt (fixture).' : null
  }
}

interface FixturePrompt {
  meta: TopicPromptMeta
  draft: TopicDraftPrompt
  codes: readonly [Code, Code]
  instead: readonly string[]
  named: boolean
  ownOther: string
}

function buildPrompts(): FixturePrompt[] {
  const out: FixturePrompt[] = []
  Q.forEach((seed, index) => {
    const n = index + 1
    const page = seed.target === null ? null : PAGES[seed.target]
    const id = `tq-${String(n).padStart(2, '0')}`
    out.push({
      meta: {
        promptId: `prompt-${id}`,
        stableKey: id,
        number: n,
        kind: 'question',
        text: seed.text,
        stage: seed.stage,
        kwGroup: null,
        kwGroupKind: null,
        intent: null,
        funnel: null,
        pageType: null,
        targetPageId: page?.id ?? null,
        targetUrl: page?.url ?? null,
        targetNormalizedUrl: normalized(page?.url ?? null),
        matchConfidence: seed.confidence,
        matchReason: page === null ? null : 'A heading on the page answers this situation.',
        targetConfirmed: n % 3 === 0
      },
      draft: draftPrompt(id, 'question', seed.text, seed.stage, null, page, seed.confidence),
      codes: seed.checks,
      instead: seed.instead,
      named: seed.named === true,
      ownOther: `${SITE}/blog/how-to-set-up-text-alerts-for-business/`
    })
  })
  let k = 0
  for (const group of G) {
    const page = group.target === null ? null : PAGES[group.target]
    for (const keyword of group.keywords) {
      k += 1
      const id = `tk-${String(k).padStart(3, '0')}`
      out.push({
        meta: {
          promptId: `prompt-${id}`,
          stableKey: id,
          number: k,
          kind: 'keyword',
          text: keyword,
          stage: null,
          kwGroup: group.name,
          kwGroupKind: group.kind,
          intent: group.intent,
          funnel: group.funnel,
          pageType: group.pageType,
          targetPageId: page?.id ?? null,
          targetUrl: page?.url ?? null,
          targetNormalizedUrl: normalized(page?.url ?? null),
          matchConfidence: page === null ? null : 55 + (k % 40),
          matchReason: page === null ? null : 'The page title uses this term.',
          targetConfirmed: false
        },
        draft: {
          ...draftPrompt(
            id,
            'keyword',
            keyword,
            null,
            group,
            page,
            page === null ? null : 55 + (k % 40)
          )
        },
        codes: keywordCodes(k),
        instead: [
          ODD_DOMAINS[k % ODD_DOMAINS.length] ?? 'reddit.com',
          ODD_DOMAINS[(k + 2) % ODD_DOMAINS.length] ?? 'g2.com'
        ],
        named: k % 4 === 0 || k % 9 === 2,
        ownOther: `${SITE}/blog/how-to-set-up-text-alerts-for-business/`
      })
    }
  }
  return out
}

function draftPrompt(
  id: string,
  kind: 'question' | 'keyword',
  text: string,
  stage: TopicStage | null,
  group: GroupSeed | null,
  page: { id: string | null; url: string } | null,
  confidence: number | null
): TopicDraftPrompt {
  return {
    id,
    kind,
    text,
    stage,
    source: 'claude',
    sourceNote: null,
    included: true,
    kwGroup: group?.name ?? null,
    kwGroupKind: group?.kind ?? null,
    kwFamily: group?.family ?? null,
    intent: group?.intent ?? null,
    funnel: group?.funnel ?? null,
    pageType: group?.pageType ?? null,
    targetPageId: page?.id ?? null,
    targetUrl: page?.url ?? null,
    matchConfidence: confidence,
    matchReason: page === null ? null : 'A heading on the page answers this situation.',
    matchStatus:
      page === null ? 'none' : confidence !== null && confidence >= 75 ? 'confirmed' : 'suggested',
    flags: [],
    overlapWith: [],
    mergedFrom: [],
    previousText: null
  }
}

/** Every question and keyword of the fixture, questions first. */
export function textboltTopicPrompts(): TopicDraftPrompt[] {
  return buildPrompts().map((prompt) => prompt.draft)
}

/** Prompt metadata as main reads it from `topic_prompts`. */
export function textboltTopicMetas(): TopicPromptMeta[] {
  return buildPrompts().map((prompt) => prompt.meta)
}

/** The two stored checks as outcomes per stable key, oldest first. */
export function textboltTopicRuns(): TopicRunOutcomes[] {
  const prompts = buildPrompts()
  return TEXTBOLT_TOPIC_CHECKS.map((check, index) => ({
    runId: check.runId,
    finishedAt: check.finishedAt,
    partial: false,
    outcomes: new Map(
      prompts.map((prompt) => {
        const code = prompt.codes[index] ?? '-'
        const target = prompt.meta.targetUrl === null ? null : targetKey(prompt.meta.targetUrl)
        return [
          prompt.meta.stableKey,
          outcome(code, refs(code, target, prompt.instead, prompt.ownOther), check, prompt.named)
        ] as const
      })
    )
  }))
}

function targetKey(url: string): PageKey | null {
  const entry = (Object.entries(PAGES) as [PageKey, { url: string }][]).find(
    ([, page]) => page.url === url
  )
  return entry?.[0] ?? null
}

export function textboltTopicDraft(now = '2026-10-04T10:00:00.000Z'): TopicDraft {
  return {
    id: 'draft-textbolt-alerts',
    projectId: TEXTBOLT_TOPIC_PROJECT_ID,
    path: 'seed',
    step: 'estimate',
    topicId: null,
    name: TEXTBOLT_TOPIC_NAME,
    seed: TEXTBOLT_TOPIC_NAME,
    otherSeeds: [
      'Email alerts nobody reads on weekends',
      'Replacing a carrier email-to-text gateway'
    ],
    website: 'textbolt.com',
    about:
      'Email-to-text for business alerts: send from Gmail, Outlook or any system that emails, and staff get normal texts. No app, no code.',
    generate: 'both',
    depth: {
      questions: {
        preset: 'custom',
        perStage: { problem: 6, options: 5, doubts: 5, fit: 4, compare: 4, decide: 4 }
      },
      keywords: {
        preset: 'standard',
        maxKeywords: 120,
        synonymsPerCoreTerm: 4,
        patternVariants: ['ai {X} software', 'automated {X}', '{X} for {segment}', 'best {X}'],
        longTailQuestions: true,
        intentFamilies: [
          'definitional',
          'core_category',
          'best_lists',
          'pricing',
          'alternatives_vs',
          'features',
          'how_to',
          'benefits_roi',
          'problem_aware',
          'question_long_tail',
          'trust_risk',
          'emerging_terms',
          'branded_defensive',
          'competitor_vs'
        ],
        perGroupCap: 8
      }
    },
    bands: DEFAULT_TOPIC_BANDS,
    marketIds: [TEXTBOLT_TOPIC_MARKET],
    brandNames: ['TextBolt'],
    competitors: [
      'simpletexting.com',
      'twilio.com',
      'textedly.com',
      'clicksend.com',
      'eztexting.com'
    ],
    segments: [
      'Clinics and multi-site offices',
      'Property maintenance crews',
      'MSPs with client alerts'
    ],
    profile: {
      current: 1,
      versions: [
        {
          version: 1,
          points: PROFILE.map((point, index) => ({
            ...point,
            id: `pp-${index + 1}`,
            isNew: false
          })),
          writtenAt: now,
          note: 'written',
          templateId: 'tpl-topic-buyer-profile',
          templateName: 'CiteFox default',
          templateHash: 'a'.repeat(64)
        }
      ]
    },
    prompts: textboltTopicPrompts(),
    keywordTerms: [
      {
        id: 'term-1',
        term: 'email to text',
        synonyms: ['email to sms', 'email to text service'],
        kept: true
      },
      {
        id: 'term-2',
        term: 'text alerts',
        synonyms: ['sms alerts', 'sms notifications', 'text notifications'],
        kept: true
      },
      { id: 'term-3', term: 'mass texting', synonyms: ['group texting', 'bulk sms'], kept: true }
    ],
    importSource: null,
    importStats: null,
    competitorUrl: null,
    competitorPage: null,
    competitorClaims: [],
    intervalDays: 14,
    createdAt: now,
    updatedAt: now,
    startedAt: null
  }
}

/** The topic header as `topics:results` names it. */
export function textboltTopicMeta(): TopicMeta {
  const metas = textboltTopicMetas()
  const questions = metas.filter((meta) => meta.kind === 'question')
  const targets = new Set(questions.map((meta) => meta.targetUrl).filter((url) => url !== null))
  const withTarget = questions.filter((meta) => meta.targetUrl !== null).length
  return {
    id: TEXTBOLT_TOPIC_ID,
    name: TEXTBOLT_TOPIC_NAME,
    source: 'seed',
    sourceLine: `From a seed · ${questions.length} questions · ${withTarget} target pages · every 14 days`,
    seed: TEXTBOLT_TOPIC_NAME,
    competitorUrl: null,
    intervalDays: 14,
    status: 'tracked',
    checkedAt: TEXTBOLT_TOPIC_CHECKS[1].finishedAt,
    markets: [
      { id: TEXTBOLT_TOPIC_MARKET, label: 'US · English', isDefault: true },
      { id: 'mkt-ca', label: 'CA · English', isDefault: false }
    ],
    marketId: TEXTBOLT_TOPIC_MARKET,
    bands: DEFAULT_TOPIC_BANDS,
    questions: questions.length,
    keywords: metas.length - questions.length,
    targetPages: targets.size,
    targetPage: null,
    pendingBatches: 0
  }
}

/** The whole `topics:results` payload for the fixture topic (US · English). */
export function textboltTopicResults(pinnedRunId: string | null = null): TopicResults {
  return assembleTopicResults({
    topic: textboltTopicMeta(),
    bands: DEFAULT_TOPIC_BANDS,
    metas: textboltTopicMetas(),
    runs: textboltTopicRuns(),
    pinnedRunId,
    savedSummary: {
      text: 'Since Oct 5: 4 more cited (Q3, Q18, Q22, Q26). Compare is weakest. Next: Q6 and Q8.',
      createdAt: '2026-10-19T09:20:00.000Z',
      runId: TEXTBOLT_TOPIC_CHECKS[1].runId
    },
    edits: [{ date: '2026-10-14', text: 'Added a day-one setup section to the Gmail guide' }],
    builtAt: '2026-10-21T08:00:00.000Z'
  })
}
