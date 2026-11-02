/** The first-run guide's progress (src/shared/guide.ts), one per project. */

import {
  GUIDE_ID,
  isGuideKickoff,
  isGuideRoute,
  isGuideSignal,
  isGuideStepState,
  type GuideStepState
} from '@shared/guide'
import type { GuideUpdateRequest, IpcHandlersFor, guideChannels } from '@shared/ipc'
import { withProject } from '../engine/project-db'
import { IpcRequestError } from '../ipc-request'
import { readGuide, recordGuideSignal, restartGuide, writeGuide } from '../storage/guide-progress'
import { guard, type EngineContext } from './context'

const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/

export function guideHandlers(ctx: EngineContext): IpcHandlersFor<typeof guideChannels> {
  return {
    'guide:get': (request) =>
      guard('guide:get', ctx, () => {
        const projectId = projectIdOf('guide:get', request)
        return withProject(ctx, projectId, 'guide:get', ({ db }) => readGuide(db, projectId))
      }),
    'guide:update': (request) =>
      guard('guide:update', ctx, () => {
        const patch = parseUpdate('guide:update', request)
        return withProject(ctx, patch.projectId, 'guide:update', ({ db }) =>
          writeGuide(db, patch.projectId, patch, ctx.now().toISOString())
        )
      }),
    'guide:signal': (request) =>
      guard('guide:signal', ctx, () => {
        const record = recordOf('guide:signal', request)
        const projectId = projectIdOf('guide:signal', record)
        const signal = record.signal
        if (!isGuideSignal(signal)) throw new IpcRequestError('guide:signal')
        return withProject(ctx, projectId, 'guide:signal', ({ db }) =>
          recordGuideSignal(db, projectId, signal, ctx.now().toISOString())
        )
      }),
    'guide:restart': (request) =>
      guard('guide:restart', ctx, () => {
        const projectId = projectIdOf('guide:restart', request)
        return withProject(ctx, projectId, 'guide:restart', ({ db }) => restartGuide(db, projectId))
      })
  }
}

function parseUpdate(channel: string, request: unknown): GuideUpdateRequest {
  const record = recordOf(channel, request)
  const fail = (): never => {
    throw new IpcRequestError(channel)
  }
  const id = (value: unknown): string =>
    typeof value === 'string' && GUIDE_ID.test(value) ? value : fail()
  const flag = (value: unknown): boolean | undefined =>
    value === undefined ? undefined : typeof value === 'boolean' ? value : fail()
  const patch: { -readonly [K in keyof GuideUpdateRequest]: GuideUpdateRequest[K] } = {
    projectId: projectIdOf(channel, record)
  }
  if (record.steps !== undefined) {
    const steps: Record<string, GuideStepState | null> = {}
    const entries = Object.entries(recordOf(channel, record.steps))
    if (entries.length > 100) fail()
    for (const [stepId, state] of entries) {
      steps[id(stepId)] = state === null ? null : isGuideStepState(state) ? state : fail()
    }
    patch.steps = steps
  }
  if (record.current !== undefined)
    patch.current = record.current === null ? null : id(record.current)
  if (record.paused !== undefined) {
    if (record.paused === null) patch.paused = null
    else {
      const paused = recordOf(channel, record.paused)
      if (!isGuideRoute(paused.route)) fail()
      patch.paused = { stepId: id(paused.stepId), route: paused.route as string }
    }
  }
  const hidden = flag(record.hidden)
  if (hidden !== undefined) patch.hidden = hidden
  const tipsOff = flag(record.tipsOff)
  if (tipsOff !== undefined) patch.tipsOff = tipsOff
  if (record.kickoff !== undefined)
    patch.kickoff = isGuideKickoff(record.kickoff) ? record.kickoff : fail()
  if (record.explainerSeen !== undefined) patch.explainerSeen = id(record.explainerSeen)
  const reset = flag(record.explainersReset)
  if (reset !== undefined) patch.explainersReset = reset
  return patch
}

function recordOf(channel: string, value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  return value as Record<string, unknown>
}

function projectIdOf(channel: string, value: unknown): string {
  const projectId = recordOf(channel, value).projectId
  if (typeof projectId !== 'string' || !PROJECT_ID.test(projectId))
    throw new IpcRequestError(channel)
  return projectId
}
