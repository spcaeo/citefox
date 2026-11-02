import type { EngineAnswerStatus, EngineId, TopicPromptKind, TopicStage } from '@shared/domain'
import type { CheckInFlightItem, CheckItemRef, CheckJob, CheckLastDone } from '@shared/ipc'
import type { SqliteDatabase } from '../../storage/database'
import { listTopicPrompts } from '../../topics/records'
import type { PagePlan } from './plan'

/**
 * The questions a running check is searching right now (owner, 2026-10-29: "if there are
 * three processes, why don't we show these three processes?" and "what is that
 * searching?"). Kept in memory per job object; every `checks:progress` carries the list,
 * so the Check window and the topic page can name each question, its words, and which
 * engines have answered so far.
 */
interface Activity {
  items: Map<string, CheckInFlightItem>
  /** Per question, over all its samples: some engine answered, and some cited us. */
  outcomes: Map<string, { answered: boolean; cited: boolean }>
  lastDone: CheckLastDone | null
  domain: string | null
}

const activity = new WeakMap<CheckJob, Activity>()

function of(job: CheckJob): Activity {
  const found = activity.get(job)
  if (found !== undefined) return found
  const created: Activity = { items: new Map(), outcomes: new Map(), lastDone: null, domain: null }
  activity.set(job, created)
  return created
}

/** Questions of a running job being checked now, for "searching 3". */
export function questionsInFlight(job: CheckJob): number {
  return activity.get(job)?.items.size ?? 0
}

/** The questions being checked now, in the order they started. */
export function inFlightItems(job: CheckJob): readonly CheckInFlightItem[] {
  return [...(activity.get(job)?.items.values() ?? [])]
}

export function lastDoneOf(job: CheckJob): CheckLastDone | null {
  return activity.get(job)?.lastDone ?? null
}

export function checkDomainOf(job: CheckJob): string | null {
  return activity.get(job)?.domain ?? null
}

function keyOf(ref: Pick<CheckItemRef, 'pageId' | 'marketId' | 'promptId'>): string {
  return `${ref.pageId}\n${ref.marketId}\n${ref.promptId}`
}

/** A question starts: on the list until `endQuestion`. */
export function startQuestion(
  job: CheckJob,
  item: Omit<CheckInFlightItem, 'engines'>,
  domain: string
): void {
  const state = of(job)
  state.domain = domain
  state.items.set(keyOf(item), { ...item, engines: [] })
  state.outcomes.set(keyOf(item), { answered: false, cited: false })
}

/** A sample starts: these engines are asked, none has answered yet. */
export function askEngines(job: CheckJob, ref: CheckItemRef, engines: readonly EngineId[]): void {
  const state = activity.get(job)
  const item = state?.items.get(keyOf(ref))
  if (state === undefined || item === undefined) return
  state.items.set(keyOf(ref), {
    ...item,
    engines: engines.map((engine) => ({ engine, status: null }))
  })
}

/** One engine answered (or failed): ticked on the list. */
export function engineLanded(
  job: CheckJob,
  ref: CheckItemRef,
  engine: EngineId,
  status: EngineAnswerStatus
): void {
  const state = activity.get(job)
  const item = state?.items.get(keyOf(ref))
  if (state === undefined || item === undefined) return
  state.items.set(keyOf(ref), {
    ...item,
    engines: item.engines.map((entry) => (entry.engine === engine ? { engine, status } : entry))
  })
  const outcome = state.outcomes.get(keyOf(ref))
  if (outcome !== undefined && status !== 'error' && status !== 'unavailable') {
    outcome.answered = true
    if (status === 'cited') outcome.cited = true
  }
}

/** Engines asked for this question that have not answered yet. */
export function enginesWaiting(job: CheckJob, ref: CheckItemRef): EngineId[] {
  const item = activity.get(job)?.items.get(keyOf(ref))
  return (item?.engines ?? []).filter((entry) => entry.status === null).map((e) => e.engine)
}

/**
 * The question leaves the list. A `scored` one becomes the last done ("Q8 cited ✓"); one
 * that stopped part-way keeps the previous one.
 */
export function endQuestion(
  job: CheckJob,
  ref: CheckItemRef,
  finishedAt: string,
  scored: boolean
): void {
  const state = activity.get(job)
  if (state === undefined) return
  const outcome = state.outcomes.get(keyOf(ref))
  state.items.delete(keyOf(ref))
  state.outcomes.delete(keyOf(ref))
  if (scored) {
    const cited = outcome === undefined || !outcome.answered ? null : outcome.cited
    state.lastDone = {
      pageId: ref.pageId,
      marketId: ref.marketId,
      promptId: ref.promptId,
      kind: ref.kind,
      number: ref.number,
      cited,
      finishedAt
    }
  }
}

/** A prompt's kind, number and stage as the topic screen shows them. */
export interface ItemNumber {
  kind: TopicPromptKind
  number: number
  stage: TopicStage | null
}

/**
 * Each prompt of the page's set numbered the way the topic screen numbers it (Q1…, K1…,
 * enabled prompts only, in position order: see `topicPromptMetas`). A page that is not a
 * topic has no keywords: its questions keep their position.
 */
export function itemNumbers(db: SqliteDatabase, page: PagePlan): Map<string, ItemNumber> {
  const out = new Map<string, ItemNumber>()
  if (page.promptSetId !== '') {
    const enabled = new Set(
      db
        .prepare<unknown[], { id: string }>(
          'SELECT id FROM prompts WHERE prompt_set_id = ? AND enabled = 1'
        )
        .all(page.promptSetId)
        .map((row) => row.id)
    )
    const counters = { question: 0, keyword: 0 }
    for (const record of listTopicPrompts(db, page.promptSetId)) {
      if (!enabled.has(record.promptId)) continue
      counters[record.kind] += 1
      out.set(record.promptId, {
        kind: record.kind,
        number: counters[record.kind],
        stage: record.stage
      })
    }
  }
  for (const prompt of page.prompts) {
    if (!out.has(prompt.id)) {
      out.set(prompt.id, { kind: 'question', number: prompt.position, stage: null })
    }
  }
  return out
}
