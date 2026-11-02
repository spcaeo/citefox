/**
 * The IPC contract between the Engine (`src/main`) and the App (`src/renderer`).
 * Each area module declares its channels once, in a spec record. This file merges
 * the records and derives everything else: the type maps, the runtime allow-list,
 * the arity table, the preload API (`createCiteFoxApi`), and main's dispatch
 * (`callIpcHandler`). Payloads must be structured-cloneable.
 */

import { accountChannels } from './account'
import { alertsChannels } from './alerts'
import { allPagesChannels } from './allpages'
import { appChannels } from './app'
import { askChannels } from './ask'
import { assistantChannels } from './assistant'
import { assistChannels, assistEvents } from './assist'
import { checksChannels, checksEvents } from './checks'
import { communitiesChannels } from './communities'
import { competitorsChannels } from './competitors'
import { connectionsChannels, connectionsEvents } from './connections'
import {
  channelNames,
  mergeSpecs,
  type DuplicateChannels,
  type InvokeMapOf,
  type PushMapOf
} from './contract'
import { coverageChannels } from './coverage'
import { emailChannels } from './email'
import { exportsChannels, exportsEvents } from './exports'
import { faviconsChannels } from './favicons'
import { fixesChannels } from './fixes'
import { fixLoopChannels } from './fixLoop'
import { helpFillChannels } from './helpfill'
import { historyChannels } from './history'
import { importerChannels } from './importer'
import { gridChannels } from './grid'
import { guideChannels, guideEvents } from './guide'
import { keysChannels } from './keys'
import { liveResultsEvents } from './live-results'
import { llmChannels } from './llm'
import { noticesChannels, noticesEvents } from './notices'
import { onboardingChannels } from './onboarding'
import { pageChangesChannels } from './pageChanges'
import { projectRulesChannels } from './projectRules'
import { pagesChannels, pagesEvents } from './pages'
import { permissionsChannels } from './permissions'
import { playgroundChannels } from './playground'
import { projectsChannels, projectsEvents } from './projects'
import { projectSettingsChannels } from './projectSettings'
import { productsChannels } from './products'
import { enginesChannels } from './engines'
import { promptsChannels } from './prompts'
import { questionsChannels } from './questions'
import { queueChannels, queueEvents } from './queue'
import { reportsChannels } from './reports'
import { metricsChannels } from './metrics'
import { resultsChannels } from './results'
import { scheduleChannels } from './schedule'
import { searchChannels } from './search'
import { sentimentChannels, sentimentEvents } from './sentiment'
import { settingsChannels, settingsEvents } from './settings'
import { setupChannels, setupEvents } from './setup'
import { startChannels, startEvents } from './start'
import { statusChannels } from './status'
import { structureChannels, structureEvents } from './structure'
import { templatesChannels } from './templates'
import { topicClustersChannels } from './topicClusters'
import { topicsChannels, topicsEvents } from './topics'
import { trayChannels } from './tray'
import { transferChannels, transferEvents } from './transfer'
import { visibilityChannels } from './visibility'

export { KEY_TEST_REASONS, type KeyTestReason } from '../domain'
export * from './account'
export * from './alerts'
export * from './allpages'
export * from './app'
export * from './ask'
export * from './assist'
export * from './assistant'
export * from './checks'
export * from './communities'
export * from './competitors'
export * from './connections'
export * from './coverage'
export * from './email'
export * from './exports'
export * from './favicons'
export * from './fixes'
export * from './fixLoop'
export * from './ownerWhy'
export * from './helpfill'
export * from './history'
export * from './importer'
export * from './grid'
export * from './guide'
export * from './keys'
export * from './llm'
export * from './notices'
export * from './live-results'
export * from './onboarding'
export * from './pageChanges'
export * from './projectRules'
export * from './pages'
export * from './permissions'
export * from './playground'
export * from './projects'
export * from './projectSettings'
export * from './products'
export * from './engines'
export * from './prompts'
export * from './questions'
export * from './queue'
export * from './reports'
export * from './metrics'
export * from './results'
export * from './schedule'
export * from './search'
export * from './sentiment'
export * from './settings'
export * from './setup'
export * from './start'
export * from './status'
export * from './structure'
export * from './templates'
export * from './topicClusters'
export * from './topics'
export * from './topicTargets'
export * from './tray'
export * from './transfer'
export * from './visibility'

