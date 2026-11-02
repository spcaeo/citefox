import type { AppSettings, ProjectClaudeSettings } from '@shared/domain'
import { defaultProjectClaudeSettings } from '@shared/domain'
import { IpcRequestError } from '../ipc-request'
import type { Logger } from '../logging/logger'
import { redactString } from '../logging/redact'
import type { ClaudeProvider } from '../providers/claude/claude-code'
import { createClaudeCodeProvider } from '../providers/claude/claude-code'
import { createAnthropicApiProvider } from '../providers/claude/anthropic-api'
import { limitWords } from '../providers/claude/problems'
import { claudeCodePause } from '../providers/claude/shared-gate'
import { createCodexProvider } from '../providers/codex/codex'
import type { BinaryProbe } from '../providers/claude/binary'
import type { CommandTransport } from '../providers/command'
import type { HttpTransport } from '../providers/http'
import type { SecretStore } from '../secrets/secret-store'
import { recordActivity } from '../storage/activity-events'
import type { AppStorage } from '../storage/app-storage'
import { projectDatabasePool } from '../storage/project-db-pool'
import { readProjectOptions } from '../storage/project-options'
import { getApiKey, getApiKeyByProvider, getProject, type ApiKeyRecord } from '../storage/records'
import { createProjectClaudeProvider, type ProjectClaudeProvider } from './claude-fallback'
import type { EngineHost } from './host'
import { storageCallSink, withCallLog } from '../llm/call-log'
import { recordClaudeAskNotice } from '../notices/claude-ask'

/** Everything needed to build a Claude provider outside an IPC call. */
export interface CheckClaudeParts {
  storage: AppStorage
  secrets: SecretStore
  logger: Logger
  http: HttpTransport
  command: CommandTransport
  probe: BinaryProbe
  knownSecrets: () => readonly string[]
  now?: () => Date
  createId?: () => string
  /** Test seam: the primary provider, used instead of the configured one. */
  primary?: ClaudeProvider
}

/** One resolved connection: the Claude Code login, a named Anthropic API key, or Codex. */
export type ClaudeConnectionRef =
  { kind: 'claude-code' } | { kind: 'api-key'; key: ApiKeyRecord } | { kind: 'codex' }

/** FR-11.7 for one project, with `app_default` already turned into a connection. */
export interface ProjectClaudePlan {
  /** Null when the chosen connection is missing (no Anthropic key, or a removed key). */
  connection: ClaudeConnectionRef | null
  /** Why `connection` is null, in plain words. */
  missing: string | null
  claude: ProjectClaudeSettings
  model: string | null
  projectName: string | null
}

/** The project's stored Claude settings, or the defaults. A missing project reads defaults. */
export function readProjectClaude(
  storage: AppStorage,
  projectId: string | null
): {
  claude: ProjectClaudeSettings
  projectName: string | null
} {
  if (projectId === null) return { claude: defaultProjectClaudeSettings(), projectName: null }
  const project = getProject(storage.db, projectId)
  if (project === null) return { claude: defaultProjectClaudeSettings(), projectName: null }
  try {
    const db = projectDatabasePool(storage).get(project.slug)
    return { claude: readProjectOptions(db).claude, projectName: project.name }
  } catch {
    return { claude: defaultProjectClaudeSettings(), projectName: project.name }
  }
}

/** LLM-5. The project's model, else the app model. */
export function projectClaudeModel(host: EngineHost, projectId: string | null): string | null {
  return readProjectClaude(host.storage, projectId).claude.model ?? host.settings().claudeModel
}

export function planProjectClaude(
  storage: AppStorage,
  settings: AppSettings,
  projectId: string | null
): ProjectClaudePlan {
  const { claude, projectName } = readProjectClaude(storage, projectId)
  const model = claude.model ?? settings.claudeModel
  const base = { claude, model, projectName }
  if (claude.connection === 'claude_code') {
    return { ...base, connection: { kind: 'claude-code' }, missing: null }
  }
  if (claude.connection === 'api_key') {
    const key = claude.keyId === null ? null : getApiKey(storage.db, claude.keyId)
    if (key === null || key.provider !== 'anthropic') {
      return {
        ...base,
        connection: null,
        missing: "This project's Anthropic API key was removed. Choose another in Project settings"
      }
    }
    return { ...base, connection: { kind: 'api-key', key }, missing: null }
  }
  if (settings.claudeProvider === 'anthropic-api') {
    const key = getApiKeyByProvider(storage.db, 'anthropic')
    if (key === null) {
      return { ...base, connection: null, missing: 'Add an Anthropic API key first' }
    }
    return { ...base, connection: { kind: 'api-key', key }, missing: null }
  }
  if (settings.claudeProvider === 'codex') {
    return { ...base, connection: { kind: 'codex' }, missing: null }
  }
  return { ...base, connection: { kind: 'claude-code' }, missing: null }
}

