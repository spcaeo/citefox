import type { BuyerPrompt, Market, PageSummary } from '@shared/domain'
import type {
  AddQuestionsRequest,
  AddQuestionsResult,
  NewQuestion,
  PageIdRequest,
  PromptTextRules
} from '@shared/ipc'
import { normaliseQuestion, questionMergeKey } from '@shared/question-text'
import { IpcRequestError } from '../ipc-request'
import { PipelineError } from '../pipeline/errors'
import { getLatestBuyerProfile, getLatestPromptSet } from '../storage/content-records'
import type { SqliteDatabase } from '../storage/database'
import { MAX_PROMPT_COUNT, updateStoredPage } from '../storage/pages'
import { insertPromptLineage } from '../storage/prompt-lineage'
import { insertPromptSet, nextPromptSetVersion } from '../storage/prompt-set-records'
import { readProjectProfile } from '../storage/project-profile'
import { insertTopicPrompts, listTopicPrompts, type TopicPromptRecord } from '../topics/records'
import type { EngineHost } from './host'
import { pageKey } from './host'
import { pageMarkets, requirePage } from './page-access'
import { rulesOfKind, textProblem } from './prompt-reword'
import { withProject } from './project-db'

/** What a page prompt added here maps to until the user maps it on the Prompts tab. */
const UNMAPPED = 'Not mapped yet'
/** A page prompt's short name: the wording cut to this many characters. */
const LABEL_MAX = 60

/**
 * `prompts:addQuestions`. Writes a new prompt-set version: the active set with every
 * prompt carried over (new ids and lineage rows, as any saved version) and the new
 * questions appended, so the next check and "Check now" pick them up at once.
 */
export function addQuestions(
  host: EngineHost,
  request: AddQuestionsRequest
): Promise<AddQuestionsResult> {
  const channel = 'prompts:addQuestions'
  return withProject(host, request.projectId, channel, (opened) => {
    const { db } = opened
    const { pageId } = request
    const page = requirePage(db, pageId, request.projectId, channel)
    const topic = page.kind === 'topic'
    requireTracked(page, topic, channel)
    if (host.memory.drafts.has(pageKey(request.projectId, pageId))) {
      throw new IpcRequestError(
        channel,
        'This page has unsaved prompt edits on its Prompts tab. Save or discard them there first, then add questions.'
      )
    }
    const brands = brandNames(db)
    const active = getLatestPromptSet(db, pageId, brands)
    const icpId = active?.icpId ?? getLatestBuyerProfile(db, pageId)?.id ?? null
    if (icpId === null) {
      throw new PipelineError('Write the buyer profile for this page before adding questions.', {
        code: 'not_found',
        nextStep: 'Open the page, write its buyer profile, then add questions.'
      })
    }
    if (pageMarkets(db, pageId).length === 0) {
      throw new PipelineError('Add a market before adding questions.', {
        code: 'not_found',
        nextStep: 'Add a market on the page, then add questions.'
      })
    }
    const rules = rulesOfKind(topic ? 'question' : 'buyer_prompt', brands)
    const carried = active?.prompts ?? []
    const { fresh, skipped } = pickNew(carried, request.questions, rules)
    if (fresh.length === 0) {
      throw new IpcRequestError(
        channel,
        skipped.length === 1
          ? 'That question is already tracked here.'
          : 'Every one of these questions is already tracked here.'
      )
    }
    const written = appendQuestions(host, db, request.projectId, page, fresh)
    return {
      pageId,
      promptIds: written.promptIds,
      skipped,
      version: written.version,
      savedAt: written.savedAt
    }
  })
}

/** What {@link appendQuestions} wrote. */
export interface AppendedQuestions {
  promptIds: string[]
  version: number
  savedAt: string
}

/**
 * Appends questions that already passed their checks to a page's or topic's active
 * set, saved at once as a new prompt-set version (every earlier prompt carried with a
 * lineage row). Shared by + Add → Questions and the importer. A topic question keeps
 * its stage, kind (question or keyword), target page and note.
 */