/** Every area's invoke spec record. A new area module is added here once. */
const INVOKE_GROUPS = [
  appChannels,
  accountChannels,
  onboardingChannels,
  connectionsChannels,
  keysChannels,
  settingsChannels,
  statusChannels,
  projectsChannels,
  projectSettingsChannels,
  pagesChannels,
  promptsChannels,
  questionsChannels,
  searchChannels,
  coverageChannels,
  templatesChannels,
  playgroundChannels,
  trayChannels,
  checksChannels,
  resultsChannels,
  scheduleChannels,
  queueChannels,
  emailChannels,
  alertsChannels,
  reportsChannels,
  metricsChannels,
  exportsChannels,
  fixesChannels,
  fixLoopChannels,
  historyChannels,
  pageChangesChannels,
  projectRulesChannels,
  communitiesChannels,
  structureChannels,
  sentimentChannels,
  gridChannels,
  allPagesChannels,
  assistChannels,
  llmChannels,
  askChannels,
  assistantChannels,
  setupChannels,
  noticesChannels,
  topicsChannels,
  topicClustersChannels,
  permissionsChannels,
  startChannels,
  productsChannels,
  enginesChannels,
  visibilityChannels,
  competitorsChannels,
  faviconsChannels,
  importerChannels,
  helpFillChannels,
  transferChannels,
  guideChannels
] as const

/** Every area's push spec record. */
const EVENT_GROUPS = [
  connectionsEvents,
  projectsEvents,
  pagesEvents,
  checksEvents,
  queueEvents,
  exportsEvents,
  structureEvents,
  sentimentEvents,
  setupEvents,
  noticesEvents,
  topicsEvents,
  assistEvents,
  startEvents,
  settingsEvents,
  transferEvents,
  liveResultsEvents,
  guideEvents
] as const

const INVOKE_SPECS = mergeSpecs(INVOKE_GROUPS)
const EVENT_SPECS = mergeSpecs(EVENT_GROUPS)

/**
 * Renderer invokes. Each entry is the arguments the renderer may send
 * and the result main returns. Derived from the area spec records.
 */
export type IpcInvokeMap = InvokeMapOf<typeof INVOKE_SPECS>

/** Main pushes these. The renderer subscribes. Same allow-list as invokes. */
export type IpcEventMap = PushMapOf<typeof EVENT_SPECS>

export type IpcInvokeChannel = Extract<keyof IpcInvokeMap, string>
export type IpcEventChannel = Extract<keyof IpcEventMap, string>
export type IpcChannel = IpcInvokeChannel | IpcEventChannel

export const IPC_INVOKE_CHANNELS: readonly IpcInvokeChannel[] = channelNames(INVOKE_SPECS)
export const IPC_EVENT_CHANNELS: readonly IpcEventChannel[] = channelNames(EVENT_SPECS)

/** Every invoke and every push event. Preload rejects anything else. */
export const IPC_CHANNELS: readonly IpcChannel[] = [...IPC_INVOKE_CHANNELS, ...IPC_EVENT_CHANNELS]

type MissingInvoke = Exclude<keyof IpcInvokeMap, (typeof IPC_INVOKE_CHANNELS)[number]>
type MissingEvent = Exclude<keyof IpcEventMap, (typeof IPC_EVENT_CHANNELS)[number]>
type Duplicate = DuplicateChannels<typeof INVOKE_GROUPS> | DuplicateChannels<typeof EVENT_GROUPS>
type Overlap = Extract<IpcInvokeChannel, IpcEventChannel>
type Unnamespaced = Exclude<IpcChannel, `${string}:${string}`>

/**
 * Compile error when a map entry is missing from the allow-list, two areas declare
 * the same channel, the two directions overlap, or a name has no `area:` prefix.
 */
export function assertIpcAllowListComplete(): true {
  const complete: [MissingInvoke | MissingEvent | Duplicate | Overlap | Unnamespaced] extends [
    never
  ]
    ? true
    : never = true
  return complete
}

export type IpcArgs<C extends IpcInvokeChannel> = IpcInvokeMap[C]['args']
export type IpcResult<C extends IpcInvokeChannel> = IpcInvokeMap[C]['result']
export type IpcEventPayload<E extends IpcEventChannel> = IpcEventMap[E]

