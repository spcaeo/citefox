import { release as osRelease, homedir } from 'node:os'
import { aiProviderName, type ApiKeyProvider, type ClaudeProvider } from '@shared/domain'
import type {
  AppInfo,
  BuildDiagnosticsRequest,
  DiagnosticsOpenResult,
  DiagnosticsReport,
  OpenReportMailRequest,
  SaveDiagnosticsRequest,
  SaveDiagnosticsResult,
  SendDiagnosticsRequest,
  SendDiagnosticsResult
} from '@shared/ipc'
import { DIAGNOSTICS_TEXT_MAX } from '@shared/ipc'
import { reportMailtoUrl } from '@shared/problem-report'
import { releaseLine } from '@shared/release-line'
import type { ReportRoute } from '../handlers/account'
import { IpcRequestError } from '../ipc-request'
import { appLogFilePath } from '../logging/file-sink'
import type { Logger } from '../logging/logger'
import type { HttpTransport } from '../providers/http'
import { saveText } from '../project-transfer/dialogs'
import type { SecretStore } from '../secrets/secret-store'
import type { AppStorage } from '../storage/app-storage'
import { listApiKeys } from '../storage/api-key-records'
import { getLatestClaudeCheckup } from '../storage/checkup-records'
import { projectDatabasePool } from '../storage/project-db-pool'
import { getProject, listProjects } from '../storage/records'
import {
  readProjectFailures,
  summariseFailures,
  type FailedCheck,
  type FailedCheckSummary
} from './failed-checks'
import { LOG_TAIL_LINES, tailLogLines } from './log-tail'
import { fileNameOnly, redactReport } from './redact'
import { formatReport, type AiFacts, type KeyFacts, type ReportFacts } from './report'
import { packReport } from './pack'
import { reportSummary, sendReport } from './send'
import { openExternalUrl, revealLogFile } from './shell'

/** What the report says about this computer. Tests pass their own. */
export interface SystemFacts {
  platform: string
  arch: string
  osRelease: string
  electron: string
  node: string
  chrome: string
  locale: string
  timeZone: string
}

export function currentSystemFacts(): SystemFacts {
  const resolved = Intl.DateTimeFormat().resolvedOptions()
  return {
    platform: process.platform,
    arch: process.arch,
    osRelease: osRelease(),
    electron: process.versions.electron ?? 'not running in Electron',
    node: process.versions.node,
    chrome: process.versions.chrome ?? 'unknown',
    locale: resolved.locale,
    timeZone: resolved.timeZone
  }
}

export interface DiagnosticsDeps {
  storage: AppStorage
  secrets: SecretStore
  appInfo: () => AppInfo
  logger: Logger
  /** Exact secrets to remove everywhere, on top of the keys read from the key store. */
  knownSecrets?: () => readonly string[]
  now?: () => Date
  system?: () => SystemFacts
  /** The home folder to hide. Default: this computer's. */
  home?: () => string
  /** Where "Send to CiteFox" goes. Absent or with no endpoint: nothing is ever sent. */
  reports?: ReportRoute
  /** The transport for "Send to CiteFox". */
  http?: HttpTransport
  /** Test seam: the report id. */
  newReportId?: () => string
}

export interface DiagnosticsService {
  build(request: BuildDiagnosticsRequest): DiagnosticsReport
  send(request: SendDiagnosticsRequest): Promise<SendDiagnosticsResult>
  save(request: SaveDiagnosticsRequest): Promise<SaveDiagnosticsResult>
  revealLogs(): DiagnosticsOpenResult
  openMail(request: OpenReportMailRequest): Promise<DiagnosticsOpenResult>
}

/** Key kinds as the person knows them. Never the provider's own name. */
const KEY_LABELS: Readonly<Record<ApiKeyProvider, string>> = {
  serpapi: 'Google search key',
  cloro: 'CiteFox credits key',
  jina: 'Page reader key',
  anthropic: 'AI key',
  youtube: 'YouTube key'
}

const KEY_ORDER: readonly ApiKeyProvider[] = ['serpapi', 'cloro', 'jina', 'anthropic', 'youtube']

function connectionName(provider: ClaudeProvider): string {
  return provider === 'anthropic-api' ? 'AI key' : aiProviderName(provider)
}

