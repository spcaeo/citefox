import {
  API_KEY_HINT_LENGTH,
  DEFAULT_CLAUDE_CONCURRENCY,
  DEFAULT_CLAUDE_PROVIDER,
  DEFAULT_INTERVAL_DAYS,
  DEFAULT_JINA_MODE,
  DEFAULT_MARKET_DEVICE,
  DEFAULT_PROMPT_COUNT,
  DEFAULT_SAMPLE_COUNT,
  DEFAULT_SERPAPI_ROTATION,
  isCountryCode,
  isLanguageTag,
  type ApiKeyMetadata,
  type ApiKeyProvider,
  type AppSettings,
  type ConnectionState,
  type SerpApiUsage
} from '@shared/domain'
import type {
  AddApiKeyRequest,
  AppSettingsPatch,
  AppSettingsSnapshot,
  ClaudeCheckupPhase,
  ClaudeCheckupProgress,
  ClaudeCheckupRow,
  ExportAllDataResult,
  KeyIdRequest,
  KeyTestReason,
  KeyTestResult,
  OnboardingDraft,
  OnboardingProfile,
  OnboardingState,
  OnboardingStepState,
  OpenDataFolderResult,
  OpenTerminalResult,
  RemoveKeyResult,
  RenameKeyRequest,
  ReplaceKeyRequest,
  RunClaudeCheckupRequest,
  SaveProfileRequest,
  SetKeyCapRequest,
  SetKeyOnRequest,
  StatusCapsule
} from '@shared/ipc'
import { rollUpClaudeState, rollUpKeyState, searchesLeftForKey } from '../keys/health'
import { statusIssueCount } from '../shell/model'
import type { OnboardingClient } from './client'
import {
  API_KEY_LOGIN_LABEL,
  type OnboardingCheckupResult,
  type OnboardingConnections
} from './claudeLogin'
import { checkDomainInMock, fillFromDomain, searchProductInMock } from '../mocks/m2/fill'
import { registerMockOnboarding } from './mockSections'
import { MOCK_DRAFT_STORAGE_KEY, MOCK_PACE_STORAGE_KEY, MOCK_SCENARIO_STORAGE_KEY } from './flags'
import { matchSerpApiLocation } from './markets'
import { asProviderScript } from './mockCodex'

/**
 * In-memory stand-in for the M1 engine. Secrets stay in a map inside this
 * module and are never copied onto a result, an event, or an error.
 * A secret of 8 characters or fewer is stored with an empty hint.
 */

const HINT_OMIT_MAX_LENGTH = 8

export const MOCK_SCENARIOS = [
  'success',
  'serpapi-fail',
  'serpapi-quota',
  'serpapi-rate',
  'serpapi-timeout',
  'serpapi-bad',
  'jina-fail',
  'anthropic-fail',
  'checkup-logged-out',
  'checkup-missing',
  'checkup-fail',
  'checkup-api-key',
  'keychain-missing'
] as const

export type MockScenario = (typeof MOCK_SCENARIOS)[number]

export interface MockClientOptions {
  scenario?: () => MockScenario
  /** Milliseconds between checkup progress events. */
  paceMs?: number
  wait?: (ms: number) => Promise<void>
  /** Seed for the sample catalog. The default mock starts with no profile. */
  initialProfile?: OnboardingProfile | null
  initialFinished?: boolean
  /** True: the Claude Code checkup already passed (the onboarded seed). */
  seedCheckup?: boolean
  /** What "restart" means after a reset. Default: reload the page a moment later. */
  restart?: () => void
}

export function maskedHint(secret: string): string {
  if (secret.length <= HINT_OMIT_MAX_LENGTH) return ''
  return secret.slice(-API_KEY_HINT_LENGTH)
}

function reloadSoon(): void {
  if (typeof window === 'undefined') return
  window.setTimeout(() => window.location.reload(), 600)
}

function isMockScenario(value: string): value is MockScenario {
  return MOCK_SCENARIOS.some((item) => item === value)
}

function readScenario(): MockScenario {
  if (typeof localStorage === 'undefined') return 'success'
  const stored = localStorage.getItem(MOCK_SCENARIO_STORAGE_KEY)
  if (stored && isMockScenario(stored)) return stored
  return 'success'
}

