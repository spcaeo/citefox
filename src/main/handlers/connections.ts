/** Connections overview, the status capsule, and the AI checkup (Claude Code or Codex). */

import { DEFAULT_SERPAPI_ROTATION } from '@shared/domain'
import type {
  ClaudeCheckupResult,
  ClaudePauseInfo,
  connectionsChannels,
  ConnectionsOverview,
  IpcHandlersFor,
  StatusCapsule,
  statusChannels
} from '@shared/ipc'
import { buildConnectionsOverview, statusCapsuleFromOverview } from '../connection-status'
import { connectionActivity, connectionActivityLog } from '../engine/project-settings/activity'
import { projectClaudeRows } from '../engine/project-settings/usage'
import { planProjectClaude } from '../engine/claude'
import { parseClaudePause, parseRunCheckup } from '../ipc-request'
import { runClaudeCheckup } from '../providers/claude/checkup'
import { describeResetTime } from '../providers/claude/limits'
import { claudeCodePause } from '../providers/claude/shared-gate'
import { runCodexCheckup } from '../providers/codex/checkup'
import { getApiKeyByProvider, getLatestClaudeCheckup, listApiKeys } from '../storage/records'
import { guard, type EngineContext } from './context'
import { presentKeys } from './keys'

export function connectionsHandlers(
  ctx: EngineContext
): IpcHandlersFor<typeof connectionsChannels> & IpcHandlersFor<typeof statusChannels> {
  return {
    'connections:getOverview': () => guard('connections:getOverview', ctx, () => readOverview(ctx)),
    'claudeCode:runCheckup': (request) =>
      guard('claudeCode:runCheckup', ctx, () => runCheckup(ctx, request)),
    'claudeCode:getCheckup': () => guard('claudeCode:getCheckup', ctx, () => readCheckup(ctx)),
    'claudeCode:openTerminal': () =>
      guard('claudeCode:openTerminal', ctx, () => ctx.openTerminal()),
    'claudeCode:getPause': (request) =>
      guard('claudeCode:getPause', ctx, () => readPause(ctx, parseClaudePause(request).projectId)),
    'connections:activity': () =>
      guard('connections:activity', ctx, () => connectionActivity(ctx.storage, ctx.now())),
    'connections:activityLog': () =>
      guard('connections:activityLog', ctx, () => connectionActivityLog(ctx.storage, ctx.now())),
    'connections:projectClaude': () =>
      guard('connections:projectClaude', ctx, () => projectClaudeRows(ctx.storage)),
    'status:getCapsule': () => guard('status:getCapsule', ctx, () => readCapsule(ctx))
  }
}

function readOverview(ctx: EngineContext): ConnectionsOverview {
  const records = listApiKeys(ctx.storage.db)
  return buildConnectionsOverview({
    keys: presentKeys(ctx, records),
    checkup: getLatestClaudeCheckup(ctx.storage.db)?.result ?? null,
    rotation: ctx.storage.readSettings().serpapiRotation ?? DEFAULT_SERPAPI_ROTATION
  })
}

function readCapsule(ctx: EngineContext): StatusCapsule {
  return statusCapsuleFromOverview(readOverview(ctx))
}

export async function runCheckup(
  ctx: EngineContext,
  request: unknown
): Promise<ClaudeCheckupResult> {
  const parsed = parseRunCheckup(request)
  const settings = ctx.storage.readSettings()
  const provider =
    parsed.provider ?? (settings.claudeProvider === 'codex' ? 'codex' : 'claude-code')
  if (provider === 'codex') {
    return runCodexCheckup({
      command: ctx.claudeCommand,
      probe: ctx.claudeProbe,
      logger: ctx.logger,
      db: ctx.storage.db,
      binaryPath: parsed.binaryPath,
      savedBinaryPath: settings.codexBinaryPath ?? null,
      model: settings.codexModel ?? null,
      quickModel: settings.codexQuickModel ?? null,
      concurrency: settings.claudeConcurrency,
      secrets: ctx.knownSecrets,
      onProgress: (event) => {
        ctx.emitCheckupProgress(event)
      },
      now: ctx.now,
      id: ctx.createId()
    })
  }
  return runClaudeCheckup({
    command: ctx.claudeCommand,
    probe: ctx.claudeProbe,
    logger: ctx.logger,
    db: ctx.storage.db,
    binaryPath: parsed.binaryPath,
    savedBinaryPath: settings.claudeBinaryPath,
    model: settings.claudeModel,
    concurrency: settings.claudeConcurrency,
    secrets: ctx.knownSecrets,
    onProgress: (event) => {
      ctx.emitCheckupProgress(event)
    },
    now: ctx.now,
    id: ctx.createId()
  })
}

function readCheckup(ctx: EngineContext): ClaudeCheckupResult | null {
  return getLatestClaudeCheckup(ctx.storage.db)?.result ?? null
}

/**
 * LLM-10. The pause after a plan limit, when this project's calls go to Claude Code
 * (a project on an API key is never paused). "Available again" names the reset Claude
 * gave, or the end of the pause when it gave none.
 */
export function readPause(ctx: EngineContext, projectId: string | null): ClaudePauseInfo | null {
  const settings = ctx.storage.readSettings()
  const plan = planProjectClaude(ctx.storage, settings, projectId)
  if (plan.connection?.kind !== 'claude-code') return null
  const now = ctx.now()
  const paused = claudeCodePause(settings.claudeBinaryPath, now.getTime())
  if (paused === null) return null
  const until = new Date(paused.until)
  return {
    until: until.toISOString(),
    resetsAt: paused.limit.resetsAt?.toISOString() ?? null,
    kind: paused.limit.kind,
    availableAgain: describeResetTime(paused.limit.resetsAt ?? until, now),
    hasApiKey: getApiKeyByProvider(ctx.storage.db, 'anthropic') !== null
  }
}
