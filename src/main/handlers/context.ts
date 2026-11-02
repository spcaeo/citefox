/** Dependencies, the engine context every handler area shares, and the error guard. */

import { randomUUID } from 'node:crypto'
import type { AppSettings, ThemePreference } from '@shared/domain'
import type {
  AppInfo,
  ClaudeCheckupProgress,
  FillFromWebsiteProgress,
  OpenTerminalResult,
  PageReadProgress
} from '@shared/ipc'
import type { AlertSenders } from '../alerts/deliver'
import type { AppTools } from '../app-tools/types'
import type { AccountServices } from './account'
import { openEngineEmail, type EngineEmail } from '../email/engine-email'
import { claudeSummaryWriter } from '../email/summary-writer'
import { resolveClaude } from '../engine/claude'
import type { CheckEngine } from '../engine/checks/engine'
import { CheckInputError } from '../engine/checks/results'
import {
  createEngineMemory,
  type EngineHost,
  type EngineMemory,
  type WebsitePageBody
} from '../engine/host'
import { bindMainIpcEmitter, type MainIpcEmitter } from '../ipc-events'
import { IpcRequestError } from '../ipc-request'
import type { LocationMatch } from '../locations'
import type { Logger } from '../logging/logger'
import { redactString } from '../logging/redact'
import { PipelineError } from '../pipeline/errors'
import { ProviderError, type ProviderErrorCode } from '../providers/errors'
import type { AddressLookup } from '../pipeline/fetch-guard'
import {
  PlaygroundMemory,
  type PlaygroundModelReply,
  type PlaygroundPage
} from '../pipeline/playground'
import { TemplateContractError } from '../pipeline/templates'
import type { FaviconService } from '../favicons/service'
import type { BinaryProbe } from '../providers/claude/binary'
import type { ClaudeProvider } from '../providers/claude/claude-code'
import type { CommandTransport } from '../providers/command'
import type { HttpTransport } from '../providers/http'
import { SERPAPI_LOCATIONS } from '../providers/serpapi/locations'
import type { PermissionConsentStore } from '../permissions/consent'
import type { PermissionSystem } from '../permissions/system'
import type { bindScheduleQueueTray } from '../scheduler/ipc'
import type { SecretStore } from '../secrets/secret-store'
import type { SetupRunner, SetupRunnerDeps } from '../setup-runner/runner'
import type { AppStorage } from '../storage/app-storage'
import { StorageError } from '../storage/errors'
import { createProcessLaunch, openClaudeTerminal, type ProcessLaunch } from '../terminal'