function readStoredDraft(): OnboardingDraft | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const stored = localStorage.getItem(MOCK_DRAFT_STORAGE_KEY)
    return stored ? (JSON.parse(stored) as OnboardingDraft) : null
  } catch {
    return null
  }
}

function storeDraft(draft: OnboardingDraft | null): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (draft === null) localStorage.removeItem(MOCK_DRAFT_STORAGE_KEY)
    else localStorage.setItem(MOCK_DRAFT_STORAGE_KEY, JSON.stringify(draft))
  } catch {
    // The draft is a convenience; the mock still runs without storage.
  }
}

function readPace(fallback: number): number {
  if (typeof localStorage === 'undefined') return fallback
  const stored = localStorage.getItem(MOCK_PACE_STORAGE_KEY)
  if (!stored) return fallback
  const parsed = Number(stored)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return parsed
}

function channelError(channel: string, message: string): Error {
  return new Error(`${channel}: ${message}`)
}

function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug.length > 0 ? slug : 'project'
}

function defaultSettings(): AppSettings {
  return {
    userName: null,
    defaultCountry: null,
    defaultLanguage: null,
    defaultLocation: null,
    defaultDevice: DEFAULT_MARKET_DEVICE,
    defaultIntervalDays: DEFAULT_INTERVAL_DAYS,
    defaultSamples: DEFAULT_SAMPLE_COUNT,
    defaultPromptCount: DEFAULT_PROMPT_COUNT,
    claudeBinaryPath: null,
    claudeConcurrency: DEFAULT_CLAUDE_CONCURRENCY,
    // Null means the CLI's default model. The mock does not invent a model name.
    claudeModel: null,
    claudeProvider: DEFAULT_CLAUDE_PROVIDER,
    jinaMode: DEFAULT_JINA_MODE
  }
}

function copyKey(key: ApiKeyMetadata): ApiKeyMetadata {
  return {
    ...key,
    projectIds: [...key.projectIds],
    serpapiUsage: key.serpapiUsage ? { ...key.serpapiUsage } : null
  }
}

const FAIL_MESSAGE: Readonly<Record<ApiKeyProvider, string>> = {
  serpapi: 'SerpApi rejected this key. Check the key on your SerpApi dashboard and paste it again.',
  cloro: 'cloro rejected this key. Copy a new key from the cloro dashboard and paste it again.',
  jina: 'Jina rejected this key. Check the key and paste it again.',
  anthropic: 'Anthropic rejected this key. Check the key and paste it again.',
  youtube: 'YouTube rejected this key. Check the key and paste it again.'
}

const OK_MESSAGE: Readonly<Record<ApiKeyProvider, string>> = {
  serpapi: 'Key works · 38 of 250 searches used this month · Developer plan',
  cloro: 'Key works. 37,500 of 37,500 credits left this cycle.',
  jina: 'Key works. CiteFox will use the higher rate limits.',
  anthropic: 'Key works. CiteFox will bill this Anthropic API key.',
  youtube: 'Key works.'
}

function checkupRow(
  state: ClaudeCheckupRow['state'],
  statusLabel: string,
  detail: string,
  nextStep: string | null
): ClaudeCheckupRow {
  return { state, statusLabel, detail, nextStep }
}

const BINARY_OK = checkupRow('ok', 'OK', '/usr/local/bin/claude · version 2.4.1', null)
const LOGIN_OK = checkupRow('ok', 'OK', 'Claude Max plan', null)
const ROUND_OK = checkupRow('ok', 'OK', 'Replied in 3.2 s', null)

function readyResult(binaryPath: string): OnboardingCheckupResult {
  return {
    binaryPath,
    version: '2.4.1',
    login: 'logged_in',
    plan: 'Claude Max',
    roundTrip: 'ok',
    durationMs: 3200,
    resolvedModel: 'claude-sonnet-5-5',
    ready: true,
    message: 'Claude Code is ready.',
    nextStep: null,
    rows: { binary: BINARY_OK, login: LOGIN_OK, roundTrip: ROUND_OK }
  }
}

function progress(
  phase: ClaudeCheckupPhase,
  state: ClaudeCheckupProgress['state'],
  detail: string,
  nextStep: string | null
): ClaudeCheckupProgress {
  return { phase, state, detail, nextStep }
}