export function appendQuestions(
  host: EngineHost,
  db: SqliteDatabase,
  projectId: string,
  page: PageSummary,
  fresh: readonly NewQuestion[],
  channel = 'prompts:addQuestions'
): AppendedQuestions {
  const pageId = page.id
  const topic = page.kind === 'topic'
  const brands = brandNames(db)
  const active = getLatestPromptSet(db, pageId, brands)
  const icpId = active?.icpId ?? getLatestBuyerProfile(db, pageId)?.id ?? null
  if (icpId === null) {
    throw new PipelineError('Write the buyer profile for this page before adding questions.', {
      code: 'not_found',
      nextStep: 'Open the page, write its buyer profile, then add questions.'
    })
  }
  const markets = pageMarkets(db, pageId)
  if (markets.length === 0) {
    throw new PipelineError('Add a market before adding questions.', {
      code: 'not_found',
      nextStep: 'Add a market on the page, then add questions.'
    })
  }
  const carried = active?.prompts ?? []
  if (carried.length + fresh.length > MAX_PROMPT_COUNT) {
    throw new IpcRequestError(
      channel,
      `A page or topic holds at most ${MAX_PROMPT_COUNT} questions.`
    )
  }

  const now = host.now().toISOString()
  const ids = new Map(carried.map((prompt) => [prompt.id, `prompt-${host.createId()}`]))
  const added = fresh.map((question, index) =>
    newPrompt(host, question, carried.length + index + 1, markets, topic)
  )
  const prompts: BuyerPrompt[] = [
    ...carried.map((prompt) => ({
      ...prompt,
      id: ids.get(prompt.id) ?? prompt.id,
      variants: prompt.variants.map((variant) => ({ ...variant }))
    })),
    ...added
  ]
  let version = 0
  db.transaction(() => {
    version = nextPromptSetVersion(db, pageId)
    insertPromptSet(
      db,
      {
        id: `pset-${host.createId()}`,
        pageId,
        version,
        savedAt: now,
        icpId,
        templateId: active?.templateId ?? null,
        templateName: active?.templateName ?? null,
        templateHash: active?.templateHash ?? null,
        templateUpdatedAt: active?.templateUpdatedAt ?? null,
        prompts
      },
      brands
    )
    insertPromptLineage(
      db,
      carried.map((prompt) => ({
        promptId: ids.get(prompt.id) ?? prompt.id,
        previousPromptId: prompt.id,
        pageId,
        createdAt: now
      }))
    )
    if (topic) {
      const previous = active?.promptSetId ? listTopicPrompts(db, active.promptSetId) : []
      insertTopicPrompts(db, [
        ...previous.map((row) => ({ ...row, promptId: ids.get(row.promptId) ?? row.promptId })),
        ...added.map((prompt, index) => topicRow(host, pageId, prompt.id, fresh[index]))
      ])
      updateStoredPage(db, pageId, projectId, {
        promptCount: Math.min(MAX_PROMPT_COUNT, prompts.length)
      })
    }
  })()
  return { promptIds: added.map((prompt) => prompt.id), version, savedAt: now }
}

/** `prompts:textRules`: what a new question on this page or topic is checked against. */
export function questionTextRules(
  host: EngineHost,
  request: PageIdRequest
): Promise<PromptTextRules> {
  const channel = 'prompts:textRules'
  return withProject(host, request.projectId, channel, (opened) => {
    const page = requirePage(opened.db, request.pageId, request.projectId, channel)
    return rulesOfKind(page.kind === 'topic' ? 'question' : 'buyer_prompt', brandNames(opened.db))
  })
}

function requireTracked(page: PageSummary, topic: boolean, channel: string): void {
  if (page.status === 'tracked' || page.status === 'paused') return
  const noun = topic ? 'topic' : 'page'
  throw new IpcRequestError(
    channel,
    page.status === 'removed'
      ? `This ${noun} was removed. Track it again before adding questions.`
      : `Track this ${noun} first, then add questions to it.`
  )
}

