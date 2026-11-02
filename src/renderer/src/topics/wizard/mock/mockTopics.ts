import {
  QUICK_INTERVAL_DAYS,
  TOPIC_PROFILE_SECTION_LABEL,
  TOPIC_STAGES,
  TOPIC_STAGE_LABEL,
  type TopicDraft,
  type TopicDraftPrompt,
  type TopicDraftSummary,
  type TopicStage
} from '@shared/domain'
import { textboltTopicDraft } from '@shared/fixtures/textbolt-topic'
import type {
  AssistLabel,
  CompanySuggestion,
  TopicCallInfo,
  TopicEstimate,
  TopicPlanOption,
  TopicProfileSuggestion,
  TopicPromptSuggestion,
  TopicStep
} from '@shared/ipc'
import { WRITE_WITH_URL } from '@shared/ipc'
import { MOCK_PACE_STORAGE_KEY } from '../../../onboarding/flags'
import type { TopicsClient } from '../client'
import { keywordsOf, newDraft, profilePoints, questionTarget, questionsOf } from '../utils/draft'
import { fitFor, searchRange } from '../utils/estimate'
import { cleanUp, csvColumns, csvLines, parsePasted, type RawLine } from '../utils/importParse'
import { applyPatch } from '../utils/patch'
import {
  FIXTURE_ABOUT,
  FIXTURE_CLEANUP,
  FIXTURE_COMPETITOR_CLAIMS,
  FIXTURE_COMPETITOR_QUESTIONS,
  FIXTURE_COMPETITOR_READ,
  FIXTURE_DISCOVER_MORE,
  FIXTURE_DISCOVERY,
  FIXTURE_PROFILE_GAPS,
  FIXTURE_SEED
} from './fixture'

/**
 * The Add wizard's `topics:*` mock (dev harness and the mock e2e build only;
 * `client.ts` loads it behind the mock guard). Answers come from the TextBolt
 * topic fixture. Drafts live in localStorage so a restart keeps them.
 */

export const MOCK_DRAFTS_STORAGE_KEY = 'citefox.mock.topicDrafts'
/** `low` (default) leaves 13 searches, as in Seed-Estimate.png; `enough` leaves 3,992. */
export const MOCK_BUDGET_STORAGE_KEY = 'citefox.mock.topicBudget'

const SITE = 'https://textbolt.com'
const SECONDS: Readonly<Record<TopicStep, number>> = {
  suggested_start: 10,
  seed_discover: 25,
  buyer_profile: 20,
  profile_discover: 15,
  journey_questions: 40,
  questions_discover: 15,
  journey_gaps: 12,
  question_rewrite: 5,
  keyword_terms: 20,
  keyword_expand: 30,
  keyword_groups: 15,
  questions_cleanup: 20,
  competitor_questions: 25,
  page_match: 20,
  page_brief: 20,
  why_not_cited: 15,
  draft_fix: 20,
  topic_summary: 10,
  explain_citation: 10,
  target_suggest: 12
}

const SITE_STEPS: readonly TopicStep[] = [
  'seed_discover',
  'buyer_profile',
  'profile_discover',
  'keyword_terms',
  'page_match'
]

function readPace(): number {
  try {
    const raw = localStorage.getItem(MOCK_PACE_STORAGE_KEY)
    const value = raw === null || raw === '' ? 0 : Number(raw)
    return Number.isFinite(value) && value >= 0 ? value : 0
  } catch {
    return 0
  }
}

async function pause(): Promise<void> {
  const ms = readPace()
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms))
}

function label(step: TopicStep): AssistLabel {
  const seconds = SECONDS[step]
  return {
    connection: 'claude-code',
    connectionText: 'CiteFox AI · on your plan',
    expectedSeconds: seconds,
    text: `CiteFox AI · on your plan · about ${seconds} s`
  }
}

function info(step: TopicStep): TopicCallInfo {
  return { label: label(step), durationMs: SECONDS[step] * 1000, model: null, searchesUsed: 0 }
}