function runningThen(
  phase: ClaudeCheckupPhase,
  state: Exclude<ClaudeCheckupProgress['state'], 'running'>,
  runningDetail: string,
  detail: string,
  nextStep: string | null
): ClaudeCheckupProgress[] {
  return [progress(phase, 'running', runningDetail, null), progress(phase, state, detail, nextStep)]
}

interface CheckupScript {
  events: readonly ClaudeCheckupProgress[]
  result: OnboardingCheckupResult
}

function checkupScript(scenario: MockScenario, binaryPath: string | null): CheckupScript {
  const found =
    binaryPath && binaryPath.trim().length > 0 ? binaryPath.trim() : '/usr/local/bin/claude'
  if (scenario === 'checkup-missing' && !(binaryPath && binaryPath.trim().length > 0)) {
    const next = 'Install Claude Code, then open Terminal, run claude and log in. Then check again.'
    return {
      events: [
        ...runningThen(
          'binary',
          'warning',
          'Looking for Claude Code…',
          'CiteFox looked on your PATH and in the usual install folders.',
          'Install Claude Code, or tell CiteFox where it is.'
        ),
        progress('login', 'skipped', 'Checked after Claude Code is found', null),
        progress('roundTrip', 'skipped', 'Runs after Claude Code is found', null)
      ],
      result: {
        binaryPath: null,
        version: null,
        login: 'skipped',
        plan: null,
        roundTrip: 'skipped',
        durationMs: null,
        resolvedModel: null,
        ready: false,
        message: 'Install Claude Code, or tell CiteFox where it is.',
        nextStep: next,
        rows: {
          binary: checkupRow(
            'warning',
            'Not found on PATH',
            'CiteFox looked on your PATH and in the usual install folders.',
            'Install Claude Code, or tell CiteFox where it is.'
          ),
          login: checkupRow('skipped', 'Skipped', 'Checked after Claude Code is found', null),
          roundTrip: checkupRow('skipped', 'Skipped', 'Runs after Claude Code is found', null)
        }
      }
    }
  }

  if (scenario === 'checkup-logged-out') {
    const next = 'Open Terminal, run claude, and log in. Then check again.'
    return {
      events: [
        ...runningThen('binary', 'ok', 'Looking for Claude Code…', BINARY_OK.detail, null),
        ...runningThen(
          'login',
          'warning',
          'Checking the login…',
          'Claude Code is installed, but no account is logged in.',
          next
        ),
        progress('roundTrip', 'skipped', 'Runs after you log in', null)
      ],
      result: {
        binaryPath: found,
        version: '2.4.1',
        login: 'logged_out',
        plan: null,
        roundTrip: 'skipped',
        durationMs: null,
        resolvedModel: null,
        ready: false,
        message: 'Log in from your terminal.',
        nextStep: next,
        rows: {
          binary: BINARY_OK,
          login: checkupRow(
            'warning',
            'Not logged in',
            'Claude Code is installed, but no account is logged in.',
            next
          ),
          roundTrip: checkupRow('skipped', 'Skipped', 'Runs after you log in', null)
        }
      }
    }
  }

  if (scenario === 'checkup-api-key') {
    const detail = 'Claude Code is using an API key, not a subscription login.'
    const next =
      'Open Terminal, run claude, and log in with your own plan. For client work, add an Anthropic API key in CiteFox.'
    return {
      events: [
        ...runningThen('binary', 'ok', 'Looking for Claude Code…', BINARY_OK.detail, null),
        ...runningThen('login', 'warning', 'Checking the login…', detail, next),
        progress('roundTrip', 'skipped', 'Runs after you log in with your plan', null)
      ],
      result: {
        binaryPath: found,
        version: '2.4.1',
        login: 'api_key',
        plan: null,
        roundTrip: 'skipped',
        durationMs: null,
        resolvedModel: null,
        ready: false,
        message: detail,
        nextStep: next,
        rows: {
          binary: BINARY_OK,
          login: checkupRow('warning', API_KEY_LOGIN_LABEL, detail, next),
          roundTrip: checkupRow('skipped', 'Skipped', 'Runs after you log in with your plan', null)
        }
      }
    }
  }

  if (scenario === 'checkup-fail') {
    const next = 'Check again in a moment. If it keeps failing, open Terminal and run claude.'
    return {
      events: [
        ...runningThen('binary', 'ok', 'Looking for Claude Code…', BINARY_OK.detail, null),
        ...runningThen('login', 'ok', 'Checking the login…', LOGIN_OK.detail, null),
        ...runningThen(
          'roundTrip',
          'warning',
          'Sending a test reply…',
          'The test call did not get a reply.',
          next
        )
      ],
      result: {
        binaryPath: found,
        version: '2.4.1',
        login: 'logged_in',
        plan: 'Claude Max',
        roundTrip: 'failed',
        durationMs: null,
        resolvedModel: null,
        ready: false,
        message: 'The test call did not get a reply.',
        nextStep: next,
        rows: {
          binary: BINARY_OK,
          login: LOGIN_OK,
          roundTrip: checkupRow('warning', 'No reply', 'The test call did not get a reply.', next)
        }
      }
    }
  }

  return {
    events: [
      ...runningThen('binary', 'ok', 'Looking for Claude Code…', BINARY_OK.detail, null),
      ...runningThen('login', 'ok', 'Checking the login…', LOGIN_OK.detail, null),
      ...runningThen('roundTrip', 'ok', 'Sending a test reply…', ROUND_OK.detail, null)
    ],
    result: readyResult(found)
  }
}

