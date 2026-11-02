import type { GuideProgress } from '@shared/guide'
import {
  createCiteFoxApi,
  type AppInfo,
  type AppSettingsPatch,
  type AppSettingsSnapshot,
  type CiteFoxApi,
  type GuideUpdateRequest,
  type IpcInvokeChannel
} from '@shared/ipc'
import { ACCOUNT_OFF, NO_UPDATE } from '../src/account/client'
import { DEMO_BLOCKED_MESSAGE, demoPolicy } from './policy'
import { findEntry, type DemoSnapshot } from './snapshot'

/**
 * The browser demo's stand-in for the preload bridge (`window.citefox`).
 *
 * Built with the same `createCiteFoxApi` as the real preload, so every channel
 * in the contract exists. Reads come from the recorded snapshot; quiet changes
 * are answered in memory; anything that needs the real app rejects with the
 * demo message and tells the page (`onBlocked`) so it can show the notice.
 * Push events never fire. Nothing is stored outside this tab's memory.
 */

export class DemoBlockedError extends Error {
  readonly channel: string
  constructor(channel: string) {
    super(DEMO_BLOCKED_MESSAGE)
    this.name = 'DemoBlockedError'
    this.channel = channel
  }
}

export interface DemoBridgeOptions {
  snapshot: DemoSnapshot
  /** The release the demo shows in its footer. */
  appInfo: AppInfo
  /** A blocked action was asked for. */
  onBlocked?: (channel: IpcInvokeChannel) => void
  /**
   * Recording only (`npm run demo:record`): answer reads and quiet changes
   * from the real handlers instead of the snapshot.
   */
  remote?: (channel: IpcInvokeChannel, arg: unknown) => Promise<unknown>
}

/** Answers that never come from the snapshot: no Join step, no update banner. */
function fixedAnswer(channel: IpcInvokeChannel, appInfo: AppInfo): { value: unknown } | null {
  switch (channel) {
    case 'account:get':
      return { value: ACCOUNT_OFF }
    case 'updates:get':
    case 'updates:check':
    case 'updates:dismiss':
      return { value: NO_UPDATE }
    case 'app:getInfo':
      return { value: appInfo }
    default:
      return null
  }
}

/** A quiet change's answer: the related read with the change applied. */
const QUIET_READ: Partial<Record<IpcInvokeChannel, IpcInvokeChannel>> = {
  'guide:update': 'guide:get',
  'guide:signal': 'guide:get',
  'guide:restart': 'guide:get',
  'grid:setScreenView': 'grid:getScreenView',
  'grid:setSummaryBoard': 'grid:getSummaryBoard',
  'settings:update': 'settings:get',
  'projects:switch': 'projects:list'
}

export interface DemoAnswer {
  kind: 'answer' | 'blocked' | 'missing'
  value?: unknown
}

/**
 * What the demo answers for one call, without side effects. `missing` means a
 * read the snapshot never recorded; the bridge answers it as blocked.
 */
export function demoAnswer(
  snapshot: DemoSnapshot,
  appInfo: AppInfo,
  channel: IpcInvokeChannel,
  arg: unknown
): DemoAnswer {
  const fixed = fixedAnswer(channel, appInfo)
  if (fixed) return { kind: 'answer', value: fixed.value }
  const policy = demoPolicy(channel)
  if (policy === 'blocked') return { kind: 'blocked' }
  const own = findEntry(snapshot, channel, arg)
  if (own) return { kind: 'answer', value: own.result }
  const read = QUIET_READ[channel]
  if (policy === 'quiet' && read) {
    const entry = findEntry(snapshot, read, arg)
    if (entry) return { kind: 'answer', value: entry.result }
  }
  return { kind: 'missing' }
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
}

/** Quiet changes kept in memory, so the theme and the guide respond in this tab. */
function quietState(): {
  apply(channel: IpcInvokeChannel, arg: unknown, value: unknown): unknown
} {
  let settings: AppSettingsSnapshot | null = null
  const guides = new Map<string, GuideProgress>()
  return {
    apply(channel, arg, value) {
      if (channel === 'settings:get' || channel === 'settings:update') {
        const base = settings ?? (value as AppSettingsSnapshot)
        if (channel === 'settings:update' && base) {
          settings = { ...base, settings: { ...base.settings, ...(arg as AppSettingsPatch) } }
        }
        return settings ?? value
      }
      if (channel.startsWith('guide:')) {
        const request = (arg ?? {}) as Partial<GuideUpdateRequest>
        const id = request.projectId ?? ''
        const base = guides.get(id) ?? (value as GuideProgress)
        if (!base) return value
        let next = base
        if (channel === 'guide:update') {
          const steps = { ...base.steps }
          for (const [step, state] of Object.entries(request.steps ?? {})) {
            if (state === null) delete steps[step]
            else steps[step] = state
          }
          next = {
            ...base,
            steps,
            ...(request.current !== undefined ? { current: request.current } : {}),
            ...(request.paused !== undefined
              ? {
                  paused: request.paused
                    ? { ...request.paused, at: new Date().toISOString() }
                    : null
                }
              : {}),
            ...(request.hidden !== undefined ? { hidden: request.hidden } : {}),
            ...(request.tipsOff !== undefined ? { tipsOff: request.tipsOff } : {}),
            ...(request.kickoff !== undefined ? { kickoff: request.kickoff } : {}),
            explainersSeen: request.explainersReset
              ? []
              : request.explainerSeen
                ? [...new Set([...base.explainersSeen, request.explainerSeen])]
                : base.explainersSeen
          }
        } else if (channel === 'guide:restart') {
          next = { ...base, steps: {}, signals: [], current: null, paused: null, kickoff: 'none' }
        }
        guides.set(id, next)
        return next
      }
      return value
    }
  }
}

const ANSWER_DELAY_MS = 4

/** How often each channel was called in this tab (read by the demo check). */
export const calls = new Map<string, number>()

export function createDemoApi(options: DemoBridgeOptions): CiteFoxApi {
  const state = quietState()
  const blocked = (channel: IpcInvokeChannel): Promise<never> => {
    options.onBlocked?.(channel)
    return Promise.reject(new DemoBlockedError(channel))
  }
  return createCiteFoxApi(
    async (channel, ...args) => {
      const arg = args.length > 0 ? args[0] : null
      calls.set(channel, (calls.get(channel) ?? 0) + 1)
      // Answer on a later task, like a real IPC reply: an answer that makes a screen
      // ask again then never ties up the page in one endless run of microtasks.
      await new Promise((done) => setTimeout(done, ANSWER_DELAY_MS))
      const fixed = fixedAnswer(channel, options.appInfo)
      if (fixed) return clone(fixed.value)
      if (options.remote) {
        if (demoPolicy(channel) === 'blocked') return blocked(channel)
        return options.remote(channel, arg)
      }
      const answer = demoAnswer(options.snapshot, options.appInfo, channel, arg)
      if (answer.kind !== 'answer') return blocked(channel)
      return state.apply(channel, arg, clone(answer.value))
    },
    () => () => undefined
  )
}