export interface IpcHandlerDeps {
  appInfo: () => AppInfo
  storage: AppStorage
  secrets: SecretStore
  logger: Logger
  http: HttpTransport
  claudeCommand: CommandTransport
  claudeProbe: BinaryProbe
  emitCheckupProgress: (event: ClaudeCheckupProgress) => void
  /**
   * Pushes an allow-listed event to the renderer.
   * `checks:progress`, `checks:finished`, `queue:status`, and `exports:progress`
   * are wired through this and have no producer yet.
   */
  emit: MainIpcEmitter
  /** Exact secrets to mask in errors. Defaults to none. */
  knownSecrets?: () => readonly string[]
  openTerminal?: () => Promise<OpenTerminalResult>
  now?: () => Date
  createId?: () => string
  /** FR-9.5 city catalogue. Defaults to the bundled SerpApi location list. */
  locations?: readonly LocationMatch[]
  launch?: ProcessLaunch
  /** Test seam. Production reads the URL over HTTP. */
  readPlaygroundPage?: (url: string) => Promise<PlaygroundPage>
  /** Test seam. Production calls the configured Claude provider. */
  completePlayground?: (prompt: string) => Promise<PlaygroundModelReply>
  /** Test seam for buyer profile, prompts, and assists. Production uses Settings. */
  claude?: ClaudeProvider
  /** Test seam for direct page reads. Production uses system DNS. */
  pageDns?: AddressLookup
  /** Test seam for fill-from-website. Production fetches the public page. */
  readWebsitePage?: (url: string) => Promise<WebsitePageBody | null>
  emitPageReadProgress?: (event: PageReadProgress) => void
  emitFillProgress?: (event: FillFromWebsiteProgress) => void
  /** Receives the opened host so shutdown can close email before storage. */
  onHost?: (host: EngineHost) => void
  /**
   * Check engine shared with the scheduled runner and startup resume.
   * Tests omit it and get an engine created here.
   */
  checkEngine?: CheckEngine
  /** Test seam. Resolves before each SerpApi attempt inside a check. */
  beforeCheckRequest?: () => Promise<void>
  /**
   * Schedule, queue, and tray binding. Production builds this once from
   * Engine's check runner. Tests omit it and get the unavailable runner.
   */
  scheduleQueueTray?: ReturnType<typeof bindScheduleQueueTray>
  /** Test seam for Communities: no pause between Reddit requests. */
  communities?: { sleep?: (ms: number) => Promise<void>; redditIntervalMs?: number }
  /**
   * Sitemap reads (FR-19.1). Tests and unpackaged e2e builds pass a fixture
   * transport and DNS; production uses `http` behind the SSRF guard.
   */
  sitemapFetch?: { http: HttpTransport; dns: AddressLookup }
  /**
   * Unpackaged test runs only (`CITEFOX_START_AUTOPILOT=off`, the Playwright
   * default): the first-run autopilot refuses to start, so specs about other
   * screens never read a real site after onboarding.
   */
  startAutopilotOff?: boolean
  /** Test seam: re-read a tracked page whose sitemap lastmod changed. */
  rereadPage?: (projectId: string, pageId: string, withGaps: boolean) => Promise<void>
  /**
   * Receives the background setup runner the handlers serve (FR-20.6), so the
   * GUI can start its loop and stop it on quit. Tests drive it directly.
   */
  onSetupRunner?: (runner: SetupRunner) => void
  /** Test seam: setup runner timers and pipeline dependencies. */
  setupRunner?: Pick<SetupRunnerDeps, 'timers' | 'setupDeps' | 'timeZone' | 'startFirstCheck'>
  /**
   * "What CiteFox needs": notifications and the login item. Production passes the
   * Electron system; tests get an in-memory one that never shows a prompt.
   */
  permissionSystem?: PermissionSystem
  /** What the user agreed to. Production shares it with the tray; tests get a file in the data folder. */
  permissionConsent?: PermissionConsentStore
  /** Build menu: reset keeping keys and the test profile. Tests omit it and get "not available". */
  appTools?: AppTools
  /**
   * Where fired alert rules go. Production leaves it unset: email and Slack go through
   * the email service and desktop through the tray (main/index.ts). Tests pass fakes.
   */
  alertSenders?: AlertSenders
  /** Test seam for site icons (`favicons:get`): a fake fetch and cache. */
  favicons?: FaviconService
  /** Unpackaged test runs (`CITEFOX_FAVICONS=off`): site icons are never fetched. */
  faviconsOff?: boolean
  /**
   * Settings › Appearance saved a theme: main applies it (nativeTheme, the
   * window background, the View menu) and tells the windows. Tests omit it.
   */
  onThemeChanged?: (theme: ThemePreference) => void
  /**
   * "Join CiteFox" and the update check. Production passes the configured
   * services (main/index.ts); tests omit it and get the no-op defaults.
   */
  accountServices?: AccountServices
}

export interface EngineContext {
  appInfo: () => AppInfo
  storage: AppStorage
  secrets: SecretStore
  logger: Logger
  http: HttpTransport
  claudeCommand: CommandTransport
  claudeProbe: BinaryProbe
  emitCheckupProgress: (event: ClaudeCheckupProgress) => void
  knownSecrets: () => readonly string[]
  openTerminal: () => Promise<OpenTerminalResult>
  now: () => Date
  createId: () => string
  locations: readonly LocationMatch[]
  readPlaygroundPage?: (url: string) => Promise<PlaygroundPage>
  completePlayground?: (prompt: string) => Promise<PlaygroundModelReply>
  playgroundMemory: PlaygroundMemory
  claude?: ClaudeProvider
  pageDns?: AddressLookup
  readWebsitePage?: (url: string) => Promise<WebsitePageBody | null>
  emitPageReadProgress: (event: PageReadProgress) => void
  emitFillProgress: (event: FillFromWebsiteProgress) => void
  memory: EngineMemory
  settings: () => AppSettings
  email: EngineEmail
  appTools?: AppTools
  onThemeChanged?: (theme: ThemePreference) => void
}