export interface MockOnboardingClient extends OnboardingClient {
  setKeyOn(request: SetKeyOnRequest): Promise<ApiKeyMetadata>
  /** Onboarding v2 finishSetup (mockSections.ts): finishes with or without a search key. */
  completeSetup(): { state: OnboardingState; searchKey: boolean }
  /** Drops the in-memory keychain item. The metadata row stays. */
  forgetKeychain(id: string): void
}

type KeyTestFault = 'rejected' | 'quota' | 'rate' | 'timeout' | 'bad'

/**
 * A failed test is `warning`: a rejected key (401/403), no searches left, a 429,
 * a timeout, a bad response, or a missing keychain item.
 * `off` is only "no key" or "the user turned it off".
 * `unchecked` is a saved key whose keychain item is present and has not been tested.
 */
function faultFor(scenario: MockScenario, provider: ApiKeyProvider): KeyTestFault | null {
  if (scenario === `${provider}-fail`) return 'rejected'
  if (provider !== 'serpapi') return null
  if (scenario === 'serpapi-quota') return 'quota'
  if (scenario === 'serpapi-rate') return 'rate'
  if (scenario === 'serpapi-timeout') return 'timeout'
  if (scenario === 'serpapi-bad') return 'bad'
  return null
}

function faultMessage(provider: ApiKeyProvider, fault: KeyTestFault): string {
  if (fault === 'rejected') return FAIL_MESSAGE[provider]
  const name =
    provider === 'serpapi'
      ? 'SerpApi'
      : provider === 'jina'
        ? 'Jina'
        : provider === 'anthropic'
          ? 'Anthropic'
          : 'YouTube'
  if (fault === 'quota') {
    return `${name} is out of searches for this month. Raise the plan or wait until it resets.`
  }
  if (fault === 'rate') return `${name} returned 429. Wait a moment and test the key again.`
  if (fault === 'timeout') return `The ${name} test timed out. Try again.`
  return `${name} returned a response CiteFox could not read. Try the key again.`
}