let seq = 0
function id(prefix: string): string {
  seq += 1
  return `${prefix}-${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

type Store = Record<string, TopicDraft>
const memory: Store = {}

function load(): Store {
  try {
    const raw = localStorage.getItem(MOCK_DRAFTS_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Store) : memory
  } catch {
    return memory
  }
}

function save(store: Store): void {
  for (const key of Object.keys(memory)) if (!(key in store)) delete memory[key]
  Object.assign(memory, store)
  try {
    localStorage.setItem(MOCK_DRAFTS_STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Storage blocked: the in-memory copy still serves this session.
  }
}

function get(draftId: string): TopicDraft {
  const draft = load()[draftId]
  if (!draft) throw new Error('This draft is gone. It may have been started or discarded.')
  return draft
}

function put(draft: TopicDraft): TopicDraft {
  const store = load()
  const next = { ...draft, updatedAt: new Date().toISOString() }
  store[draft.id] = next
  save(store)
  return next
}

function budget(): number {
  try {
    return localStorage.getItem(MOCK_BUDGET_STORAGE_KEY) === 'enough' ? 3992 : 13
  } catch {
    return 13
  }
}

function summary(draft: TopicDraft): TopicDraftSummary {
  return {
    id: draft.id,
    path: draft.path,
    step: draft.step,
    name: draft.name,
    topicId: draft.topicId,
    questions: questionsOf(draft).length,
    keywords: keywordsOf(draft).length,
    updatedAt: draft.updatedAt
  }
}

const fixture = textboltTopicDraft()
const fixtureByText = new Map(fixture.prompts.map((prompt) => [prompt.text, prompt]))

function unmatched(prompt: TopicDraftPrompt): TopicDraftPrompt {
  return {
    ...prompt,
    id: id(prompt.kind === 'keyword' ? 'kw' : 'q'),
    targetPageId: null,
    targetUrl: null,
    matchConfidence: null,
    matchReason: null,
    matchStatus: 'unmatched'
  }
}

function suggestion(
  partial: Partial<TopicPromptSuggestion> & { text: string }
): TopicPromptSuggestion {
  return {
    id: id('sug'),
    kind: 'question',
    stage: null,
    kwGroup: null,
    kwGroupKind: null,
    kwFamily: null,
    intent: null,
    funnel: null,
    pageType: null,
    reason: null,
    replacesId: null,
    ...partial
  }
}

/** Two overlapping pairs from the draft: same stage, shared opening words. */
function overlaps(draft: TopicDraft): { a: string; b: string; reason: string }[] {
  const questions = questionsOf(draft)
  const pairs: { a: string; b: string; reason: string }[] = []
  for (const stage of TOPIC_STAGES) {
    const inStage = questions.filter((q) => q.stage === stage)
    const [a, b] = inStage
    if (
      a &&
      b &&
      pairs.length < 3 &&
      (stage === 'problem' || stage === 'compare' || stage === 'decide')
    ) {
      pairs.push({ a: a.id, b: b.id, reason: 'Would likely show the same AI Overview.' })
    }
  }
  return pairs
}

function estimateFor(draft: TopicDraft, scope: 'questions' | 'keywords' | 'both'): TopicEstimate {
  const q = questionsOf(draft).filter((p) => p.included)
  const k = keywordsOf(draft).filter((p) => p.included)
  const prompts =
    scope === 'questions' ? q.length : scope === 'keywords' ? k.length : q.length + k.length
  const markets = Math.max(1, draft.marketIds.length)
  const left = budget()
  const all = searchRange(prompts, markets)
  const today = Math.max(1, Math.min(prompts, Math.floor(left / (2 * markets)) || 1))
  const likeliest = searchRange(today, markets)
  const stage: TopicStage = 'problem'
  const stageN = q.filter((p) => p.stage === stage).length
  const stageRange = searchRange(stageN, markets)
  const spreadN = Math.min(prompts, 10)
  const spread = searchRange(spreadN, markets)
  const restFits = all.high <= left
  const plan = (
    p: Omit<TopicPlanOption, 'firstStage' | 'firstGroup'> & Partial<TopicPlanOption>
  ): TopicPlanOption => ({
    firstStage: null,
    firstGroup: null,
    ...p
  })
  const plans: TopicPlanOption[] = [
    plan({
      plan: 'likeliest',
      label: "CiteFox AI's plan: likeliest wins first",
      detail: `${today} today (about ${Math.round((likeliest.low + likeliest.high) / 2)} searches), the rest over ${restFits ? 'the next 7 days' : '7 days from Nov 1'}`,
      todayPrompts: today,
      todaySearchesLo: likeliest.low,
      todaySearchesHi: likeliest.high,
      restDays: prompts > today ? 7 : 0,
      fit: fitFor(likeliest, left),
      suggested: true
    }),
    plan({
      plan: 'stage_first',
      label: 'Check one stage first',
      detail: `${TOPIC_STAGE_LABEL[stage]} · ${stageN} questions · ${stageRange.low}–${stageRange.high} searches`,
      todayPrompts: stageN,
      todaySearchesLo: stageRange.low,
      todaySearchesHi: stageRange.high,
      restDays: 0,
      fit: fitFor(stageRange, left),
      suggested: false,
      firstStage: stage
    }),
    plan({
      plan: 'stagger',
      label: `${spreadN} now, the rest over 7 days`,
      detail:
        fitFor(spread, left) === 'fits'
          ? 'One per stage first; the score fills in as they land'
          : `One per stage first; today's ${spreadN} may use more than ${left}`,
      todayPrompts: spreadN,
      todaySearchesLo: spread.low,
      todaySearchesHi: spread.high,
      restDays: 7,
      fit: fitFor(spread, left),
      suggested: false
    }),
    plan({
      plan: 'all_now',
      label: 'Check all now',
      detail: `All ${prompts} today · results in about ${Math.max(1, Math.round(prompts / 5))} minutes`,
      todayPrompts: prompts,
      todaySearchesLo: all.low,
      todaySearchesHi: all.high,
      restDays: 0,
      fit: fitFor(all, left),
      suggested: false
    })
  ]
  const one = searchRange(prompts, markets)
  return {
    draftId: draft.id,
    scope,
    questions: q.length,
    keywords: k.length,
    stages: new Set(q.map((p) => p.stage)).size,
    groups: new Set(k.map((p) => p.kwGroup)).size,
    markets,
    prompts,
    searchesLo: all.low,
    searchesHi: all.high,
    searchesLeft: left,
    renewsOn: '2026-11-01',
    plans,
    recheck: QUICK_INTERVAL_DAYS.map((days) => ({
      intervalDays: days,
      monthlyLo: Math.round((one.low * 30) / days),
      monthlyHi: Math.round((one.high * 30) / days)
    })),
    targets: {
      set: draft.prompts.filter((p) => p.included && p.targetUrl).length,
      noPage: draft.prompts.filter((p) => p.included && !p.targetUrl).length
    },
    note: restFits ? null : "Anything that doesn't fit waits for Nov 1. Nothing is lost."
  }
}

