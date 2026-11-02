import type {
  AlertSettings,
  AppSchedule,
  DueList,
  EmailAccount,
  EmailMode,
  EmailSettings,
  EmailTestResult,
  ProjectSchedule
} from '@shared/domain'
import type {
  AppSchedulePatch,
  CiteFoxApi,
  EmailModeRequest,
  ProjectIdRequest,
  SaveEmailAccountRequest,
  UpdateAlertSettingsRequest,
  UpdateProjectScheduleRequest
} from '@shared/ipc'
import { explainAlertsError, usesSentence, type EmailAccountRow, type Explained } from './model'

/**
 * Schedule, alerts, and SMTP adapter.
 * The sample engine runs in the Vite dev harness and in tests. A production
 * build calls `schedule:*`, `alerts:*`, and `email:*` only.
 */
export interface AlertsClient {
  getApp(): Promise<Loaded<AppSchedule>>
  updateApp(patch: AppSchedulePatch): Promise<Loaded<AppSchedule>>
  getProject(request: ProjectIdRequest): Promise<Loaded<ProjectSchedule>>
  updateProject(request: UpdateProjectScheduleRequest): Promise<Loaded<ProjectSchedule>>
  getAlerts(request: ProjectIdRequest): Promise<Loaded<AlertView>>
  updateAlerts(request: AlertUpdate): Promise<Loaded<AlertView>>
  getEmail(): Promise<Loaded<EmailView>>
  setMode(request: EmailModeRequest): Promise<Loaded<EmailView>>
  saveAccount(request: SaveEmailAccountRequest): Promise<Loaded<EmailAccountRow>>
  removeAccount(id: string): Promise<Loaded<{ id: string }>>
  /**
   * `to` is the address in the mock-up field. Blank sends the test to the
   * account's own from address (`email:test` without `to`).
   */
  testAccount(request: { id: string; to: string }): Promise<Loaded<EmailTestResult>>
  /** The pages due in one project at its next run (`schedule:listDue`). */
  listDue(request: ProjectIdRequest): Promise<Loaded<DueList>>
}

/** FR-23.13 view. A missing monthly PDF recipient reads as an empty string for the input. */
export interface AlertView extends Omit<AlertSettings, 'monthlyPdfTo'> {
  monthlyPdfTo: string
}

/** An empty `monthlyPdfTo` clears the stored recipient. */
export interface AlertUpdate extends Omit<UpdateAlertSettingsRequest, 'monthlyPdfTo'> {
  monthlyPdfTo?: string
}

export interface EmailView {
  mode: EmailMode
  accounts: readonly EmailAccountRow[]
}

export interface Loaded<T> {
  value: T | null
  unavailable: Explained | null
}

export function createLiveAlertsClient(): AlertsClient {
  return {
    getApp() {
      return load(() => requireApi()['schedule:getApp']())
    },
    updateApp(patch) {
      return load(() => requireApi()['schedule:updateApp'](patch))
    },
    getProject(request) {
      return load(() => requireApi()['schedule:getProject'](request))
    },
    updateProject(request) {
      return load(() => requireApi()['schedule:updateProject'](request))
    },
    async getAlerts(request) {
      const loaded = await load(() => requireApi()['alerts:get'](request))
      if (!loaded.value) return { value: null, unavailable: loaded.unavailable }
      return { value: toAlertView(loaded.value), unavailable: null }
    },
    async updateAlerts(request) {
      const secret = typeof request.slackWebhook === 'string' ? request.slackWebhook : ''
      const loaded = await load(() => requireApi()['alerts:update'](toContract(request)), secret)
      if (!loaded.value) return { value: null, unavailable: loaded.unavailable }
      return { value: toAlertView(loaded.value), unavailable: null }
    },
    async getEmail() {
      const loaded = await load(() => requireApi()['email:getSettings']())
      if (!loaded.value) return { value: null, unavailable: loaded.unavailable }
      return { value: toEmailView(loaded.value), unavailable: null }
    },
    async setMode(request) {
      const loaded = await load(() => requireApi()['email:setMode'](request))
      if (!loaded.value) return { value: null, unavailable: loaded.unavailable }
      return { value: toEmailView(loaded.value), unavailable: null }
    },
    async saveAccount(request) {
      const loaded = await load(
        () => requireApi()['email:saveAccount'](request),
        request.password ?? ''
      )
      if (!loaded.value) return { value: null, unavailable: loaded.unavailable }
      return { value: toRow(loaded.value), unavailable: null }
    },
    removeAccount(id) {
      return load(() => requireApi()['email:removeAccount']({ id }))
    },
    testAccount(request) {
      const to = request.to.trim()
      return load(() =>
        requireApi()['email:test'](to ? { id: request.id, to } : { id: request.id })
      )
    },
    listDue(request) {
      return load(() => requireApi()['schedule:listDue']({ projectId: request.projectId }))
    }
  }
}

function toAlertView(settings: AlertSettings): AlertView {
  return { ...settings, emailTo: [...settings.emailTo], monthlyPdfTo: settings.monthlyPdfTo ?? '' }
}

function toContract(request: AlertUpdate): UpdateAlertSettingsRequest {
  const { monthlyPdfTo, ...rest } = request
  if (monthlyPdfTo === undefined) return rest
  const trimmed = monthlyPdfTo.trim()
  return { ...rest, monthlyPdfTo: trimmed === '' ? null : trimmed }
}

function toEmailView(settings: EmailSettings): EmailView {
  return {
    mode: settings.mode,
    accounts: settings.accounts.map((account) => toRow(account))
  }
}

function toRow(account: EmailAccount): EmailAccountRow {
  return { ...account, usedFor: usesSentence(account.usedFor), uses: account.usedFor }
}

async function load<T>(read: () => Promise<T>, secret = ''): Promise<Loaded<T>> {
  try {
    return { value: await read(), unavailable: null }
  } catch (error) {
    return { value: null, unavailable: explainAlertsError(error, secret) }
  }
}

function requireApi(): CiteFoxApi {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
