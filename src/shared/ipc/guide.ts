/**
 * The first-run guide's progress (src/shared/guide.ts), one per project. Main
 * also records a signal when a save the guide teaches happens anywhere in the
 * app (a target page, a competitor, a check) and pushes `guide:changed`.
 */

import type { GuideKickoff, GuideProgress, GuideSignal, GuideStepState } from '../guide'
import { invokeWith, push, type InvokeChannelSpecs, type PushChannelSpecs } from './contract'

export interface GuideProjectRequest {
  projectId: string
}

/**
 * `guide:update`: every field is optional and only the given ones change.
 * `paused: null` clears the pause; `explainersReset` forgets every closed explainer.
 */
export interface GuideUpdateRequest {
  projectId: string
  /** Step id → state; `null` forgets the step (back to not started). */
  steps?: Readonly<Record<string, GuideStepState | null>>
  current?: string | null
  paused?: { stepId: string; route: string } | null
  hidden?: boolean
  tipsOff?: boolean
  kickoff?: GuideKickoff
  /** A screen whose "What is this page?" card was closed. */
  explainerSeen?: string
  explainersReset?: boolean
}

/** `guide:signal`: something the user did that the guide teaches (renderer-seen ones). */
export interface GuideSignalRequest {
  projectId: string
  signal: GuideSignal
}

export const guideChannels = {
  'guide:get': invokeWith<GuideProjectRequest, GuideProgress>(),
  'guide:update': invokeWith<GuideUpdateRequest, GuideProgress>(),
  'guide:signal': invokeWith<GuideSignalRequest, GuideProgress>(),
  /** Clears this project's guide: steps, signals, pause, explainers and the kick-off. */
  'guide:restart': invokeWith<GuideProjectRequest, GuideProgress>()
} as const satisfies InvokeChannelSpecs

export const guideEvents = {
  /** A save elsewhere ticked a signal; the payload is the project's new progress. */
  'guide:changed': push<GuideProgress>()
} as const satisfies PushChannelSpecs