/** What main must implement. A missing invoke is a compile error. Events are not handlers. */
export type IpcHandlerMap = {
  [C in IpcInvokeChannel]: (...args: IpcArgs<C>) => Promise<IpcResult<C>> | IpcResult<C>
}

/** Main's handlers for one area's spec record, such as `IpcHandlersFor<typeof keysChannels>`. */
export type IpcHandlersFor<S> = Pick<IpcHandlerMap, Extract<keyof S, IpcInvokeChannel>>

/** What preload exposes and the renderer calls. Event keys subscribe and return an unsubscribe. */
export type CiteFoxApi = {
  [C in IpcInvokeChannel]: (...args: IpcArgs<C>) => Promise<IpcResult<C>>
} & {
  [E in IpcEventChannel]: (listener: (payload: IpcEventMap[E]) => void) => () => void
}

/** Runtime bridge used by preload. The public `CiteFoxApi` stays fully typed. */
export type IpcInvoker = (
  channel: IpcInvokeChannel,
  ...args: readonly unknown[]
) => Promise<unknown>

export type IpcSubscriber = (
  channel: IpcEventChannel,
  listener: (payload: unknown) => void
) => () => void

/** Argument count per invoke. An unknown channel has none, so it never matches. */
const INVOKE_ARITY: Readonly<Record<string, number>> = Object.fromEntries(
  IPC_INVOKE_CHANNELS.map((channel) => [channel, INVOKE_SPECS[channel].arity])
)

const INVOKE_CHANNELS: ReadonlySet<string> = new Set(IPC_INVOKE_CHANNELS)
const EVENT_CHANNELS: ReadonlySet<string> = new Set(IPC_EVENT_CHANNELS)
const ALLOWED_CHANNELS: ReadonlySet<string> = new Set(IPC_CHANNELS)

export function isIpcInvokeChannel(value: string): value is IpcInvokeChannel {
  return INVOKE_CHANNELS.has(value)
}

export function isIpcEventChannel(value: string): value is IpcEventChannel {
  return EVENT_CHANNELS.has(value)
}

export function isIpcChannel(value: string): value is IpcChannel {
  return ALLOWED_CHANNELS.has(value)
}

/**
 * Builds the renderer API from the allow-list. A no-argument invoke forwards no
 * arguments. A one-argument invoke forwards exactly its first argument.
 */
export function createCiteFoxApi(invoke: IpcInvoker, subscribe: IpcSubscriber): CiteFoxApi {
  const invokes = IPC_INVOKE_CHANNELS.map((channel) => {
    const arity = INVOKE_ARITY[channel]
    const call = (...args: readonly unknown[]): Promise<unknown> => {
      assertInvokeAllowed(channel)
      return arity === 0 ? invoke(channel) : invoke(channel, args[0])
    }
    return [channel, call] as const
  })
  const events = IPC_EVENT_CHANNELS.map((channel) => {
    const on = (listener: (payload: unknown) => void): (() => void) => {
      assertEventAllowed(channel)
      return subscribe(channel, (payload) => {
        listener(payload)
      })
    }
    return [channel, on] as const
  })
  return Object.fromEntries([...invokes, ...events]) as CiteFoxApi
}

/**
 * Runs the handler for an allow-listed invoke. The argument count must match the spec.
 * Errors name the channel only. They do not include arguments, so a secret
 * in an add or replace request cannot be echoed by a rejected call.
 */
export function callIpcHandler<C extends IpcInvokeChannel>(
  handlers: IpcHandlerMap,
  channel: C,
  args: readonly unknown[]
): Promise<IpcResult<C>> | IpcResult<C> {
  if (args.length !== INVOKE_ARITY[channel]) {
    throw new Error(`Blocked IPC channel: ${channel} received unexpected arguments`)
  }
  const handler: IpcHandlerMap[C] = handlers[channel]
  return handler(...(args as IpcArgs<C>))
}

function assertInvokeAllowed(channel: string): asserts channel is IpcInvokeChannel {
  if (!isIpcInvokeChannel(channel)) {
    throw new Error(`Blocked IPC channel: ${channel}`)
  }
}

function assertEventAllowed(channel: string): asserts channel is IpcEventChannel {
  if (!isIpcEventChannel(channel)) {
    throw new Error(`Blocked IPC channel: ${channel}`)
  }
}
