import type {
  AppSchedule,
  DueList,
  EmailAccountUse,
  EmailMode,
  EmailTestResult,
  ProjectSchedule,
  SmtpProvider
} from '@shared/domain'
import type { SaveEmailAccountRequest } from '@shared/ipc'
import type { AlertUpdate, AlertView, AlertsClient, EmailView } from './client'
import type { EmailAccountRow } from './model'

/** Ids that have a keychain stand-in. The password string is never stored. */
const STORED_SECRET = new Set<string>()

/**
 * Sample adapter for the Vite dev harness and unit tests.
 * A password is accepted on save and then dropped. Nothing here keeps the text.
 */
export function createMockAlertsClient(): AlertsClient {
  let app: AppSchedule = {
    startAtLogin: true,
    catchUpAfterSleep: true,
    checkWhenClosed: false,
    dailyCheckTime: '09:00'
  }
  let project: ProjectSchedule = {
    projectId: 'textbolt',
    defaultIntervalDays: 14,
    dailyCheckTime: '09:00',
    quietFrom: '22:00',
    quietUntil: '07:00',
    spreadAcrossDay: true,
    catchUp: true,
    paused: false,
    nextCheckAt: localTodayAt(9, 0),
    pagesDueToday: 14
  }
  let alerts: AlertView = {
    projectId: 'textbolt',
    desktop: true,
    emailAfterCheck: false,
    emailAccountId: null,
    emailTo: [],
    slackEnabled: false,
    slackWebhookStored: false,
    monthlyClientPdf: false,
    monthlyPdfTo: ''
  }
  let mode: EmailMode = 'smtp'
  const accounts: EmailAccountRow[] = [sampleGmail(), sampleSes()]

  return {
    getApp() {
      return ok({ ...app })
    },
    updateApp(patch) {
      app = { ...app, ...patch }
      return ok({ ...app })
    },
    getProject(request) {
      return ok({ ...project, projectId: request.projectId })
    },
    updateProject(request) {
      project = {
        ...project,
        projectId: request.projectId,
        defaultIntervalDays: request.defaultIntervalDays ?? project.defaultIntervalDays,
        dailyCheckTime: request.dailyCheckTime ?? project.dailyCheckTime,
        quietFrom: request.quietFrom === undefined ? project.quietFrom : request.quietFrom,
        quietUntil: request.quietUntil === undefined ? project.quietUntil : request.quietUntil,
        spreadAcrossDay: request.spreadAcrossDay ?? project.spreadAcrossDay,
        catchUp: request.catchUp ?? project.catchUp,
        paused: request.paused ?? project.paused,
        pagesDueToday: request.paused ? 0 : project.pagesDueToday || 14
      }
      return ok({ ...project })
    },
    getAlerts(request) {
      return ok({ ...alerts, projectId: request.projectId, emailTo: [...alerts.emailTo] })
    },
    updateAlerts(request) {
      alerts = applyAlerts(alerts, request)
      return ok({ ...alerts, emailTo: [...alerts.emailTo] })
    },
    getEmail() {
      return ok(emailView(mode, accounts))
    },
    setMode(request) {
      mode = request.mode
      return ok(emailView(mode, accounts))
    },
    saveAccount(request) {
      const saved = upsert(accounts, request)
      if (!saved.ok) return Promise.resolve({ value: null, unavailable: saved.unavailable })
      return ok({ ...saved.row })
    },
    removeAccount(id) {
      const index = accounts.findIndex((account) => account.id === id)
      if (index < 0) {
        return Promise.resolve({
          value: null,
          unavailable: { reason: 'That sending account is not on this computer.', nextStep: null }
        })
      }
      accounts.splice(index, 1)
      STORED_SECRET.delete(id)
      if (!accounts.some((account) => account.isDefault) && accounts[0]) {
        accounts[0] = { ...accounts[0], isDefault: true }
      }
      return ok({ id })
    },
    testAccount(request) {
      const account = accounts.find((item) => item.id === request.id)
      if (!account) {
        return Promise.resolve({
          value: null,
          unavailable: { reason: 'Save the account, then send the test.', nextStep: null }
        })
      }
      const result: EmailTestResult = {
        ok: true,
        host: account.host,
        testedAt: new Date().toISOString(),
        message: `Test sent to ${request.to} · delivered by ${account.host}.`,
        nextStep: null
      }
      const index = accounts.findIndex((item) => item.id === account.id)
      accounts[index] = {
        ...account,
        lastTestAt: result.testedAt,
        lastTestOk: true,
        lastTestMessage: null,
        lastTestNextStep: null
      }
      return ok(result)
    },
    listDue(request) {
      return ok(sampleDue(request.projectId, project.paused ? 0 : project.pagesDueToday))
    }
  }
}

function ok<T>(value: T): Promise<{ value: T; unavailable: null }> {
  return Promise.resolve({ value, unavailable: null })
}

function emailView(mode: EmailMode, accounts: readonly EmailAccountRow[]): EmailView {
  return { mode, accounts: accounts.map((account) => ({ ...account })) }
}

