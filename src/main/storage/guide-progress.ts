import {
  GUIDE_ID,
  emptyGuideProgress,
  isGuideKickoff,
  isGuideRoute,
  isGuideSignal,
  isGuideStepState,
  type GuideKickoff,
  type GuideProgress,
  type GuideSignal,
  type GuideStepState
} from '@shared/guide'
import type { SqliteDatabase } from './database'
import { isSqliteError } from './database'
import { StorageError } from './errors'

/**
 * The first-run guide's progress in the project database (migration 049). Every
 * write checks its values here, so a bad id or a web address never reaches a row.
 */

interface StateRow {
  current_step: string | null
  paused_step: string | null
  paused_route: string | null
  paused_at: string | null
  hidden: number
  tips_off: number
  kickoff: string
}

/** What one `writeGuide` call changes. Absent fields stay as they are. */
export interface GuidePatch {
  steps?: Readonly<Record<string, GuideStepState | null>>
  current?: string | null
  paused?: { stepId: string; route: string } | null
  hidden?: boolean
  tipsOff?: boolean
  kickoff?: GuideKickoff
  explainerSeen?: string
  explainersReset?: boolean
}

export function readGuide(db: SqliteDatabase, projectId: string): GuideProgress {
  const progress = emptyGuideProgress(projectId)
  const steps: Record<string, GuideStepState> = {}
  for (const row of db
    .prepare<unknown[], { step_id: string; state: string }>(
      `SELECT step_id, state FROM guide_steps ORDER BY step_id`
    )
    .all()) {
    if (isGuideStepState(row.state)) steps[row.step_id] = row.state
  }
  const signals = db
    .prepare<unknown[], { signal: string }>(
      `SELECT signal FROM guide_signals ORDER BY first_at, signal`
    )
    .all()
    .map((row) => row.signal)
    .filter(isGuideSignal)
  const explainersSeen = db
    .prepare<unknown[], { screen: string }>(`SELECT screen FROM guide_explainers ORDER BY screen`)
    .all()
    .map((row) => row.screen)
  const state = db
    .prepare<unknown[], StateRow>(
      `SELECT current_step, paused_step, paused_route, paused_at, hidden, tips_off, kickoff
       FROM guide_state WHERE id = 1`
    )
    .get()
  if (state === undefined) return { ...progress, steps, signals, explainersSeen }
  return {
    ...progress,
    steps,
    signals,
    explainersSeen,
    current: state.current_step,
    paused:
      state.paused_step !== null && state.paused_route !== null
        ? { stepId: state.paused_step, route: state.paused_route, at: state.paused_at ?? '' }
        : null,
    hidden: state.hidden === 1,
    tipsOff: state.tips_off === 1,
    kickoff: isGuideKickoff(state.kickoff) ? state.kickoff : 'none'
  }
}

/** Applies `patch` in one transaction and returns the new progress. */
export function writeGuide(
  db: SqliteDatabase,
  projectId: string,
  patch: GuidePatch,
  now: string
): GuideProgress {
  checkPatch(patch)
  try {
    db.transaction(() => {
      for (const [stepId, state] of Object.entries(patch.steps ?? {})) {
        if (state === null) {
          db.prepare(`DELETE FROM guide_steps WHERE step_id = ?`).run(stepId)
        } else {
          db.prepare(
            `INSERT INTO guide_steps (step_id, state, updated_at) VALUES (?, ?, ?)
             ON CONFLICT (step_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`
          ).run(stepId, state, now)
        }
      }
      if (patch.explainersReset === true) db.prepare(`DELETE FROM guide_explainers`).run()
      if (patch.explainerSeen !== undefined) {
        db.prepare(
          `INSERT INTO guide_explainers (screen, seen_at) VALUES (?, ?) ON CONFLICT (screen) DO NOTHING`
        ).run(patch.explainerSeen, now)
      }
      writeState(db, patch, now)
    })()
  } catch (error) {
    if (error instanceof StorageError) throw error
    if (isSqliteError(error)) throw new StorageError('Could not save the guide')
    throw error
  }
  return readGuide(db, projectId)
}

