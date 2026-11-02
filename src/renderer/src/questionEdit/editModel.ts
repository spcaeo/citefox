import type { IntentStage, PromptSource, TopicStage } from '@shared/domain'
import type { QuestionDetail, QuestionEditRequest } from '@shared/ipc'
import { textProblem } from '../promptDetail/edit/model'

/** What the edit drawer holds while it is open. */
export interface EditForm {
  /** Wording by market id. */
  texts: Readonly<Record<string, string>>
  /** One wording for every market: typing in one tab writes them all. */
  sameEverywhere: boolean
  label: string
  source: PromptSource
  intentStage: IntentStage
  topicStage: TopicStage | null
  enabled: boolean
}

export function formFrom(detail: QuestionDetail): EditForm {
  const texts: Record<string, string> = {}
  for (const wording of detail.wordings) texts[wording.marketId] = wording.text
  const unique = new Set(detail.wordings.map((wording) => wording.text))
  return {
    texts,
    sameEverywhere: unique.size <= 1,
    label: detail.label,
    source: detail.source,
    intentStage: detail.intentStage,
    topicStage: detail.topicStage,
    enabled: detail.enabled
  }
}

/** Sets one market's wording, or every market's while `sameEverywhere` is on. */
export function withText(form: EditForm, marketId: string, text: string): EditForm {
  if (!form.sameEverywhere) return { ...form, texts: { ...form.texts, [marketId]: text } }
  const texts: Record<string, string> = {}
  for (const key of Object.keys(form.texts)) texts[key] = text
  return { ...form, texts }
}

/** Turning "same everywhere" on copies the shown market's wording to every market. */
export function withSameEverywhere(form: EditForm, on: boolean, fromMarketId: string): EditForm {
  const next = { ...form, sameEverywhere: on }
  return on ? withText(next, fromMarketId, form.texts[fromMarketId] ?? '') : next
}

/** True for a page's buyer prompt (it has a name and an intent stage of its own). */
export function isPagePrompt(detail: QuestionDetail): boolean {
  return detail.rules.kind === 'buyer_prompt'
}

/** The wording problem per market (null when fine), checked only where it changed. */
export function wordingProblems(
  detail: QuestionDetail,
  form: EditForm
): Readonly<Record<string, string | null>> {
  const out: Record<string, string | null> = {}
  for (const wording of detail.wordings) {
    const text = form.texts[wording.marketId] ?? ''
    out[wording.marketId] = text.trim() === wording.text ? null : textProblem(text, detail.rules)
  }
  return out
}

/** The request that saves the form, or null when nothing changed. */
export function editRequest(detail: QuestionDetail, form: EditForm): QuestionEditRequest | null {
  const texts = detail.wordings.flatMap((wording) => {
    const text = (form.texts[wording.marketId] ?? '').trim()
    return text === wording.text ? [] : [{ marketId: wording.marketId, text }]
  })
  const page = isPagePrompt(detail)
  const label = form.label.trim()
  const request: {
    -readonly [K in keyof QuestionEditRequest]: QuestionEditRequest[K]
  } = { projectId: detail.projectId, sourceId: detail.sourceId, promptId: detail.promptId }
  let changed = false
  if (texts.length > 0) {
    request.texts = texts
    changed = true
  }
  if (page && label !== detail.label) {
    request.label = label
    changed = true
  }
  if (form.source !== detail.source) {
    request.source = form.source
    changed = true
  }
  if (page && form.intentStage !== detail.intentStage) {
    request.intentStage = form.intentStage
    changed = true
  }
  if (!page && detail.topicKind !== null && form.topicStage !== detail.topicStage) {
    request.topicStage = form.topicStage
    changed = true
  }
  if (form.enabled !== detail.enabled) {
    request.enabled = form.enabled
    changed = true
  }
  return changed ? request : null
}

/** "2 changes" for the footer. */
export function changeCount(request: QuestionEditRequest | null): number {
  if (request === null) return 0
  const { texts, label, source, intentStage, topicStage, enabled } = request
  return (
    (texts?.length ?? 0) +
    [label, source, intentStage, topicStage, enabled].filter((value) => value !== undefined).length
  )
}

/** A save is blocked by an empty name or a wording problem. */
export function blockingProblem(detail: QuestionDetail, form: EditForm): string | null {
  if (isPagePrompt(detail) && form.label.trim().length === 0) return 'Give the question a name.'
  const problems = Object.values(wordingProblems(detail, form)).filter(
    (problem): problem is string => problem !== null
  )
  return problems[0] ?? null
}
