import { TOPIC_PROFILE_SECTION_LABEL, TOPIC_STAGE_LABEL } from '@shared/domain'
import type { TopicDraft, TopicProfilePoint } from '@shared/domain'
import type { TopicProgress } from '@shared/ipc'
import { askMarketLabel } from '../ask/query'
import { progressHint } from '../assist/progress'
import type { CheckEngine } from '../engine/checks/engine'
import type { EngineHost } from '../engine/host'
import type { SqliteDatabase } from '../storage/database'
import { getMarket, readProjectProfile } from '../storage/project-profile'
import type { ProjectRecord } from '../storage/records'
import { currentProfilePoints } from './drafts'

/** What every topic step needs from the engine. */
export interface TopicEnv {
  host: EngineHost
  checks: CheckEngine | null
  emitProgress: (event: TopicProgress) => void
}

export interface OpenedProject {
  project: ProjectRecord
  db: SqliteDatabase
}

/** What buyers switch from and the integrations they use (Docs/FEEDBACK.md row 3). */
export function buyerContextVars(draft: TopicDraft): {
  switching_from: string
  integrations: string
} {
  const list = (items: readonly string[] | undefined): string =>
    (items ?? [])
      .map((item) => item.trim())
      .filter(Boolean)
      .join(', ') || 'none noted'
  return { switching_from: list(draft.switchingFrom), integrations: list(draft.integrations) }
}

/** Brand variables every topic template fills. */
export function brandVars(names: readonly string[]): { brand_name: string; aliases: string } {
  const clean = names.map((name) => name.trim()).filter(Boolean)
  return {
    brand_name: clean[0] ?? 'none',
    aliases: clean.length > 1 ? clean.slice(1).join(', ') : 'none'
  }
}

export function marketVars(
  db: SqliteDatabase,
  marketId: string | null
): { market: string; market_language: string } {
  const market =
    (marketId === null ? null : getMarket(db, marketId)) ?? readProjectProfile(db)?.market ?? null
  if (market === null) return { market: 'Not set', market_language: 'English' }
  return { market: askMarketLabel(market), market_language: market.language }
}

export function profileText(points: readonly TopicProfilePoint[]): string {
  if (points.length === 0) return 'No profile yet.'
  return points
    .map(
      (point) =>
        `${point.id} · [${TOPIC_PROFILE_SECTION_LABEL[point.section]}] ${point.text}${point.foundIn === null ? '' : ` (${point.foundIn})`}`
    )
    .join('\n')
}

export function draftProfileText(draft: TopicDraft): string {
  return profileText(currentProfilePoints(draft))
}

export function questionsText(draft: TopicDraft, ids?: readonly string[]): string {
  const wanted = ids === undefined ? null : new Set(ids)
  const lines = draft.prompts
    .filter((prompt) => prompt.kind === 'question')
    .filter((prompt) => wanted === null || wanted.has(prompt.id))
    .map(
      (prompt) =>
        `${prompt.id} · [${prompt.stage === null ? 'No stage' : TOPIC_STAGE_LABEL[prompt.stage]}] ${prompt.text}`
    )
  return lines.length === 0 ? 'None yet.' : lines.join('\n')
}

/** Progress pusher bound to one step. */
export function progressFor(
  env: TopicEnv,
  base: Pick<TopicProgress, 'projectId' | 'draftId' | 'topicId' | 'step'>
): (state: TopicProgress['state'], done: number, total: number, detail: string) => void {
  return (state, done, total, detail) => {
    // `assist:progress` shows the step's own words under its next Claude call.
    if (state === 'running')
      progressHint(total > 1 ? `${detail} · ${done + 1} of ${total}` : detail)
    try {
      env.emitProgress({ ...base, state, done, total, detail })
    } catch {
      // A closed window must not fail the step.
    }
  }
}