export function createMockOnboardingClient(options: MockClientOptions = {}): MockOnboardingClient {
  const scenarioOf = options.scenario ?? readScenario
  const pace = options.paceMs ?? readPace(30)
  const wait =
    options.wait ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms)
      }))

  const settings = defaultSettings()
  let profile: OnboardingProfile | null = options.initialProfile
    ? {
        ...options.initialProfile,
        brandNames: [...options.initialProfile.brandNames],
        competitors: [...options.initialProfile.competitors],
        project: { ...options.initialProfile.project },
        defaultMarket: { ...options.initialProfile.defaultMarket }
      }
    : null
  let finished = options.initialFinished ?? false
  let testWindowOpen = false
  let draft: OnboardingDraft | null = finished ? null : readStoredDraft()
  if (profile) {
    settings.userName = profile.userName
    if (settings.defaultCountry === null) settings.defaultCountry = profile.defaultMarket.country
    if (settings.defaultLanguage === null) settings.defaultLanguage = profile.defaultMarket.language
    if (settings.defaultLocation === null) settings.defaultLocation = profile.defaultMarket.location
  }
  const keys: ApiKeyMetadata[] = []
  const secrets = new Map<string, string>()
  let keySeq = 0
  let checkup: OnboardingCheckupResult | null = null
  let checkupGeneration = 0
  const listeners = new Set<(payload: ClaudeCheckupProgress) => void>()
  if (options.seedCheckup) checkup = checkupScript('success', null).result

  /** A cloro or SerpApi key: either one completes the search step (onboarding v2). */
  const hasSearchKey = (): boolean =>
    keys.some((key) => (key.provider === 'serpapi' || key.provider === 'cloro') && key.on)

  function steps(): OnboardingStepState[] {
    const serp = hasSearchKey()
    const claude = checkup !== null || keys.some((key) => key.provider === 'anthropic')
    const jina = keys.some((key) => key.provider === 'jina')
    let jinaStatus: OnboardingStepState['status'] = 'pending'
    if (jina) jinaStatus = 'done'
    else if (finished) jinaStatus = 'skipped'
    return [
      { id: 'profile', status: profile ? 'done' : 'pending' },
      { id: 'serpapi', status: serp ? 'done' : 'pending' },
      { id: 'claude', status: claude ? 'done' : 'pending' },
      { id: 'jina', status: jinaStatus }
    ]
  }

  function snapshot(): OnboardingState {
    const list = steps()
    const pending = list.find((step) => step.status === 'pending')
    return {
      finished,
      currentStep: finished ? null : (pending?.id ?? null),
      profile: profile
        ? {
            ...profile,
            brandNames: [...profile.brandNames],
            competitors: [...profile.competitors],
            project: { ...profile.project },
            defaultMarket: { ...profile.defaultMarket }
          }
        : null,
      steps: list
    }
  }

  function findKey(id: string): ApiKeyMetadata {
    const found = keys.find((key) => key.id === id)
    if (!found) throw channelError('keys:test', 'No key with that id')
    return found
  }

  function cachedLastReason(
    state: ConnectionState,
    reason: KeyTestReason | null
  ): KeyTestReason | null {
    if (state !== 'warning') return null
    return reason ?? 'other'
  }

  function faultReason(fault: KeyTestFault): KeyTestReason {
    if (fault === 'rejected') return 'rejected'
    if (fault === 'quota') return 'out_of_searches'
    if (fault === 'rate') return 'rate_limited'
    if (fault === 'timeout') return 'timeout'
    return 'other'
  }

  function outcome(
    provider: ApiKeyProvider,
    secret: string
  ): {
    state: ConnectionState
    message: string
    usage: SerpApiUsage | null
    reason: KeyTestReason | null
  } {
    if (secret.length === 0) {
      return {
        state: 'warning',
        message: 'The stored key is empty. Paste the key again.',
        usage: null,
        reason: 'other'
      }
    }
    const fault = faultFor(scenarioOf(), provider)
    if (fault === 'quota' && provider === 'serpapi') {
      return {
        state: 'warning',
        message: faultMessage(provider, fault),
        usage: { used: 250, planLimit: 250, plan: 'Developer' },
        reason: 'out_of_searches'
      }
    }
    if (fault) {
      return {
        state: 'warning',
        message: faultMessage(provider, fault),
        usage: null,
        reason: faultReason(fault)
      }
    }
    if (provider === 'serpapi') {
      return {
        state: 'ok',
        message: OK_MESSAGE.serpapi,
        usage: { used: 38, planLimit: 250, plan: 'Developer' },
        reason: null
      }
    }
    return { state: 'ok', message: OK_MESSAGE[provider], usage: null, reason: null }
  }

  function storeSecret(
    channel: 'keys:add' | 'keys:replace',
    keychainRef: string,
    secret: string
  ): string {
    const stored = secret.trim()
    if (stored.length === 0) throw channelError(channel, 'A key is required')
    if (scenarioOf() === 'keychain-missing') {
      secrets.delete(keychainRef)
      return stored
    }
    secrets.set(keychainRef, stored)
    return stored
  }

  function missingKeychainMessage(provider: ApiKeyProvider): string {
    const name =
      provider === 'serpapi'
        ? 'SerpApi'
        : provider === 'jina'
          ? 'Jina'
          : provider === 'anthropic'
            ? 'Anthropic'
            : 'YouTube'
    return `The ${name} key is missing from the keychain.`
  }

  const client: MockOnboardingClient = {
    // The sample read (textbolt.com answers like the real site; mocks/m2/fill.ts).
    fillFromWebsite(request) {
      return Promise.resolve(fillFromDomain(request.domain.trim()))
    },
    onFillProgress() {
      return () => undefined
    },
    checkCompanyDomain(request) {
      return Promise.resolve(checkDomainInMock(request))
    },
    // The sample's competitors for that product (by name), as if the search ran again.
    searchProductCompetitors(request) {
      return Promise.resolve(searchProductInMock(request))
    },
    async getInfo() {
      if (typeof window !== 'undefined' && window.citefox) {
        try {
          return await window.citefox['app:getInfo']()
        } catch {
          // The mock still has a version when the bridge is down.
        }
      }
      return { name: 'CiteFox', version: '0.9.0' }
    },

    // Build menu. The sample keeps its keys, forgets the rest and "restarts" (reloads).
    async resetKeepKeys() {
      profile = null
      finished = false
      Object.assign(settings, defaultSettings())
      ;(options.restart ?? reloadSoon)()
      return { ok: true }
    },

    // One sample "test window": open once, then already open; fresh needs it closed (as in main).
    async openTestProfile(request) {
      if (request.fresh && testWindowOpen) {
        return { ok: false, message: 'Close the test window first, then start fresh.' }
      }
      const alreadyOpen = testWindowOpen
      testWindowOpen = true
      return { ok: true, alreadyOpen }
    },

    getState() {
      return Promise.resolve(snapshot())
    },

    async saveProfile(request: SaveProfileRequest) {
      // "Your name" is optional (onboarding v2): an empty one keeps the saved name.
      const userName = request.userName.trim() || settings.userName || ''
      const projectName = request.projectName.trim()
      const domain = request.domain.trim()
      if (!projectName || !domain) {
        throw channelError('onboarding:saveProfile', 'Project and domain are required')
      }
      if (request.brandNames.length === 0) {
        throw channelError('onboarding:saveProfile', 'Add at least one brand name')
      }
      if (!isCountryCode(request.country)) {
        throw channelError('onboarding:saveProfile', 'Country must be a two-letter code')
      }
      if (!isLanguageTag(request.language)) {
        throw channelError('onboarding:saveProfile', 'Language must be an ISO 639-1 or BCP-47 tag')
      }
      const slug = slugify(projectName)
      const projectId = profile?.project.id ?? 'project-1'
      profile = {
        userName,
        project: {
          id: projectId,
          name: projectName,
          slug,
          domain,
          dbPath: `projects/${slug}.sqlite`,
          clientName: null,
          status: 'active'
        },
        includeSubdomains: request.includeSubdomains,
        brandNames: [...request.brandNames],
        competitors: [...request.competitors],
        switchingFrom: [...(request.switchingFrom ?? profile?.switchingFrom ?? [])],
        integrations: [...(request.integrations ?? profile?.integrations ?? [])],
        defaultMarket: {
          id: profile?.defaultMarket.id ?? 'market-1',
          country: request.country,
          language: request.language,
          location: request.location,
          device: request.device,
          localWording: false,
          serpapiLocation: matchSerpApiLocation(request.location)
        }
      }
      settings.userName = userName || null
      if (settings.defaultCountry === null) settings.defaultCountry = request.country
      if (settings.defaultLanguage === null) settings.defaultLanguage = request.language
      if (settings.defaultLocation === null) settings.defaultLocation = request.location
      return Promise.resolve(snapshot())
    },

    async finish() {
      if (!profile || !hasSearchKey()) {
        throw channelError(
          'onboarding:finish',
          'A saved profile and a search key (cloro or SerpApi) are required'
        )
      }
      return Promise.resolve(client.completeSetup().state)
    },

    completeSetup() {
      finished = true
      draft = null
      storeDraft(null)
      return { state: snapshot(), searchKey: hasSearchKey() }
    },

    getDraft() {
      return Promise.resolve(finished ? null : draft)
    },

    saveDraft(next: OnboardingDraft) {
      if (finished) return Promise.resolve({ saved: false })
      draft = next
      storeDraft(next)
      return Promise.resolve({ saved: true })
    },

    getOverview() {
      return Promise.resolve(overview())
    },

    async addKey(request: AddApiKeyRequest) {
      const id = `key-${++keySeq}`
      const keychainRef = `${request.provider}/${id}`
      const stored = storeSecret('keys:add', keychainRef, request.secret)
      const tested = request.provider === 'anthropic' ? outcome(request.provider, stored) : null
      const state = tested ? tested.state : 'unchecked'
      const meta: ApiKeyMetadata = {
        id,
        provider: request.provider,
        name: request.name,
        keychainRef,
        hint: maskedHint(stored),
        rotationOrder: keys.filter((key) => key.provider === request.provider).length,
        cap: request.cap,
        on: true,
        projectIds: [...request.projectIds],
        state,
        lastReason: cachedLastReason(state, tested?.reason ?? null),
        serpapiUsage: tested?.usage ?? null
      }
      keys.push(meta)
      if (request.provider === 'anthropic' && meta.state === 'ok') {
        settings.claudeProvider = 'anthropic-api'
      }
      return Promise.resolve(copyKey(meta))
    },

    async testKey(request: KeyIdRequest) {
      const meta = findKey(request.id)
      const secret = secrets.get(meta.keychainRef)
      if (secret === undefined) {
        meta.state = 'warning'
        meta.lastReason = 'other'
        meta.serpapiUsage = null
        const result: KeyTestResult = {
          key: copyKey(meta),
          message: missingKeychainMessage(meta.provider),
          reason: 'other'
        }
        return result
      }
      const tested = outcome(meta.provider, secret)
      meta.state = tested.state
      meta.lastReason = cachedLastReason(tested.state, tested.reason)
      meta.serpapiUsage = tested.usage
      if (meta.provider === 'anthropic' && tested.state === 'ok') {
        settings.claudeProvider = 'anthropic-api'
      }
      const result: KeyTestResult = {
        key: copyKey(meta),
        message: tested.message,
        reason: tested.reason
      }
      return Promise.resolve(result)
    },

    async replaceKey(request: ReplaceKeyRequest) {
      const meta = keys.find((key) => key.id === request.id)
      if (!meta) throw channelError('keys:replace', 'No key with that id')
      const stored = storeSecret('keys:replace', meta.keychainRef, request.secret)
      meta.hint = maskedHint(stored)
      meta.serpapiUsage = null
      if (meta.provider === 'anthropic') {
        const tested = outcome(meta.provider, stored)
        meta.state = tested.state
        meta.lastReason = cachedLastReason(tested.state, tested.reason)
        if (tested.state === 'ok') settings.claudeProvider = 'anthropic-api'
      } else {
        meta.state = 'unchecked'
        meta.lastReason = null
      }
      return Promise.resolve(copyKey(meta))
    },

    async setKeyCap(request: SetKeyCapRequest) {
      const meta = keys.find((key) => key.id === request.id)
      if (!meta) throw channelError('keys:setCap', 'No key with that id')
      meta.cap = request.cap
      return Promise.resolve(copyKey(meta))
    },

    async setKeyOn(request: SetKeyOnRequest) {
      const meta = keys.find((key) => key.id === request.id)
      if (!meta) throw channelError('keys:setOn', 'No key with that id')
      meta.on = request.on
      return Promise.resolve(copyKey(meta))
    },

    async renameKey(request: RenameKeyRequest) {
      const meta = keys.find((key) => key.id === request.id)
      if (!meta) throw channelError('keys:rename', 'No key with that id')
      const name = request.name.trim()
      if (!name) throw channelError('keys:rename', 'A name is required')
      meta.name = name
      return Promise.resolve(copyKey(meta))
    },

    async removeKey(request: KeyIdRequest) {
      const index = keys.findIndex((key) => key.id === request.id)
      const meta = index >= 0 ? keys[index] : undefined
      if (!meta) throw channelError('keys:remove', 'No key with that id')
      keys.splice(index, 1)
      secrets.delete(meta.keychainRef)
      const result: RemoveKeyResult = { id: meta.id }
      return Promise.resolve(result)
    },

    getCapsule() {
      const view = overview()
      const capsule: StatusCapsule = {
        searchesLeft: view.searchesLeft,
        issueCount: view.issueCount,
        serpapi: view.serpapi,
        claudeCode: view.claudeCode,
        jina: view.jina,
        youtube: view.youtube
      }
      return Promise.resolve(capsule)
    },

    forgetKeychain(id: string): void {
      const meta = keys.find((key) => key.id === id)
      if (!meta) throw channelError('keys:test', 'No key with that id')
      secrets.delete(meta.keychainRef)
    },

    async runCheckup(request: RunClaudeCheckupRequest) {
      const generation = ++checkupGeneration
      const provider =
        request.provider ?? (settings.claudeProvider === 'codex' ? 'codex' : 'claude-code')
      const script = asProviderScript(checkupScript(scenarioOf(), request.binaryPath), provider)
      for (const event of script.events) {
        await wait(pace)
        if (generation !== checkupGeneration) {
          throw channelError('claudeCode:runCheckup', 'superseded')
        }
        for (const listener of listeners) listener(event)
      }
      checkup = script.result
      return structuredClone(script.result)
    },

    getCheckup() {
      return Promise.resolve(checkup ? structuredClone(checkup) : null)
    },

    openTerminal() {
      const result: OpenTerminalResult = { opened: true, message: '' }
      return Promise.resolve(result)
    },

    onCheckupProgress(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    getSettings() {
      return Promise.resolve(settingsSnapshot())
    },

    updateSettings(patch: AppSettingsPatch) {
      if (patch.userName !== undefined) settings.userName = patch.userName
      if (patch.defaultCountry !== undefined) settings.defaultCountry = patch.defaultCountry
      if (patch.defaultLanguage !== undefined) settings.defaultLanguage = patch.defaultLanguage
      if (patch.defaultLocation !== undefined) settings.defaultLocation = patch.defaultLocation
      if (patch.defaultDevice !== undefined) settings.defaultDevice = patch.defaultDevice
      if (patch.defaultIntervalDays !== undefined) {
        settings.defaultIntervalDays = patch.defaultIntervalDays
      }
      if (patch.defaultSamples !== undefined) settings.defaultSamples = patch.defaultSamples
      if (patch.defaultPromptCount !== undefined)
        settings.defaultPromptCount = patch.defaultPromptCount
      if (patch.claudeBinaryPath !== undefined) settings.claudeBinaryPath = patch.claudeBinaryPath
      if (patch.claudeConcurrency !== undefined)
        settings.claudeConcurrency = patch.claudeConcurrency
      if (patch.claudeModel !== undefined) settings.claudeModel = patch.claudeModel
      if (patch.claudeProvider !== undefined) settings.claudeProvider = patch.claudeProvider
      if (patch.jinaMode !== undefined) settings.jinaMode = patch.jinaMode
      if (patch.sidebar !== undefined) settings.sidebar = patch.sidebar
      return Promise.resolve(settingsSnapshot())
    },

    exportAllData() {
      const result: ExportAllDataResult = {
        ok: true,
        filePath: '/tmp/CiteFox/citefox-all-data.zip',
        filename: 'citefox-all-data.zip',
        bytes: 2048,
        projects: []
      }
      return Promise.resolve(result)
    },

    openDataFolder() {
      const result: OpenDataFolderResult = { ok: true }
      return Promise.resolve(result)
    }
  }
  registerMockOnboarding(client)
  return client

  function connectionFor(provider: ApiKeyProvider): ConnectionState {
    const key = keys.find((item) => item.provider === provider)
    return rollUpKeyState(key, key ? secrets.has(key.keychainRef) : true)
  }

  function overview(): OnboardingConnections {
    const serp = keys.find((key) => key.provider === 'serpapi')
    const searchesLeft =
      serp && serp.on && secrets.has(serp.keychainRef) ? searchesLeftForKey(serp) : null
    const states = {
      serpapi: connectionFor('serpapi'),
      claudeCode: rollUpClaudeState(checkup),
      jina: connectionFor('jina'),
      youtube: connectionFor('youtube')
    }
    const issueCount = statusIssueCount(states)
    return {
      serpapiRotation: DEFAULT_SERPAPI_ROTATION,
      keys: keys.map(copyKey),
      ...states,
      claudeCheckup: checkup ? structuredClone(checkup) : null,
      searchesLeft,
      issueCount
    }
  }

  function settingsSnapshot(): AppSettingsSnapshot {
    return {
      settings: { ...settings },
      dataDirectory: '/tmp/CiteFox'
    }
  }
}