export function connectionLabel(connection: ClaudeConnectionRef): string {
  if (connection.kind === 'codex') return 'Codex'
  return connection.kind === 'claude-code'
    ? 'Claude Code'
    : `Anthropic API · ${connection.key.name}`
}

function connectionProvider(
  parts: CheckClaudeParts,
  settings: AppSettings,
  connection: ClaudeConnectionRef,
  model: string | null
): ClaudeProvider {
  if (connection.kind === 'api-key') {
    return createAnthropicApiProvider({
      transport: parts.http,
      secretStore: parts.secrets,
      keychainRef: connection.key.keychainRef,
      logger: parts.logger,
      concurrency: settings.claudeConcurrency,
      model,
      secrets: parts.knownSecrets
    })
  }
  if (connection.kind === 'codex') {
    // `model` is the project's Claude model; Codex uses its own settings instead.
    return createCodexProvider({
      command: parts.command,
      probe: parts.probe,
      logger: parts.logger,
      concurrency: settings.claudeConcurrency,
      savedBinaryPath: settings.codexBinaryPath ?? null,
      model: settings.codexModel ?? null,
      quickModel: settings.codexQuickModel ?? null,
      secrets: parts.knownSecrets
    })
  }
  return createClaudeCodeProvider({
    command: parts.command,
    probe: parts.probe,
    logger: parts.logger,
    concurrency: settings.claudeConcurrency,
    savedBinaryPath: settings.claudeBinaryPath,
    model,
    secrets: parts.knownSecrets
  })
}

/**
 * FR-11.7 and LLM-10. The project's connection wrapped with its fallback rule.
 * Every call is recorded for Connections' last 24 hours and Usage by project.
 */
function wrapForProject(
  parts: CheckClaudeParts,
  settings: AppSettings,
  plan: ProjectClaudePlan & { connection: ClaudeConnectionRef },
  primary: ClaudeProvider,
  projectId: string | null
): ProjectClaudeProvider {
  const now = parts.now ?? ((): Date => new Date())
  let sequence = 0
  const id = (): string => {
    if (parts.createId !== undefined) return parts.createId()
    sequence += 1
    return `act-${now().getTime().toString(36)}-${sequence}-${Math.random().toString(36).slice(2, 10)}`
  }
  const record = (
    kind: 'claude_call' | 'claude_limit' | 'claude_fallback',
    keyId: string | null,
    detail: string | null
  ): void => {
    try {
      recordActivity(parts.storage.db, {
        id: id(),
        at: now().toISOString(),
        kind,
        keyId,
        projectId,
        count: 1,
        detail
      })
    } catch (error) {
      parts.logger.warn('could not record Claude activity', {
        message: redactString(error instanceof Error ? error.message : 'write failed', {
          secrets: parts.knownSecrets()
        })
      })
    }
  }
  const primaryKeyId = plan.connection.kind === 'api-key' ? plan.connection.key.id : null
  // FR-25.6: each connection is wrapped once below the fallback rule, so every call that
  // reaches Claude (the primary, or the switched-to key) lands in llm_calls, and the
  // returned provider stays a ProjectClaudeProvider for the report runner's halt check.
  const sink = storageCallSink(parts.storage, parts.logger, parts.knownSecrets)
  const logged = (provider: ClaudeProvider): ClaudeProvider =>
    withCallLog(provider, sink, { now: parts.now, secrets: parts.knownSecrets })
  return createProjectClaudeProvider({
    primary: logged(primary),
    primaryLabel: connectionLabel(plan.connection),
    primaryKeyId,
    rule: plan.claude.fallback,
    projectName: plan.projectName,
    fallback: () => {
      const keyId = plan.claude.fallbackKeyId
      if (keyId === null || keyId === primaryKeyId) return null
      const key = getApiKey(parts.storage.db, keyId)
      if (key === null || key.provider !== 'anthropic' || !key.on) return null
      const connection: ClaudeConnectionRef = { kind: 'api-key', key }
      return {
        provider: logged(connectionProvider(parts, settings, connection, plan.model)),
        label: key.name,
        keyId: key.id
      }
    },
    onCall: (keyId) => record('claude_call', keyId, null),
    onNotice: (notice) => {
      record(notice.kind, notice.keyId, notice.sentence)
      // FR-11.7 "ask me": the call stopped; leave the user a notice to answer.
      if (notice.kind === 'claude_limit' && plan.claude.fallback === 'ask') {
        recordClaudeAskNotice(
          { storage: parts.storage, logger: parts.logger, now },
          { projectId, projectName: plan.projectName, sentence: notice.sentence },
          parts.knownSecrets()
        )
      }
    }
  })
}