export function toContext(deps: IpcHandlerDeps): EngineContext {
  bindMainIpcEmitter(deps.emit)
  const knownSecrets = deps.knownSecrets ?? ((): readonly string[] => [])
  // Read lazily: the writer resolves Claude through the context built below.
  let context: EngineContext | null = null
  const email = openEngineEmail({
    storage: deps.storage,
    secrets: deps.secrets,
    logger: deps.logger,
    ...(deps.createId !== undefined ? { createId: deps.createId } : {}),
    knownSecrets,
    summaryWriter: claudeSummaryWriter(() =>
      context === null ? undefined : resolveClaude(context, 'reports:summary')
    )
  })
  context = {
    appInfo: deps.appInfo,
    storage: deps.storage,
    secrets: deps.secrets,
    logger: deps.logger,
    http: deps.http,
    claudeCommand: deps.claudeCommand,
    claudeProbe: deps.claudeProbe,
    emitCheckupProgress: deps.emitCheckupProgress,
    knownSecrets,
    openTerminal:
      deps.openTerminal ??
      ((): Promise<OpenTerminalResult> => openClaudeTerminal(deps.launch ?? createProcessLaunch())),
    now: deps.now ?? ((): Date => new Date()),
    createId: deps.createId ?? ((): string => randomUUID()),
    locations: deps.locations ?? SERPAPI_LOCATIONS,
    readPlaygroundPage: deps.readPlaygroundPage,
    completePlayground: deps.completePlayground,
    playgroundMemory: new PlaygroundMemory(),
    ...(deps.claude !== undefined ? { claude: deps.claude } : {}),
    ...(deps.pageDns !== undefined ? { pageDns: deps.pageDns } : {}),
    ...(deps.readWebsitePage !== undefined ? { readWebsitePage: deps.readWebsitePage } : {}),
    emitPageReadProgress: deps.emitPageReadProgress ?? ((): void => undefined),
    emitFillProgress: deps.emitFillProgress ?? ((): void => undefined),
    memory: createEngineMemory(),
    settings: () => deps.storage.readSettings(),
    email,
    ...(deps.appTools !== undefined ? { appTools: deps.appTools } : {}),
    ...(deps.onThemeChanged !== undefined ? { onThemeChanged: deps.onThemeChanged } : {})
  }
  return context
}

export function runCheckChannel<T>(channel: string, run: () => Promise<T> | T): Promise<T> {
  return Promise.resolve()
    .then(run)
    .catch((error: unknown) => {
      if (error instanceof CheckInputError) throw new IpcRequestError(channel, error.message)
      throw error
    })
}

export function guard<T>(
  channel: string,
  ctx: EngineContext,
  run: () => Promise<T> | T
): Promise<T> {
  return Promise.resolve()
    .then(run)
    .catch((error: unknown) => {
      throw safeFailure(channel, ctx, error)
    })
}

const CLAUDE_STOP_CODES: ReadonlySet<ProviderErrorCode> = new Set([
  'plan_limit',
  'plan_inactive',
  'credit_low',
  'logged_out',
  'unauthorized',
  'rate_limited',
  'overloaded',
  'not_installed'
])

function safeFailure(channel: string, ctx: EngineContext, error: unknown): Error {
  const secrets = ctx.knownSecrets()
  ctx.logger.error(`${channel} failed`, error)
  if (error instanceof TemplateContractError) return error
  if (error instanceof IpcRequestError) {
    const redacted = redactString(error.message, { secrets })
    if (redacted === error.message) return error
    return new IpcRequestError(channel, 'Request failed', error.nextStep)
  }
  if (error instanceof PipelineError || error instanceof StorageError) {
    const message = redactString(error.message, { secrets })
    const nextStep = error instanceof PipelineError ? error.nextStep : null
    if (message !== error.message) return new IpcRequestError(channel, 'Request failed', nextStep)
    return new IpcRequestError(channel, message, nextStep)
  }
  // A Claude call that stopped (limit, signed out, no credit): its own words already say
  // what happened and what to do, so they reach the window instead of "Request failed".
  if (error instanceof ProviderError && CLAUDE_STOP_CODES.has(error.code)) {
    const message = redactString(error.message, { secrets })
    if (message === error.message) return new IpcRequestError(channel, message, error.nextStep)
  }
  const message = error instanceof Error ? error.message : 'Request failed'
  const redacted = redactString(message, { secrets })
  if (redacted !== message) return new IpcRequestError(channel, 'Request failed')
  if (message.startsWith(`${channel}:`)) {
    return new IpcRequestError(channel, message.slice(channel.length + 2))
  }
  return new IpcRequestError(channel, 'Request failed')
}
