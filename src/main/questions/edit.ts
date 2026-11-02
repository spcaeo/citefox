import type { BuyerPrompt, PageSummary, PromptSetView } from '@shared/domain'
import type {
  QuestionDetail,
  QuestionEditRequest,
  QuestionEditResult,
  QuestionGetRequest,
  QuestionsRestoreRequest,
  QuestionsRestoreResult
} from '@shared/ipc'
import { askMarketLabel, askPageLabel } from '../ask/query'
import { pageKey, type EngineHost } from '../engine/host'
import { currentVersion, textProblem, textRules } from '../engine/prompt-reword'
import { withProject } from '../engine/project-db'
import { IpcRequestError } from '../ipc-request'
import { PipelineError } from '../pipeline/errors'
import { getLatestBuyerProfile, getLatestPromptSet } from '../storage/content-records'
import type { SqliteDatabase } from '../storage/database'
import { getPage } from '../storage/pages'
import { activatePromptSet } from '../storage/prompt-set-records'
import { listMarkets, readProjectProfile } from '../storage/project-profile'
import { listTopicPrompts, renamePendingBatchKey } from '../topics/records'
import { saveVersion } from './update'

function brandsOf(db: SqliteDatabase): string[] {
  return [...(readProjectProfile(db)?.brandNames ?? [])]
}

function sourceName(page: PageSummary): string {
  if (page.kind === 'topic') return page.title ?? page.label ?? 'Topic'
  return askPageLabel(page)
}

function requireSource(
  db: SqliteDatabase,
  projectId: string,
  sourceId: string,
  channel: string
): PageSummary {
  const page = getPage(db, sourceId, projectId)
  if (page === null) throw new IpcRequestError(channel, 'That page or topic was not found.')
  return page
}

/** The active set and the question in it (following an older id forward). */
function activeQuestion(
  db: SqliteDatabase,
  sourceId: string,
  promptId: string,
  channel: string
): { active: PromptSetView; prompt: BuyerPrompt; requestedWasOld: boolean } {
  const active = getLatestPromptSet(db, sourceId, brandsOf(db))
  if (active === null || active.promptSetId === null || active.version === null) {
    throw new IpcRequestError(channel, 'This page or topic has no saved questions.')
  }
  const direct = active.prompts.find((prompt) => prompt.id === promptId)
  if (direct) return { active, prompt: direct, requestedWasOld: false }
  const current = currentVersion(db, sourceId, promptId)
  const carried = current === null ? undefined : active.prompts.find((p) => p.id === current)
  if (!carried) {
    throw new IpcRequestError(
      channel,
      'That question is no longer tracked. It was removed or moved after this version.'
    )
  }
  return { active, prompt: carried, requestedWasOld: true }
}

/** `questions:get`. Reads saved data only. */
export function getQuestion(
  host: EngineHost,
  request: QuestionGetRequest
): Promise<QuestionDetail> {
  const channel = 'questions:get'
  return withProject(host, request.projectId, channel, (opened) => {
    const { db } = opened
    const page = requireSource(db, request.projectId, request.sourceId, channel)
    const { active, prompt, requestedWasOld } = activeQuestion(
      db,
      request.sourceId,
      request.promptId,
      channel
    )
    const markets = listMarkets(db)
    const order = new Map(markets.map((market, index) => [market.id, index]))
    const defaultId = page.defaultMarketId ?? markets[0]?.id ?? null
    const row =
      active.promptSetId === null
        ? undefined
        : listTopicPrompts(db, active.promptSetId).find((item) => item.promptId === prompt.id)
    const wordings = prompt.variants
      .map((variant) => {
        const market = markets.find((item) => item.id === variant.marketId)
        return {
          marketId: variant.marketId,
          marketLabel: market ? askMarketLabel(market) : variant.marketId,
          isDefault: variant.marketId === defaultId,
          text: variant.text
        }
      })
      .sort((left, right) => {
        if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1
        return (order.get(left.marketId) ?? 999) - (order.get(right.marketId) ?? 999)
      })
    return {
      projectId: request.projectId,
      sourceId: request.sourceId,
      sourceKind: page.kind ?? 'page',
      sourceName: sourceName(page),
      sourceUrl: page.url,
      promptId: prompt.id,
      active: true,
      currentPromptId: requestedWasOld ? prompt.id : null,
      label: prompt.label,
      source: prompt.source,
      intentStage: prompt.intentStage,
      topicStage: row?.stage ?? null,
      topicKind: row?.kind ?? null,
      enabled: prompt.enabled,
      wordings,
      rules: textRules(db, prompt.id, brandsOf(db)),
      draftOpen: host.memory.drafts.has(pageKey(request.projectId, request.sourceId))
    }
  })
}