function partsFromHost(host: EngineHost): CheckClaudeParts {
  return {
    storage: host.storage,
    secrets: host.secrets,
    logger: host.logger,
    http: host.http,
    command: host.claudeCommand,
    probe: host.claudeProbe,
    knownSecrets: host.knownSecrets,
    now: host.now,
    createId: host.createId,
    ...(host.claude !== undefined ? { primary: host.claude } : {})
  }
}

/**
 * The project's Claude connection (FR-11.7), or Settings' when `projectId` is null.
 * A provider is built per IPC call, but `claudeConcurrency` selects one process-wide
 * gate (`sharedClaudeGate`), so parallel UI actions and check reports together never
 * run more than that many Claude calls (LLM-7).
 */
export function resolveClaude(
  host: EngineHost,
  channel: string,
  projectId: string | null = null
): ClaudeProvider {
  const parts = partsFromHost(host)
  const settings = host.settings()
  const plan = planProjectClaude(host.storage, settings, projectId)
  if (parts.primary !== undefined) {
    const connection = plan.connection ?? { kind: 'claude-code' as const }
    return wrapForProject(parts, settings, { ...plan, connection }, parts.primary, projectId)
  }
  if (plan.connection === null) {
    throw new IpcRequestError(channel, plan.missing ?? 'Add an Anthropic API key first')
  }
  const connection = plan.connection
  const primary = connectionProvider(parts, settings, connection, plan.model)
  return wrapForProject(parts, settings, { ...plan, connection }, primary, projectId)
}

/**
 * Settings' connection for check reports when no project is known. Undefined when that
 * connection cannot run (no Anthropic key, or the Claude Code binary is missing).
 */
export function openCheckClaude(parts: CheckClaudeParts): ClaudeProvider | undefined {
  return openProjectClaude(parts, null)
}

/**
 * The project's connection for its check reports (FR-6.6, FR-12.3), with its fallback.
 * Undefined when the connection cannot run; the check still scores.
 */
export function openProjectClaude(
  parts: CheckClaudeParts,
  projectId: string | null
): ClaudeProvider | undefined {
  try {
    const settings = parts.storage.readSettings()
    const plan = planProjectClaude(parts.storage, settings, projectId)
    if (parts.primary !== undefined) {
      const connection = plan.connection ?? { kind: 'claude-code' as const }
      return wrapForProject(parts, settings, { ...plan, connection }, parts.primary, projectId)
    }
    if (plan.connection === null) {
      logCheckClaudeSkipped(parts, plan.missing ?? 'Add an Anthropic API key first')
      return undefined
    }
    const connection = plan.connection
    if (connection.kind === 'codex') {
      const located = createCodexProvider({
        command: parts.command,
        probe: parts.probe,
        logger: parts.logger
      }).locate(settings.codexBinaryPath ?? null)
      if (located.path === null && !hasSwitchFallback(plan)) {
        logCheckClaudeSkipped(parts, 'Codex was not found.')
        return undefined
      }
    }
    if (connection.kind === 'claude-code') {
      const located = createClaudeCodeProvider({
        command: parts.command,
        probe: parts.probe,
        logger: parts.logger,
        savedBinaryPath: settings.claudeBinaryPath
      }).locate(settings.claudeBinaryPath)
      if (located.path === null && !hasSwitchFallback(plan)) {
        const where =
          settings.claudeBinaryPath === null
            ? 'Claude Code was not found.'
            : `Claude Code was not found at ${settings.claudeBinaryPath}.`
        logCheckClaudeSkipped(parts, where)
        return undefined
      }
    }
    const primary = connectionProvider(parts, settings, connection, plan.model)
    return wrapForProject(parts, settings, { ...plan, connection }, primary, projectId)
  } catch (error: unknown) {
    logCheckClaudeSkipped(parts, error instanceof Error ? error.message : 'Claude is unavailable.')
    return undefined
  }
}

function hasSwitchFallback(plan: ProjectClaudePlan): boolean {
  return plan.claude.fallback === 'switch_key' && plan.claude.fallbackKeyId !== null
}

function logCheckClaudeSkipped(parts: CheckClaudeParts, detail: string): void {
  parts.logger.info('check report skipped', {
    message: redactString(detail, { secrets: parts.knownSecrets(), hexKeys: true })
  })
}

/**
 * LLM-10. The words to show before a ✦ action when the project's connection is Claude
 * Code and a limit has paused it (`claudeCodePause`), else null. Estimates use it so
 * the action turns into "use your own ChatGPT" instead of a call that fails.
 */
export function claudePausedReason(host: EngineHost, projectId: string | null): string | null {
  if (host.claude !== undefined) return null
  const settings = host.settings()
  const plan = planProjectClaude(host.storage, settings, projectId)
  if (plan.connection?.kind !== 'claude-code') return null
  const now = host.now()
  const paused = claudeCodePause(settings.claudeBinaryPath, now.getTime())
  return paused === null ? null : limitWords(paused.limit, now).message
}