/** Every key's state, with yes or no for "set up". Reads metadata only, never a secret. */
function keyFacts(storage: AppStorage): KeyFacts[] {
  const records = listApiKeys(storage.db)
  return KEY_ORDER.map((provider) => {
    const own = records.filter((record) => record.provider === provider && record.on)
    const first = own[0]
    const worst = own.find((record) => record.state === 'warning') ?? first
    return {
      label: KEY_LABELS[provider],
      configured: first !== undefined,
      state: worst?.state ?? null,
      reason: worst?.lastReason ?? null
    }
  })
}

function aiFacts(storage: AppStorage): AiFacts {
  const settings = storage.readSettings()
  const provider = settings.claudeProvider
  const configured =
    provider === 'codex'
      ? settings.codexBinaryPath
      : provider === 'claude-code'
        ? settings.claudeBinaryPath
        : null
  const latest = getLatestClaudeCheckup(storage.db)
  const checkup = latest?.result ?? null
  return {
    connection: connectionName(provider),
    programFile: fileNameOnly(configured ?? checkup?.binaryPath ?? null),
    checkup:
      latest === null || checkup === null
        ? null
        : {
            program: aiProviderName(checkup.provider ?? 'claude-code'),
            ranAt: latest.ranAt,
            ready: checkup.ready,
            login: checkup.login,
            roundTrip: checkup.roundTrip,
            version: checkup.version,
            message: checkup.message
          }
  }
}

/** Every secret that could leak: the registry's, and each saved key read from the key store. */
function secretsToRemove(deps: DiagnosticsDeps): string[] {
  const found = new Set<string>(deps.knownSecrets?.() ?? [])
  try {
    for (const record of listApiKeys(deps.storage.db)) {
      const secret = deps.secrets.get(record.keychainRef)
      if (secret) found.add(secret)
    }
  } catch {
    // A locked key store: the pattern rules below still apply.
  }
  return [...found].filter((secret) => secret.length > 0)
}

function failedChecks(
  deps: DiagnosticsDeps,
  projectId: string | null,
  includeQuestions: boolean
): FailedCheckSummary | null {
  try {
    const one = projectId === null ? null : getProject(deps.storage.db, projectId)
    const projects = one === null ? listProjects(deps.storage.db) : [one]
    const pool = projectDatabasePool(deps.storage)
    const perProject: FailedCheck[][] = []
    let unreadable = 0
    for (const project of projects) {
      try {
        perProject.push(readProjectFailures(pool.get(project.slug), includeQuestions))
      } catch {
        unreadable += 1
      }
    }
    return summariseFailures(perProject, unreadable)
  } catch (error) {
    deps.logger.warn('the problem report could not read the failed checks', {
      message: error instanceof Error ? error.message : 'failed'
    })
    return null
  }
}

function checkNote(note: unknown): string {
  if (typeof note !== 'string') throw new IpcRequestError('diagnostics:build', 'Invalid note')
  return note
}