/** `questions:edit`. One new version with every change, or nothing when nothing changed. */
export function editQuestion(
  host: EngineHost,
  request: QuestionEditRequest
): Promise<QuestionEditResult> {
  const channel = 'questions:edit'
  return withProject(host, request.projectId, channel, (opened) => {
    const { db } = opened
    const { sourceId } = request
    const page = requireSource(db, request.projectId, sourceId, channel)
    const noun = page.kind === 'topic' ? 'topic' : 'page'
    if (host.memory.drafts.has(pageKey(request.projectId, sourceId))) {
      throw new IpcRequestError(
        channel,
        `This ${noun} has unsaved prompt edits on its Prompts tab. Save or discard them there first.`
      )
    }
    const brands = brandsOf(db)
    const { active, prompt } = activeQuestion(db, sourceId, request.promptId, channel)
    const activeSetId = active.promptSetId ?? ''
    const rules = textRules(db, prompt.id, brands)
    const topic = rules.kind !== 'buyer_prompt'
    const texts = new Map<string, string>()
    for (const entry of request.texts ?? []) {
      const variant = prompt.variants.find((item) => item.marketId === entry.marketId)
      if (!variant) throw new IpcRequestError(channel, 'That market is not on this question.')
      const text = entry.text.trim()
      if (text === variant.text) continue
      const problem = textProblem(text, rules)
      if (problem !== null) {
        throw new PipelineError(problem.message, {
          code: problem.code,
          nextStep: 'Change the wording and save again.'
        })
      }
      texts.set(entry.marketId, text)
    }
    const rows = listTopicPrompts(db, activeSetId)
    const row = rows.find((item) => item.promptId === prompt.id)
    const label = topic ? undefined : request.label?.trim()
    if (label !== undefined && (label.length === 0 || label.length > 160)) {
      throw new IpcRequestError(channel, 'Give the question a short name of 1 to 160 characters.')
    }
    const stageChanged =
      topic &&
      row !== undefined &&
      request.topicStage !== undefined &&
      request.topicStage !== row.stage
    const promptChanged =
      texts.size > 0 ||
      (label !== undefined && label !== prompt.label) ||
      (request.source !== undefined && request.source !== prompt.source) ||
      (!topic && request.intentStage !== undefined && request.intentStage !== prompt.intentStage) ||
      (request.enabled !== undefined && request.enabled !== prompt.enabled)
    if (!promptChanged && !stageChanged) {
      return {
        sourceId,
        promptId: prompt.id,
        previousPromptId: prompt.id,
        changed: false,
        restore: null,
        message: 'Nothing changed.'
      }
    }
    const icpId = active.icpId ?? getLatestBuyerProfile(db, sourceId)?.id ?? null
    if (icpId === null) {
      throw new IpcRequestError(
        channel,
        `This ${noun} has no buyer profile to save its questions with.`
      )
    }
    const firstText = texts.get(prompt.variants[0]?.marketId ?? '')
    const newKey = texts.size > 0 && row !== undefined ? `tp-${host.createId()}` : null
    const saved = saveVersion(
      host,
      db,
      active,
      active.prompts,
      icpId,
      brands,
      (item) =>
        item.id !== prompt.id
          ? item
          : {
              ...item,
              // A topic question's label is its wording (as `prompts:reword` keeps it).
              label:
                topic && firstText !== undefined
                  ? firstText.slice(0, 160).trimEnd()
                  : (label ?? item.label),
              source: request.source ?? item.source,
              intentStage: topic ? item.intentStage : (request.intentStage ?? item.intentStage),
              enabled: request.enabled ?? item.enabled,
              variants: item.variants.map((variant) => {
                const text = texts.get(variant.marketId)
                return text === undefined ? variant : { ...variant, text, originalText: null }
              })
            },
      (topicRow) =>
        topicRow.promptId !== prompt.id
          ? topicRow
          : {
              ...topicRow,
              stableKey: newKey ?? topicRow.stableKey,
              stage: stageChanged ? (request.topicStage ?? null) : topicRow.stage
            }
    )
    if (row !== undefined && newKey !== null) {
      renamePendingBatchKey(db, sourceId, row.stableKey, newKey)
    }
    return {
      sourceId,
      promptId: saved.ids.get(prompt.id) ?? prompt.id,
      previousPromptId: prompt.id,
      changed: true,
      restore: { sourceId, promptSetId: activeSetId, replacedBy: saved.promptSetId },
      message: 'Saved the question.'
    }
  })
}

/** `questions:restore`. Undo: the version before a change becomes active again. */
export function restoreQuestions(
  host: EngineHost,
  request: QuestionsRestoreRequest
): Promise<QuestionsRestoreResult> {
  const channel = 'questions:restore'
  return withProject(host, request.projectId, channel, (opened) => {
    const { db } = opened
    const brands = brandsOf(db)
    const skipped: { sourceId: string; reason: string }[] = []
    let restored = 0
    for (const point of request.points) {
      const page = getPage(db, point.sourceId, request.projectId)
      if (page === null) {
        skipped.push({ sourceId: point.sourceId, reason: 'That page or topic was not found.' })
        continue
      }
      const active = getLatestPromptSet(db, point.sourceId, brands)
      if (active?.promptSetId !== point.replacedBy) {
        skipped.push({
          sourceId: point.sourceId,
          reason: 'Its questions changed again since, so it was left as it is.'
        })
        continue
      }
      if (activatePromptSet(db, point.sourceId, point.promptSetId, brands) === null) {
        skipped.push({ sourceId: point.sourceId, reason: 'That earlier version was not found.' })
        continue
      }
      host.memory.drafts.delete(pageKey(request.projectId, point.sourceId))
      restored += 1
    }
    const done =
      restored === 0
        ? 'Nothing was undone.'
        : `Undone on ${restored.toLocaleString('en-US')} ${restored === 1 ? 'page or topic' : 'pages and topics'}.`
    const rest = skipped.length === 0 ? '' : ` ${skipped[0]?.reason ?? ''}`
    return { restored, skipped, message: `${done}${rest}` }
  })
}
