import type { BuyerPrompt, PromptSetView } from '@shared/domain'
import type {
  PromptIdRequest,
  PromptTextRules,
  PromptVersions,
  PromptVersionStep,
  RewordPromptRequest,
  RewordPromptResult
} from '@shared/ipc'
import { IpcRequestError } from '../ipc-request'
import { PipelineError, type ValidationProblem } from '../pipeline/errors'
import { BUYER_PROMPT_MAX_WORDS, BUYER_PROMPT_MIN_WORDS } from '../pipeline/schemas'
import { buyerPromptTextProblem } from '../pipeline/validate'
import { getLatestBuyerProfile, getLatestPromptSet } from '../storage/content-records'
import type { SqliteDatabase } from '../storage/database'
import { insertPromptSet, nextPromptSetVersion } from '../storage/prompt-set-records'
import {
  insertPromptLineage,
  nextPromptIds,
  previousPromptId,
  readPromptVersion,
  type StoredPromptVersion
} from '../storage/prompt-lineage'
import { readProjectProfile } from '../storage/project-profile'
import { insertTopicPrompts, listTopicPrompts, renamePendingBatchKey } from '../topics/records'
import { MAX_QUESTION_WORDS, namesBrand, wordCount } from '../topics/text'
import type { EngineHost } from './host'
import { pageKey } from './host'
import { requirePage } from './page-access'
import { withProject } from './project-db'

/** Versions walked back (or forward) at most, so a damaged chain cannot loop. */
const MAX_STEPS = 200

/**
 * `prompts:reword`. Writes a new prompt-set version that is the active set with one
 * prompt's wording changed. Every prompt gets a new id (as any saved version does) and
 * a `prompt_lineage` row back to its old id, so earlier results stay with the wording
 * they were checked with. A topic's question also gets a new stable key: the topic's
 * results follow questions by that key, and the old wording's result must not show as
 * the new wording's. Its target page and other topic facts carry over.
 */
export function rewordPrompt(
  host: EngineHost,
  request: RewordPromptRequest
): Promise<RewordPromptResult> {
  const channel = 'prompts:reword'
  return withProject(host, request.projectId, channel, (opened) => {
    const { db } = opened
    const { pageId, promptId } = request
    requirePage(db, pageId, request.projectId, channel)
    if (host.memory.drafts.has(pageKey(request.projectId, pageId))) {
      throw new IpcRequestError(
        channel,
        'This page has unsaved prompt edits on its Prompts tab. Save or discard them there first, then edit this question.'
      )
    }
    const brands = brandNames(db)
    const active = getLatestPromptSet(db, pageId, brands)
    const target = active?.prompts.find((prompt) => prompt.id === promptId)
    if (active === null || active.promptSetId === null || active.version === null || !target) {
      throw new IpcRequestError(
        channel,
        'This is an older version of the prompt. Open its current wording to edit it.'
      )
    }
    if (!target.variants.some((variant) => variant.marketId === request.marketId)) {
      throw new IpcRequestError(channel, 'That market is not on this prompt.')
    }
    const text = request.text.trim()
    const edits = (marketId: string): boolean => request.allMarkets || marketId === request.marketId
    const unchanged = target.variants.every(
      (variant) => !edits(variant.marketId) || variant.text === text
    )
    const rules = textRules(db, promptId, brands)
    const problem = unchanged ? null : textProblem(text, rules)
    if (problem !== null) {
      throw new PipelineError(problem.message, {
        code: problem.code,
        nextStep: 'Change the wording and save again.'
      })
    }
    if (unchanged) {
      return {
        pageId,
        promptId,
        previousPromptId: promptId,
        changed: false,
        version: active.version,
        savedAt: active.savedAt ?? host.now().toISOString()
      }
    }
    const icpId = active.icpId ?? getLatestBuyerProfile(db, pageId)?.id ?? null
    if (icpId === null) {
      throw new IpcRequestError(channel, 'Write the buyer profile before editing prompts.')
    }
    const now = host.now().toISOString()
    const ids = new Map(active.prompts.map((prompt) => [prompt.id, `prompt-${host.createId()}`]))
    const topic = rules.kind !== 'buyer_prompt'
    const prompts: BuyerPrompt[] = active.prompts.map((prompt) => ({
      ...prompt,
      id: ids.get(prompt.id) ?? prompt.id,
      // A topic question's label is its wording (topics/start.ts); a page prompt keeps its short name.
      label: prompt.id === promptId && topic ? text.slice(0, 160).trimEnd() : prompt.label,
      variants: prompt.variants.map((variant) =>
        prompt.id === promptId && edits(variant.marketId)
          ? { ...variant, text, originalText: null }
          : { ...variant }
      )
    }))
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
          templateId: active.templateId,
          templateName: active.templateName,
          templateHash: active.templateHash,
          templateUpdatedAt: active.templateUpdatedAt,
          prompts
        },
        brands
      )
      insertPromptLineage(
        db,
        active.prompts.map((prompt) => ({
          promptId: ids.get(prompt.id) ?? prompt.id,
          previousPromptId: prompt.id,
          pageId,
          createdAt: now
        }))
      )
      carryTopicPrompts(db, host, active, ids, promptId)
    })()
    return {
      pageId,
      promptId: ids.get(promptId) ?? promptId,
      previousPromptId: promptId,
      changed: true,
      version,
      savedAt: now
    }
  })
}