export function createDiagnosticsService(deps: DiagnosticsDeps): DiagnosticsService {
  const now = deps.now ?? ((): Date => new Date())
  const logFile = appLogFilePath(deps.storage.paths.root)
  const strict = (text: string): string =>
    redactReport(text, { secrets: secretsToRemove(deps), home: (deps.home ?? homedir)() })

  function releaseOf(): string {
    const info = deps.appInfo()
    return releaseLine({
      version: info.version,
      number: info.build?.number ?? null,
      builtAt: info.build?.builtAt ?? null
    })
  }

  function collect(request: BuildDiagnosticsRequest): ReportFacts {
    const info = deps.appInfo()
    return {
      madeAt: now(),
      app: {
        name: info.name,
        version: info.version,
        buildNumber: info.build?.number ?? null,
        builtAt: info.build?.builtAt ?? null,
        commit: info.build?.commit ?? null
      },
      system: (deps.system ?? currentSystemFacts)(),
      ai: aiFacts(deps.storage),
      keys: keyFacts(deps.storage),
      failures: failedChecks(deps, request.projectId, request.includeQuestions),
      includeQuestions: request.includeQuestions,
      note: checkNote(request.note),
      log: tailLogLines(logFile, LOG_TAIL_LINES),
      logTailLines: LOG_TAIL_LINES
    }
  }

  return {
    build(request) {
      const text = strict(formatReport(collect(request)))
      return {
        text,
        bytes: Buffer.byteLength(text, 'utf8'),
        lines: text.split('\n').length,
        release: releaseOf()
      }
    },

    async send(request) {
      if (request.consent !== true) {
        throw new IpcRequestError('diagnostics:send', 'The report is sent only after you agree')
      }
      if (request.text !== undefined && request.text.length > DIAGNOSTICS_TEXT_MAX) {
        throw new IpcRequestError('diagnostics:send', 'The report is too long to send')
      }
      const facts = collect(request)
      const report = request.text !== undefined ? strict(request.text) : strict(formatReport(facts))
      const info = deps.appInfo()
      const log = strict(tailLogLines(logFile, 4000).join('\n')).split('\n')
      const packed = packReport({
        report,
        log: log.length === 1 && log[0] === '' ? [] : log,
        environment: environmentJson(facts, strict, releaseOf())
      })
      const sent = await sendReport(
        deps.reports,
        deps.http ?? NO_HTTP,
        {
          version: info.version,
          build: info.build?.number ?? null,
          os: facts.system.platform,
          arch: facts.system.arch,
          note: strict(request.note),
          summary: reportSummary(report),
          zip: packed.zip
        },
        deps.newReportId?.()
      )
      if (!sent.ok && sent.error !== 'offline') {
        deps.logger.warn('the problem report was not sent', { reason: sent.error })
      }
      return sent
    },

    async save(request) {
      if (request.text.length > DIAGNOSTICS_TEXT_MAX) {
        throw new IpcRequestError('diagnostics:save', 'The report is too long to save')
      }
      const stamp = now().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
      const saved = await saveText(
        {
          title: 'Save the problem report',
          defaultName: `citefox-problem-report-${stamp}.txt`,
          filter: { name: 'Text file', extensions: ['txt'] }
        },
        strict(request.text)
      )
      if (saved.ok) return { saved: true, filename: saved.filename }
      if (saved.cancelled) return { saved: false }
      throw new IpcRequestError('diagnostics:save', saved.reason, saved.nextStep)
    },

    revealLogs() {
      return revealLogFile(deps.storage.paths.root, logFile)
    },

    async openMail(request) {
      const url = reportMailtoUrl(releaseOf(), strict(request.note))
      return openExternalUrl(url)
    }
  }
}

/** A transport that never answers: used only when none was given, and then no endpoint is set. */
const NO_HTTP: HttpTransport = {
  request: () => Promise.reject(new Error('No network transport'))
}

/** The non-secret facts as JSON (`environment.json`). Each text is cleaned on its own. */
function environmentJson(
  facts: ReportFacts,
  clean: (text: string) => string,
  release: string
): string {
  const text = (value: string | null): string | null => (value === null ? null : clean(value))
  const environment = {
    release: clean(release),
    app: {
      name: facts.app.name,
      version: facts.app.version,
      build: facts.app.buildNumber,
      builtAt: facts.app.builtAt,
      commit: facts.app.commit
    },
    system: {
      platform: facts.system.platform,
      arch: facts.system.arch,
      osRelease: facts.system.osRelease,
      electron: facts.system.electron,
      chromium: facts.system.chrome,
      node: facts.system.node,
      locale: facts.system.locale,
      timeZone: facts.system.timeZone
    },
    aiProgram: {
      connection: facts.ai.connection,
      programFile: text(facts.ai.programFile),
      checkup:
        facts.ai.checkup === null
          ? null
          : {
              program: facts.ai.checkup.program,
              ranAt: facts.ai.checkup.ranAt,
              ready: facts.ai.checkup.ready,
              signedIn: facts.ai.checkup.login,
              testQuestion: facts.ai.checkup.roundTrip,
              version: text(facts.ai.checkup.version),
              message: clean(facts.ai.checkup.message)
            }
    },
    keys: facts.keys.map((key) => ({
      kind: key.label,
      configured: key.configured,
      state: key.state,
      lastProblem: key.reason
    })),
    failedChecks: (facts.failures?.counts ?? []).map((item) => ({
      engine: item.engine,
      reason: item.code,
      count: item.count
    })),
    questionTextsIncluded: facts.includeQuestions
  }
  return `${JSON.stringify(environment, null, 2)}\n`
}