/** Records `signal` once (its first time is kept) and returns the new progress. */
export function recordGuideSignal(
  db: SqliteDatabase,
  projectId: string,
  signal: GuideSignal,
  now: string
): GuideProgress {
  if (!isGuideSignal(signal)) throw new StorageError('Invalid guide signal')
  db.prepare(
    `INSERT INTO guide_signals (signal, first_at) VALUES (?, ?) ON CONFLICT (signal) DO NOTHING`
  ).run(signal, now)
  return readGuide(db, projectId)
}

/** True when `signal` was not recorded yet (so a caller can tell the windows only once). */
export function hasGuideSignal(db: SqliteDatabase, signal: GuideSignal): boolean {
  return (
    db
      .prepare<unknown[], { n: number }>(`SELECT 1 AS n FROM guide_signals WHERE signal = ?`)
      .get(signal) !== undefined
  )
}

/** Restart: forgets this project's guide entirely. */
export function restartGuide(db: SqliteDatabase, projectId: string): GuideProgress {
  db.transaction(() => {
    db.prepare(`DELETE FROM guide_steps`).run()
    db.prepare(`DELETE FROM guide_signals`).run()
    db.prepare(`DELETE FROM guide_explainers`).run()
    db.prepare(`DELETE FROM guide_state`).run()
  })()
  return readGuide(db, projectId)
}

function writeState(db: SqliteDatabase, patch: GuidePatch, now: string): void {
  const touches =
    patch.current !== undefined ||
    patch.paused !== undefined ||
    patch.hidden !== undefined ||
    patch.tipsOff !== undefined ||
    patch.kickoff !== undefined
  if (!touches) return
  db.prepare(
    `INSERT INTO guide_state (id, updated_at) VALUES (1, ?) ON CONFLICT (id) DO NOTHING`
  ).run(now)
  const sets: string[] = ['updated_at = @now']
  const values: Record<string, string | number | null> = { now }
  if (patch.current !== undefined) {
    sets.push('current_step = @current')
    values.current = patch.current
  }
  if (patch.paused !== undefined) {
    sets.push('paused_step = @pausedStep', 'paused_route = @pausedRoute', 'paused_at = @pausedAt')
    values.pausedStep = patch.paused?.stepId ?? null
    values.pausedRoute = patch.paused?.route ?? null
    values.pausedAt = patch.paused ? now : null
  }
  if (patch.hidden !== undefined) {
    sets.push('hidden = @hidden')
    values.hidden = patch.hidden ? 1 : 0
  }
  if (patch.tipsOff !== undefined) {
    sets.push('tips_off = @tipsOff')
    values.tipsOff = patch.tipsOff ? 1 : 0
  }
  if (patch.kickoff !== undefined) {
    sets.push('kickoff = @kickoff')
    values.kickoff = patch.kickoff
  }
  db.prepare(`UPDATE guide_state SET ${sets.join(', ')} WHERE id = 1`).run(values)
}

function checkPatch(patch: GuidePatch): void {
  const id = (value: unknown): boolean => typeof value === 'string' && GUIDE_ID.test(value)
  const steps = Object.entries(patch.steps ?? {})
  if (steps.length > 100) throw new StorageError('Too many guide steps')
  for (const [stepId, state] of steps) {
    if (!id(stepId) || (state !== null && !isGuideStepState(state))) {
      throw new StorageError('Invalid guide step')
    }
  }
  if (patch.current !== undefined && patch.current !== null && !id(patch.current)) {
    throw new StorageError('Invalid guide step')
  }
  if (
    patch.paused !== undefined &&
    patch.paused !== null &&
    (!id(patch.paused.stepId) || !isGuideRoute(patch.paused.route))
  ) {
    throw new StorageError('Invalid guide pause')
  }
  if (patch.kickoff !== undefined && !isGuideKickoff(patch.kickoff)) {
    throw new StorageError('Invalid guide kick-off')
  }
  if (patch.explainerSeen !== undefined && !id(patch.explainerSeen)) {
    throw new StorageError('Invalid guide screen')
  }
}