/** `prompts:versions`. Reads saved prompt sets only. */
export function promptVersions(
  host: EngineHost,
  request: PromptIdRequest
): Promise<PromptVersions> {
  const channel = 'prompts:versions'
  return withProject(host, request.projectId, channel, (opened) => {
    const { db } = opened
    requirePage(db, request.pageId, request.projectId, channel)
    const first = readPromptVersion(db, request.pageId, request.promptId)
    if (first === null) throw new IpcRequestError(channel, 'That prompt was not found')
    const steps: StoredPromptVersion[] = [first]
    const seen = new Set([first.promptId])
    for (let id = previousPromptId(db, first.promptId); id !== null && steps.length < MAX_STEPS;) {
      if (seen.has(id)) break
      seen.add(id)
      const step = readPromptVersion(db, request.pageId, id)
      if (step === null) break
      steps.push(step)
      id = previousPromptId(db, id)
    }
    return {
      pageId: request.pageId,
      promptId: first.promptId,
      active: first.active,
      currentPromptId: first.active ? null : currentVersion(db, request.pageId, first.promptId),
      steps: steps.map(toStep),
      rules: textRules(db, first.promptId, brandNames(db))
    }
  })
}

/**
 * Links the prompts of a version saved from the Prompts tab to the ones they were
 * edited from. Draft prompts keep their saved ids until the save gives them new ones;
 * a prompt added in the draft has no saved id and gets no row.
 */
export function linkSavedPrompts(
  db: SqliteDatabase,
  pageId: string,
  previousIds: readonly string[],
  saved: PromptSetView,
  createdAt: string
): void {
  insertPromptLineage(
    db,
    saved.prompts.flatMap((prompt, index) => {
      const previous = previousIds[index]
      return previous === undefined
        ? []
        : [{ promptId: prompt.id, previousPromptId: previous, pageId, createdAt }]
    })
  )
}

function toStep(step: StoredPromptVersion): PromptVersionStep {
  return {
    promptId: step.promptId,
    promptSetVersion: step.version,
    savedAt: step.savedAt,
    texts: step.texts
  }
}

/** The prompt carried from this one into the active set, following the chain forward. */
export function currentVersion(
  db: SqliteDatabase,
  pageId: string,
  promptId: string
): string | null {
  const queue = nextPromptIds(db, promptId)
  const seen = new Set([promptId])
  while (queue.length > 0 && seen.size < MAX_STEPS) {
    const id = queue.shift()
    if (id === undefined || seen.has(id)) continue
    seen.add(id)
    const step = readPromptVersion(db, pageId, id)
    if (step?.active) return id
    queue.push(...nextPromptIds(db, id))
  }
  return null
}

export function textRules(
  db: SqliteDatabase,
  promptId: string,
  brands: readonly string[]
): PromptTextRules {
  const row = db
    .prepare<unknown[], { kind: string }>('SELECT kind FROM topic_prompts WHERE prompt_id = ?')
    .get(promptId)
  if (row === undefined) return rulesOfKind('buyer_prompt', brands)
  return rulesOfKind(row.kind === 'keyword' ? 'keyword' : 'question', brands)
}

/** A buyer prompt's word limits (Prompts tab), or a topic question's or keyword's. */
export function rulesOfKind(
  kind: PromptTextRules['kind'],
  brands: readonly string[]
): PromptTextRules {
  if (kind === 'buyer_prompt') {
    return { kind, minWords: BUYER_PROMPT_MIN_WORDS, maxWords: BUYER_PROMPT_MAX_WORDS, brands }
  }
  return { kind, minWords: 1, maxWords: MAX_QUESTION_WORDS, brands }
}

/** The Prompts tab's checks for a buyer prompt; the topic rules for a question or keyword. */
export function textProblem(text: string, rules: PromptTextRules): ValidationProblem | null {
  if (text.length === 0) {
    return { code: 'schema_validation', message: 'Write the wording before saving.' }
  }
  if (rules.kind === 'buyer_prompt') return buyerPromptTextProblem(text, rules.brands)
  const noun = rules.kind === 'keyword' ? 'keyword' : 'question'
  const words = wordCount(text)
  if (words > rules.maxWords) {
    return {
      code: 'schema_validation',
      message: `The ${noun} is ${words} words. Google reads at most ${rules.maxWords}, so keep it to ${rules.maxWords} or fewer.`
    }
  }
  if (namesBrand(text, rules.brands)) {
    return {
      code: 'brand_in_prompt',
      message: `The ${noun} names your brand. Write it as a buyer who has not found you yet would.`
    }
  }
  return null
}

/** Copies the topic facts to the new prompt ids; the reworded question gets a new stable key. */
function carryTopicPrompts(
  db: SqliteDatabase,
  host: EngineHost,
  active: PromptSetView,
  ids: ReadonlyMap<string, string>,
  promptId: string
): void {
  if (active.promptSetId === null) return
  const rows = listTopicPrompts(db, active.promptSetId)
  if (rows.length === 0) return
  const edited = rows.find((row) => row.promptId === promptId)
  const key = edited === undefined ? null : `tp-${host.createId()}`
  insertTopicPrompts(
    db,
    rows.map((row) => ({
      ...row,
      promptId: ids.get(row.promptId) ?? row.promptId,
      stableKey: row.promptId === promptId && key !== null ? key : row.stableKey
    }))
  )
  if (edited !== undefined && key !== null) {
    renamePendingBatchKey(db, active.pageId, edited.stableKey, key)
  }
}

function brandNames(db: SqliteDatabase): string[] {
  return [...(readProjectProfile(db)?.brandNames ?? [])]
}