/**
 * The questions to add, in request order, with repeats of a saved question or of an
 * earlier line skipped: the same words (case, punctuation and spacing aside), or the
 * same question with only a year, an article or a plural changed (`questionMergeKey`). Every new one passes the page's or topic's text checks; the
 * first that does not stops the whole add, naming the question.
 */
function pickNew(
  carried: readonly BuyerPrompt[],
  questions: readonly NewQuestion[],
  rules: PromptTextRules
): { fresh: NewQuestion[]; skipped: string[] } {
  const seen = new Set<string>()
  const near = new Set<string>()
  for (const prompt of carried) {
    for (const variant of prompt.variants) {
      seen.add(normaliseQuestion(variant.text))
      near.add(questionMergeKey(variant.text))
    }
  }
  const fresh: NewQuestion[] = []
  const skipped: string[] = []
  for (const question of questions) {
    const text = question.text.replace(/\s+/gu, ' ').trim()
    if (text.length === 0) continue
    const key = normaliseQuestion(text)
    const merge = questionMergeKey(text)
    if (key.length === 0 || seen.has(key) || (merge.length > 0 && near.has(merge))) {
      skipped.push(text)
      continue
    }
    const problem = textProblem(text, rules)
    if (problem !== null) {
      throw new PipelineError(`${problem.message} ("${clip(text)}")`, {
        code: problem.code,
        nextStep: 'Change that question, or take it out, and add again.'
      })
    }
    seen.add(key)
    if (merge.length > 0) near.add(merge)
    fresh.push({ ...question, text })
  }
  return { fresh, skipped }
}

function newPrompt(
  host: EngineHost,
  question: NewQuestion,
  position: number,
  markets: readonly Market[],
  topic: boolean
): BuyerPrompt {
  const mapped = question.mappedElement?.trim() ?? ''
  return {
    id: `prompt-${host.createId()}`,
    position,
    // A topic question's label is its wording (topics/start.ts); a page prompt gets a short name.
    label: topic ? question.text.slice(0, 160).trimEnd() : shortLabel(question.text),
    source: question.source ?? 'written_by_user',
    intentStage: question.intentStage ?? 'unset',
    mappedElement: (mapped || (topic ? 'Topic' : UNMAPPED)).slice(0, 300).trimEnd(),
    enabled: true,
    variants: markets.map((market) => ({
      marketId: market.id,
      language: market.language,
      text: question.text,
      originalText: null
    }))
  }
}

/**
 * A topic question added here: written by the user or suggested by Claude with no
 * target page yet, or an imported row with its own stage, kind and target page.
 */
function topicRow(
  host: EngineHost,
  pageId: string,
  promptId: string,
  question: NewQuestion | undefined
): TopicPromptRecord {
  const suggested = question?.source !== undefined && question.source !== 'written_by_user'
  const facts = question?.topic ?? null
  const target = facts?.targetUrl ?? null
  return {
    promptId,
    pageId,
    stableKey: `tp-${host.createId()}`,
    kind: facts?.kind ?? 'question',
    stage: facts?.stage ?? null,
    source: facts?.origin ?? (suggested ? 'claude' : 'user'),
    sourceNote: facts?.note ?? null,
    kwGroup: null,
    kwGroupKind: null,
    intent: null,
    funnel: null,
    pageType: null,
    targetPageId: target === null ? null : (facts?.targetPageId ?? null),
    targetUrl: target,
    matchConfidence: null,
    matchReason: target === null ? null : 'Set when the question was imported.',
    matchSetBy: target === null ? null : 'user',
    matchConfirmed: target !== null
  }
}

function shortLabel(text: string): string {
  return text.length <= LABEL_MAX ? text : `${text.slice(0, LABEL_MAX - 1).trimEnd()}…`
}

function clip(text: string): string {
  return text.length <= 80 ? text : `${text.slice(0, 79).trimEnd()}…`
}

function brandNames(db: SqliteDatabase): string[] {
  return [...(readProjectProfile(db)?.brandNames ?? [])]
}