function importLines(draft: TopicDraft, lines: readonly RawLine[], append: boolean): TopicDraft {
  const keep = append ? draft.prompts : draft.prompts.filter((p) => p.source !== 'imported')
  const outcome = cleanUp(
    [
      ...(append
        ? questionsOf(draft).map((p) => ({ text: p.text, source: p.sourceNote ?? 'Pasted' }))
        : []),
      ...lines
    ],
    draft.brandNames,
    () => id('q')
  )
  const prompts = append
    ? [...keep.filter((p) => p.kind !== 'question'), ...outcome.prompts]
    : [...keep, ...outcome.prompts]
  return {
    ...draft,
    prompts,
    importStats: {
      lines: lines.length + (append ? (draft.importStats?.lines ?? 0) : 0),
      kept: outcome.prompts.filter((p) => p.included).length,
      duplicatesMerged: outcome.duplicatesMerged,
      brandFlagged: outcome.brandFlagged,
      shortFlagged: outcome.shortFlagged
    }
  }
}

export function createMockTopicsClient(): TopicsClient {
  return {
    async 'topics:describeStep'({ step }) {
      return {
        step,
        label: label(step),
        reads: SITE_STEPS.includes(step) ? 'Uses your site, no searches' : 'No new searches',
        searchCost: 0
      }
    },
    async 'topics:suggestedStart'() {
      await pause()
      return {
        suggestion: {
          seed: FIXTURE_SEED,
          facts: [
            { value: '3', text: 'of your pages already cover parts of it' },
            { value: '3 of 8', text: 'overviews cite your tracked page' },
            { value: '3', text: 'competitors cited instead, two from blog posts' }
          ],
          why: '/email-to-sms/ · /use-cases/it-alerts/ · /blog/how-to-set-up-text-alerts-for-business/ cover parts of it. Cited instead: simpletexting.com, twilio.com, clicksend.com. Also worth a look: carrier email-to-text gateways shutting down [re-check dates].',
          path: 'seed',
          info: info('suggested_start')
        },
        message: null
      }
    },
    async 'topics:listDrafts'({ projectId }) {
      return {
        drafts: Object.values(load())
          .filter((draft) => draft.projectId === projectId && draft.startedAt === null)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map(summary)
      }
    },
    async 'topics:createDraft'({ projectId, path, seed, name }) {
      const draft = newDraft({
        id: id('draft'),
        projectId,
        path,
        now: new Date().toISOString(),
        website: 'textbolt.com',
        brandNames: ['TextBolt', 'Text Bolt', 'textbolt.com'],
        competitors: [
          'simpletexting.com',
          'twilio.com',
          'clicksend.com',
          'eztexting.com',
          'textedly.com'
        ],
        marketIds: ['mkt-us'],
        about: path === 'seed' ? FIXTURE_ABOUT : '',
        ...(seed !== undefined ? { seed } : {}),
        ...(name !== undefined ? { name } : {})
      })
      return put({ ...draft, otherSeeds: path === 'seed' ? FIXTURE_DISCOVERY.otherSeeds : [] })
    },
    async 'topics:getDraft'({ draftId }) {
      return get(draftId)
    },
    async 'topics:updateDraft'({ draftId, patch }) {
      const draft = get(draftId)
      return put(applyPatch(draft, patch, { now: new Date().toISOString(), makeId: id }))
    },
    async 'topics:discardDraft'({ projectId, draftId }) {
      const store = load()
      delete store[draftId]
      save(store)
      return {
        drafts: Object.values(store)
          .filter((draft) => draft.projectId === projectId)
          .map(summary)
      }
    },

    async 'topics:discoverSeed'({ draftId }) {
      await pause()
      return {
        draftId,
        pagesRead: ['/', '/pricing/', '/use-cases/', '/integrations/', '/faq/'].map(
          (path, index) => ({
            url: `${SITE}${path}`,
            role: ['Home', 'Pricing', 'Use cases', 'Integrations', 'FAQ'][index] ?? 'Page',
            ok: true
          })
        ),
        seeds: FIXTURE_DISCOVERY.problems.map((problem, index) => ({
          id: `seed-${index + 1}`,
          text: problem.text,
          caution: problem.recheck ? 'Facts to re-check' : null,
          productId: null,
          evidence: null
        })),
        segments: FIXTURE_DISCOVERY.segments.map((name, index) => ({
          id: `seg-${index + 1}`,
          name,
          reason: 'Named on a use-case page'
        })),
        competitors: FIXTURE_DISCOVERY.competitors.map(
          company('comp', 'A buyer could pick it instead: the compare page sets both side by side.')
        ),
        switchingFrom: FIXTURE_DISCOVERY.switchingFrom.map(
          company('switch', 'It shut down, so teams that used it need a new way to send alerts.')
        ),
        integrations: FIXTURE_DISCOVERY.integrations.map(
          company('integ', 'Users send alarms from it through TextBolt.')
        ),
        about: FIXTURE_ABOUT,
        info: info('seed_discover'),
        message: null
      }
    },
    async 'topics:writeProfile'({ draftId, rewrite }) {
      await pause()
      const draft = get(draftId)
      const version = (draft.profile?.versions.length ?? 0) + 1
      const points = profilePoints(fixture).map((point) => ({
        ...point,
        id: id('pp'),
        isNew: version > 1 && point.section === 'triggers'
      }))
      return put({
        ...draft,
        profile: {
          current: version,
          versions: [
            ...(draft.profile?.versions ?? []),
            {
              version,
              points,
              writtenAt: new Date().toISOString(),
              note: rewrite ? 'rewritten' : 'written',
              templateId: 'tpl-topic-buyer-profile',
              templateName: 'icp.md',
              templateHash: null
            }
          ]
        }
      })
    },
    async 'topics:discoverProfileSection'({ draftId, section, action }) {
      await pause()
      const suggestions: TopicProfileSuggestion[] =
        action === 'explain'
          ? []
          : FIXTURE_PROFILE_GAPS.filter(([s]) => section === null || s === section).map(
              ([s, text, foundIn, verify]) => ({
                id: id('sug'),
                section: s,
                text,
                foundIn,
                verify,
                replacesPointId: null
              })
            )
      return {
        draftId,
        section,
        action,
        suggestions,
        explanation:
          action === 'explain'
            ? `Each point in ${section ? TOPIC_PROFILE_SECTION_LABEL[section] : 'the profile'} names where CiteFox AI found it: a page on your site, your FAQ or your seed. A point with no source is inferred; re-check it.`
            : null,
        toVerify: suggestions.filter((item) => item.verify).length,
        info: info('profile_discover')
      }
    },
    async 'topics:rewriteSection'({ draftId, section, mode }) {
      await pause()
      const points = profilePoints(get(draftId)).filter((point) => point.section === section)
      return {
        draftId,
        section,
        action: mode,
        suggestions: points.map((point) => ({
          id: id('sug'),
          section,
          text:
            mode === 'shorter'
              ? (point.text.split(/[,:;]/)[0]?.trim() ?? point.text)
              : `${point.text} (in their words)`,
          foundIn: point.foundIn,
          verify: null,
          replacesPointId: point.id
        })),
        explanation: null,
        toVerify: 0,
        info: info('profile_discover')
      }
    },
    async 'topics:generateQuestions'({ draftId }) {
      await pause()
      const draft = get(draftId)
      const target = questionTarget(draft.depth.questions)
      const fresh = questionsOf(fixture).slice(0, target).map(unmatched)
      // Claude-written questions are replaced; user and imported ones stay.
      const kept = draft.prompts.filter((p) => !(p.kind === 'question' && p.source === 'claude'))
      return put({ ...draft, prompts: [...fresh, ...kept] })
    },
    async 'topics:discoverStageQuestions'({ draftId, stage }) {
      await pause()
      const lines = FIXTURE_DISCOVER_MORE.filter(([s]) => s === stage)
      const suggestions = (
        lines.length > 0
          ? lines
          : [
              [
                stage,
                `What do teams like ours do first when ${TOPIC_STAGE_LABEL[stage].toLowerCase()} questions come up about text alerts?`
              ] as const
            ]
      ).map(([s, text]) => suggestion({ text, stage: s, reason: 'Fills a thin stage' }))
      return { draftId, suggestions, droppedForBrand: 0, info: info('questions_discover') }
    },
    async 'topics:findJourneyGaps'({ draftId }) {
      await pause()
      const draft = get(draftId)
      const pairs = overlaps(draft)
      return {
        draftId,
        gaps: [
          { stage: 'fit', note: 'Fit has nothing for clinics' },
          { stage: 'decide', note: 'Decide has nothing on switching' }
        ],
        overlaps: pairs,
        suggestions: FIXTURE_DISCOVER_MORE.slice(0, 2).map(([stage, text]) =>
          suggestion({ text, stage })
        ),
        headline: `2 gaps, ${pairs.length} overlapping pairs. Fit has nothing for clinics; Decide has nothing on switching.`,
        info: info('journey_gaps')
      }
    },
    async 'topics:rewriteQuestion'({ draftId, promptIds }) {
      await pause()
      const draft = get(draftId)
      const suggestions = draft.prompts
        .filter((p) => promptIds.includes(p.id))
        .map((p) =>
          suggestion({
            text:
              FIXTURE_CLEANUP[p.text] ??
              (/^(We|Our|I|My) /.test(p.text) ? p.text : `We're a small team. ${p.text}`),
            stage: p.stage,
            replacesId: p.id,
            reason: 'In the buyer’s words'
          })
        )
      return { draftId, suggestions, droppedForBrand: 0, info: info('question_rewrite') }
    },
    async 'topics:discoverTerms'({ draftId }) {
      await pause()
      return { draftId, terms: fixture.keywordTerms, info: info('keyword_terms') }
    },
    async 'topics:generateKeywords'({ draftId }) {
      await pause()
      const draft = get(draftId)
      // Main expands kept core terms only, and says so the same way.
      if (!draft.keywordTerms.some((term) => term.kept)) {
        throw new Error('Add or discover core terms first.')
      }
      const max = draft.depth.keywords.maxKeywords
      const keywords = keywordsOf(fixture).slice(0, max).map(unmatched)
      const next = put({
        ...draft,
        prompts: [...draft.prompts.filter((p) => p.kind !== 'keyword'), ...keywords]
      })
      const groups = new Set(keywords.map((k) => k.kwGroup)).size
      const range = searchRange(keywords.length)
      return {
        draft: next,
        summary: {
          keywords: keywords.length,
          groups,
          searchesLo: range.low,
          searchesHi: range.high,
          searchesLeft: budget(),
          line: `${keywords.length} keywords in ${groups} groups · ≈${range.low}–${range.high} searches per market · ${budget()} left`
        },
        fromPatterns: Math.round(keywords.length * 0.4),
        fromClaude: keywords.length - Math.round(keywords.length * 0.4),
        droppedForBrand: 0,
        info: info('keyword_expand')
      }
    },
    async 'topics:suggestMissingGroups'({ draftId }) {
      await pause()
      const make = (text: string, group: string): TopicPromptSuggestion =>
        suggestion({
          kind: 'keyword',
          text,
          kwGroup: group,
          kwGroupKind: 'intent',
          kwFamily: 'core_category',
          intent: 'commercial',
          funnel: 'mofu',
          pageType: 'landing page'
        })
      return {
        draftId,
        groups: [
          {
            name: 'Segment — schools',
            kind: 'intent',
            family: 'core_category',
            reason: 'Schools appear in the profile',
            keywords: [
              make('text alerts for schools', 'Segment — schools'),
              make('school staff text alerts', 'Segment — schools')
            ]
          },
          {
            name: 'Segment — clinics',
            kind: 'intent',
            family: 'core_category',
            reason: 'Clinics appear in the profile',
            keywords: [make('text alerts for clinics', 'Segment — clinics')]
          }
        ],
        info: info('keyword_groups')
      }
    },
    async 'topics:mergeNearDuplicates'({ draftId, apply }) {
      await pause()
      const draft = get(draftId)
      const keywords = keywordsOf(draft)
      const pairs = [] as {
        keepId: string
        dropId: string
        keep: string
        drop: string
        reason: string
      }[]
      for (let i = 0; i < keywords.length && pairs.length < 3; i += 1) {
        const a = keywords[i]
        const b = keywords.find(
          (k, j) =>
            j > i &&
            a &&
            k.text.replace(/^best /, '') === a.text.replace(/^best /, '') &&
            k.id !== a.id
        )
        const c = keywords.find((k, j) => j > i && a && k.text === `${a.text} service`)
        const other = b ?? c
        if (a && other)
          pairs.push({
            keepId: a.id,
            dropId: other.id,
            keep: a.text,
            drop: other.text,
            reason: 'Likely the same AI Overview'
          })
      }
      if (!apply) return { pairs, draft: null }
      const drop = new Set(pairs.map((p) => p.dropId))
      return {
        pairs,
        draft: put({ ...draft, prompts: draft.prompts.filter((p) => !drop.has(p.id)) })
      }
    },
    async 'topics:keywordSummary'({ draftId }) {
      const keywords = keywordsOf(get(draftId)).filter((k) => k.included)
      const groups = new Set(keywords.map((k) => k.kwGroup)).size
      const range = searchRange(keywords.length)
      return {
        keywords: keywords.length,
        groups,
        searchesLo: range.low,
        searchesHi: range.high,
        searchesLeft: budget(),
        line: `${keywords.length} keywords in ${groups} groups · ≈${range.low}–${range.high} searches per market · ${budget()} left`
      }
    },
    async 'topics:readCsvColumns'({ content }) {
      return csvColumns(content)
    },
    async 'topics:importQuestions'({ draftId, text, csv, append }) {
      await pause()
      const draft = get(draftId)
      const lines: RawLine[] = [
        ...parsePasted(text ?? '').map((line) => ({ text: line, source: 'Pasted' })),
        ...(csv ? csvLines(csv.content, csv.mapping) : [])
      ]
      const imported = importLines(draft, lines, append === true)
      const csvInfo = csv ? csvColumns(csv.content) : null
      const next = put({
        ...imported,
        importSource: {
          pastedLines: parsePasted(text ?? '').length,
          csvFileName: csv?.fileName ?? null,
          csvRows: csvInfo?.rows ?? 0,
          csvColumns: csvInfo
            ? csvInfo.columns.filter((_, index) =>
                [csv?.mapping.question, csv?.mapping.source, csv?.mapping.notes].includes(index)
              )
            : []
        }
      })
      return {
        draft: next,
        rows: questionsOf(next).filter((p) => p.source === 'imported'),
        stats: next.importStats ?? {
          lines: 0,
          kept: 0,
          duplicatesMerged: 0,
          brandFlagged: 0,
          shortFlagged: 0
        }
      }
    },
    async 'topics:cleanupWithClaude'({ draftId }) {
      await pause()
      const draft = get(draftId)
      const items = questionsOf(draft)
        .filter((p) => FIXTURE_CLEANUP[p.text] !== undefined || p.flags.includes('brand'))
        .map((p) => ({
          id: p.id,
          before: p.text,
          after:
            FIXTURE_CLEANUP[p.text] ??
            p.text.replace(/\bText ?Bolt\b/gi, 'an email-to-text service'),
          stage: p.stage,
          change: FIXTURE_CLEANUP[p.text]
            ? 'Made it a question in the buyer’s words'
            : 'Brand name removed'
        }))
      return { draftId, items, info: info('questions_cleanup') }
    },
    async 'topics:readCompetitorPage'({ draftId, url }) {
      await pause()
      const draft = get(draftId)
      const page = {
        ...FIXTURE_COMPETITOR_READ,
        url,
        ok: true,
        readAt: new Date().toISOString(),
        message: null
      }
      return { draft: put({ ...draft, competitorUrl: url, competitorPage: page }), page }
    },
    async 'topics:competitorQuestions'({ draftId }) {
      await pause()
      const draft = get(draftId)
      const prompts: TopicDraftPrompt[] = FIXTURE_COMPETITOR_QUESTIONS.map(
        ([stage, text, section, out]) => ({
          ...unmatched({ ...questionsOf(fixture)[0]!, text, stage }),
          source: 'competitor',
          sourceNote: section,
          included: !out
        })
      )
      return {
        draft: put({
          ...draft,
          prompts: [...draft.prompts.filter((p) => p.source !== 'competitor'), ...prompts],
          competitorClaims: FIXTURE_COMPETITOR_CLAIMS
        }),
        claims: FIXTURE_COMPETITOR_CLAIMS,
        droppedForBrand: 1,
        info: info('competitor_questions')
      }
    },
    async 'topics:pageCandidates'() {
      const seen = new Map<
        string,
        {
          pageId: string | null
          url: string
          title: string | null
          source: 'tracked' | 'sitemap'
          outline: readonly string[]
        }
      >()
      for (const prompt of fixture.prompts) {
        if (prompt.targetUrl && !seen.has(prompt.targetUrl)) {
          const path = prompt.targetUrl.replace(SITE, '')
          seen.set(prompt.targetUrl, {
            pageId: prompt.targetPageId,
            url: prompt.targetUrl,
            title: path.replace(/[/-]+/g, ' ').trim() || 'Home',
            source: prompt.targetPageId ? 'tracked' : 'sitemap',
            outline: []
          })
        }
      }
      return { candidates: [...seen.values()], sitemapReadAt: '2026-10-19T09:00:00.000Z' }
    },
    async 'topics:matchPages'({ draftId, promptIds }) {
      await pause()
      const draft = get(draftId)
      const wanted = promptIds ? new Set(promptIds) : null
      let matched = 0
      let noPage = 0
      const prompts = draft.prompts.map((prompt): TopicDraftPrompt => {
        if (prompt.matchStatus === 'confirmed' || (wanted && !wanted.has(prompt.id))) return prompt
        const source = fixtureByText.get(prompt.text)
        const fallback =
          prompt.kind === 'question' && prompt.stage === 'decide' ? `${SITE}/pricing/` : null
        const url = source?.targetUrl ?? fallback
        if (url) matched += 1
        else noPage += 1
        const confidence = source?.matchConfidence ?? (url ? 52 : null)
        return {
          ...prompt,
          targetPageId: source?.targetPageId ?? (url ? 'page-pricing' : null),
          targetUrl: url,
          matchConfidence: confidence,
          matchReason: url
            ? confidence !== null && confidence >= 75
              ? 'A title or heading on the page answers it.'
              : 'A section of the page answers part of it.'
            : 'No page on your site answers this yet.',
          matchStatus: url ? 'suggested' : 'none'
        }
      })
      return { draft: put({ ...draft, prompts }), matched, noPage, info: info('page_match') }
    },
    async 'topics:setTarget'({ draftId, promptIds, target }) {
      if (!draftId) return { draft: null, rows: [] }
      const draft = get(draftId)
      const ids = new Set(promptIds)
      const prompts = draft.prompts.map((prompt): TopicDraftPrompt => {
        if (!ids.has(prompt.id)) return prompt
        if (!target) return { ...prompt, matchStatus: prompt.targetUrl ? 'confirmed' : 'none' }
        return {
          ...prompt,
          targetPageId: target.pageId,
          targetUrl: target.url,
          matchStatus: target.url ? 'confirmed' : 'none',
          matchReason: target.url ? 'Set by you.' : 'Marked as no page yet.',
          matchConfidence: target.url ? 100 : null
        }
      })
      const next = put({ ...draft, prompts })
      return {
        draft: next,
        rows: next.prompts
          .filter((p) => ids.has(p.id))
          .map((p) => ({ promptId: p.id, targetPageId: p.targetPageId, targetUrl: p.targetUrl }))
      }
    },
    async 'topics:draftPageBrief'({ promptId }) {
      await pause()
      const outline = [
        "The situation, in the buyer's words",
        'The short answer',
        'Set-up from your email tools',
        'What to watch out for',
        'FAQ: 3 related questions'
      ]
      const summaryText =
        "Answer first: two sentences in the buyer's words, then the set-up from email."
      return {
        promptId,
        summary: summaryText,
        outline,
        citedNow: ['twilio.com', 'ctia.org', 'reddit.com'],
        text: [summaryText, ...outline.map((line, index) => `${index + 1}. ${line}`)].join('\n'),
        writeWithUrl: WRITE_WITH_URL,
        info: info('page_brief')
      }
    },
    async 'topics:estimate'({ draftId, scope }) {
      await pause()
      const draft = get(draftId)
      return estimateFor(draft, scope ?? (draft.generate === 'keywords' ? 'keywords' : 'questions'))
    },
    async 'topics:start'({ draftId, plan }) {
      await pause()
      const draft = get(draftId)
      const topicId = `topic-${draft.id}`
      put({ ...draft, topicId, startedAt: new Date().toISOString() })
      const store = load()
      delete store[draftId]
      save(store)
      return {
        topicId,
        promptSetId: id('ps'),
        jobId: id('job'),
        batches:
          plan === 'all_now' || plan === 'stage_first'
            ? []
            : [{ batchNo: 2, dueAt: '2026-11-01T09:00:00.000Z', prompts: 22 }],
        message: 'Checking now. The topic opens while it checks.',
        nextStep: null
      }
    }
  }
}

/** A fixture company as a suggestion row (Docs/FEEDBACK.md row 3). */
function company(prefix: string, reason: string) {
  return (
    item: { name: string; domain: string | null; path: string; quote: string },
    index: number
  ): CompanySuggestion => ({
    id: `${prefix}-${index + 1}`,
    name: item.name,
    domain: item.domain,
    domainSource: item.domain === null ? null : 'site',
    reason,
    evidence: { path: item.path, quote: item.quote },
    checkDomain: false
  })
}
