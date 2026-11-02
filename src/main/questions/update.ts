import type { BuyerPrompt, PromptSetView } from '@shared/domain'
import type {
  QuestionRestorePoint,
  QuestionUpdateAction,
  QuestionsUpdateRequest,
  QuestionsUpdateResult
} from '@shared/ipc'
import { pageKey, type EngineHost } from '../engine/host'
import { withProject } from '../engine/project-db'
import { getLatestBuyerProfile, getLatestPromptSet } from '../storage/content-records'
import type { SqliteDatabase } from '../storage/database'
import { getPage } from '../storage/pages'
import { insertPromptSet, nextPromptSetVersion } from '../storage/prompt-set-records'
import { insertPromptLineage } from '../storage/prompt-lineage'
import { readProjectProfile } from '../storage/project-profile'
import { insertTopicPrompts, listTopicPrompts, type TopicPromptRecord } from '../topics/records'

const DONE: Readonly<Record<QuestionUpdateAction, string>> = {
  disable: 'Disabled',
  enable: 'Enabled',
  remove: 'Removed'
}

/**
 * `questions:update`. Each affected page or topic is saved once, as a new prompt-set
 * version with the questions disabled, enabled or removed, the way "Edit question"
 * saves one wording (`prompts:reword`): every prompt gets a new id and a lineage row
 * back to its old id, so earlier results stay with the version they were checked with
 * and the Questions screen still finds them. A topic's questions keep their stable keys
 * (the wording did not change), so the topic's results and batches follow them.
 */
export function updateQuestions(
  host: EngineHost,
  request: QuestionsUpdateRequest
): Promise<QuestionsUpdateResult> {
  const channel = 'questions:update'
  return withProject(host, request.projectId, channel, (opened) => {
    const { db } = opened
    const brands = [...(readProjectProfile(db)?.brandNames ?? [])]
    const bySource = new Map<string, Set<string>>()
    for (const item of request.items) {
      const set = bySource.get(item.sourceId) ?? new Set<string>()
      set.add(item.promptId)
      bySource.set(item.sourceId, set)
    }
    let changed = 0
    const skipped: { sourceId: string; reason: string }[] = []
    const restore: QuestionRestorePoint[] = []
    for (const [sourceId, promptIds] of bySource) {
      const outcome = updateSource(host, db, request, sourceId, promptIds, brands)
      if (typeof outcome === 'string') skipped.push({ sourceId, reason: outcome })
      else {
        changed += outcome.changed
        if (outcome.restore !== null) restore.push(outcome.restore)
      }
    }
    return {
      changed,
      skipped,
      message: message(request.action, changed, skipped.length),
      restore
    }
  })
}

/** The number of questions changed and how to undo it, or why the source was skipped. */
function updateSource(
  host: EngineHost,
  db: SqliteDatabase,
  request: QuestionsUpdateRequest,
  sourceId: string,
  promptIds: ReadonlySet<string>,
  brands: readonly string[]
): { changed: number; restore: QuestionRestorePoint | null } | string {
  const page = getPage(db, sourceId, request.projectId)
  if (page === null) return 'That page or topic was not found.'
  const noun = page.kind === 'topic' ? 'topic' : 'page'
  if (host.memory.drafts.has(pageKey(request.projectId, sourceId))) {
    return `This ${noun} has unsaved prompt edits on its Prompts tab. Save or discard them there first.`
  }
  const active = getLatestPromptSet(db, sourceId, brands)
  if (active === null || active.promptSetId === null || active.version === null) {
    return `This ${noun} has no saved questions.`
  }
  const targets = active.prompts.filter((prompt) => promptIds.has(prompt.id))
  if (targets.length === 0) return 'Those questions are older versions. Reload and try again.'
  const affected = targets.filter((prompt) =>
    request.action === 'remove' ? true : prompt.enabled !== (request.action === 'enable')
  )
  if (affected.length === 0) return { changed: 0, restore: null }
  const kept =
    request.action === 'remove'
      ? active.prompts.filter((prompt) => !promptIds.has(prompt.id))
      : active.prompts
  if (kept.length === 0) {
    return `A ${noun} needs at least one question. Keep one, or stop tracking the ${noun}.`
  }
  const icpId = active.icpId ?? getLatestBuyerProfile(db, sourceId)?.id ?? null
  if (icpId === null) return `This ${noun} has no buyer profile to save its questions with.`
  const saved = saveVersion(host, db, active, kept, icpId, brands, (prompt) => ({
    ...prompt,
    enabled:
      request.action === 'remove' || !promptIds.has(prompt.id)
        ? prompt.enabled
        : request.action === 'enable'
  }))
  return {
    changed: affected.length,
    restore: { sourceId, promptSetId: active.promptSetId, replacedBy: saved.promptSetId }
  }
}

export interface SavedVersion {
  promptSetId: string
  /** Old prompt id → new prompt id. */
  ids: ReadonlyMap<string, string>
}

/**
 * Saves `kept` (in order) as the source's next prompt-set version: each prompt gets a
 * new id and a lineage row back to its old one, `change` may rewrite a prompt (its
 * id is replaced after), and a topic's rows carry over (`topicRow` may rewrite one).
 */
export function saveVersion(
  host: EngineHost,
  db: SqliteDatabase,
  active: PromptSetView,
  kept: readonly BuyerPrompt[],
  icpId: string,
  brands: readonly string[],
  change: (prompt: BuyerPrompt) => BuyerPrompt,
  topicRow: (row: TopicPromptRecord) => TopicPromptRecord = (row) => row
): SavedVersion {
  const now = host.now().toISOString()
  const promptSetId = `pset-${host.createId()}`
  const ids = new Map(kept.map((prompt) => [prompt.id, `prompt-${host.createId()}`]))
  const prompts: BuyerPrompt[] = kept.map((prompt, index) => {
    const changed = change(prompt)
    return {
      ...changed,
      id: ids.get(prompt.id) ?? prompt.id,
      position: index + 1,
      variants: changed.variants.map((variant) => ({ ...variant }))
    }
  })
  db.transaction(() => {
    insertPromptSet(
      db,
      {
        id: promptSetId,
        pageId: active.pageId,
        version: nextPromptSetVersion(db, active.pageId),
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
      kept.map((prompt) => ({
        promptId: ids.get(prompt.id) ?? prompt.id,
        previousPromptId: prompt.id,
        pageId: active.pageId,
        createdAt: now
      }))
    )
    if (active.promptSetId === null) return
    const topicRows = listTopicPrompts(db, active.promptSetId)
    if (topicRows.length === 0) return
    insertTopicPrompts(
      db,
      topicRows.flatMap((row) => {
        const next = ids.get(row.promptId)
        return next === undefined ? [] : [{ ...topicRow(row), promptId: next }]
      })
    )
  })()
  return { promptSetId, ids }
}

function message(action: QuestionUpdateAction, changed: number, skipped: number): string {
  const done =
    changed === 0
      ? 'Nothing changed.'
      : `${DONE[action]} ${changed.toLocaleString('en-US')} ${changed === 1 ? 'question' : 'questions'}.`
  if (skipped === 0) return done
  return `${done} ${skipped.toLocaleString('en-US')} ${skipped === 1 ? 'page or topic was' : 'pages or topics were'} skipped.`
}