function applyAlerts(current: AlertView, request: AlertUpdate): AlertView {
  const next: AlertView = {
    ...current,
    projectId: request.projectId,
    emailTo: request.emailTo ? [...request.emailTo] : [...current.emailTo]
  }
  if (request.desktop !== undefined) next.desktop = request.desktop
  if (request.emailAfterCheck !== undefined) next.emailAfterCheck = request.emailAfterCheck
  if (request.emailAccountId !== undefined) next.emailAccountId = request.emailAccountId
  if (request.slackEnabled !== undefined) next.slackEnabled = request.slackEnabled
  if (request.monthlyClientPdf !== undefined) next.monthlyClientPdf = request.monthlyClientPdf
  if (request.monthlyPdfTo !== undefined) next.monthlyPdfTo = request.monthlyPdfTo
  if (typeof request.slackWebhook === 'string') {
    next.slackWebhookStored = request.slackWebhook.length > 0
  }
  return next
}

function upsert(
  accounts: EmailAccountRow[],
  request: SaveEmailAccountRequest
):
  | { ok: true; row: EmailAccountRow }
  | { ok: false; unavailable: { reason: string; nextStep: null } } {
  if (request.id === null && (request.password === null || request.password.length === 0)) {
    return {
      ok: false,
      unavailable: {
        reason: 'Enter the password or API key. It is saved in your system keychain.',
        nextStep: null
      }
    }
  }
  const id = request.id ?? `acct-${accounts.length + 1}`
  if (request.password && request.password.length > 0) STORED_SECRET.add(id)
  const previous = accounts.find((account) => account.id === id)
  const row: EmailAccountRow = {
    id,
    provider: request.provider,
    fromName: request.fromName,
    fromAddress: request.fromAddress,
    replyTo: request.replyTo,
    host: request.host,
    port: request.port,
    security: request.security,
    username: request.username,
    keychainRef: previous?.keychainRef ?? `email/${id}`,
    isDefault: request.isDefault,
    lastTestAt: previous?.lastTestAt ?? null,
    lastTestOk: previous?.lastTestOk ?? null,
    lastTestMessage: previous?.lastTestMessage ?? null,
    lastTestNextStep: previous?.lastTestNextStep ?? null,
    usedFor: previous?.usedFor ?? null,
    uses: previous?.uses ?? []
  }
  if (row.isDefault) {
    for (let index = 0; index < accounts.length; index += 1) {
      const account = accounts[index]
      if (account && account.id !== id) accounts[index] = { ...account, isDefault: false }
    }
  }
  const index = accounts.findIndex((account) => account.id === id)
  if (index >= 0) accounts[index] = row
  else accounts.unshift(row)
  return { ok: true, row: { ...row } }
}

function sampleGmail(): EmailAccountRow {
  STORED_SECRET.add('acct-gmail')
  return account('acct-gmail', 'gmail', 'you@textbolt.com', true, '2026-10-19T15:00:00.000Z', [])
}

function sampleSes(): EmailAccountRow {
  STORED_SECRET.add('acct-ses')
  return account('acct-ses', 'ses', 'reports@textbolt.com', false, '2026-10-01T15:00:00.000Z', [
    { projectId: 'acme', scheduleId: 'sched-acme', label: 'Acme Clinics client reports' }
  ])
}

function account(
  id: string,
  provider: SmtpProvider,
  fromAddress: string,
  isDefault: boolean,
  lastTestAt: string,
  uses: readonly EmailAccountUse[]
): EmailAccountRow {
  const host = provider === 'ses' ? 'email-smtp.us-east-1.amazonaws.com' : 'smtp.gmail.com'
  const username = provider === 'ses' ? 'ses-smtp-user' : fromAddress
  return {
    id,
    provider,
    fromName: 'CiteFox reports',
    fromAddress,
    replyTo: null,
    host,
    port: 587,
    security: 'starttls',
    username,
    keychainRef: `email/${id}`,
    isDefault,
    lastTestAt,
    lastTestOk: true,
    lastTestMessage: null,
    lastTestNextStep: null,
    usedFor: uses.length > 0 ? uses.map((use) => use.label).join(', ') : null,
    uses
  }
}

const SAMPLE_PATHS = ['pricing', 'features', 'blog/sms-marketing', 'integrations', 'compare']

/** `count` sample pages due at the project's next run. */
function sampleDue(projectId: string, count: number): DueList {
  const dueAt = localTodayAt(9, 0)
  return {
    day: dueAt.slice(0, 10),
    pages: Array.from({ length: count }, (_, index) => {
      const path = `${SAMPLE_PATHS[index % SAMPLE_PATHS.length] ?? 'page'}-${index + 1}`
      return {
        projectId,
        pageId: `page-${index + 1}`,
        label: null,
        title: `Sample page ${index + 1}`,
        url: `https://textbolt.com/${path}`,
        marketIds: ['us-en'],
        dueAt,
        intervalDays: 14,
        reason: 'scheduled',
        promptIds: null
      }
    })
  }
}

function localTodayAt(hour: number, minute: number): string {
  const now = new Date()
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hour,
    minute,
    0,
    0
  ).toISOString()
}
