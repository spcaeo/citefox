/** The template playground. */

import type { AppSettings } from '@shared/domain'
import type { IpcHandlersFor, playgroundChannels, PlaygroundRunResult } from '@shared/ipc'
import { checkPlaygroundAio, savePlaygroundRun } from '../engine/playground-save'
import {
  IpcRequestError,
  parsePlaygroundAio,
  parsePlaygroundRun,
  parseSavePlayground
} from '../ipc-request'
import { PipelineError } from '../pipeline/errors'
import { modelUsageFromCompletion } from '../pipeline/llm'
import {
  fetchPlaygroundPage,
  runPlayground,
  type PlaygroundModelReply
} from '../pipeline/playground'
import {
  createAnthropicApiProvider,
  type AnthropicApiProvider
} from '../providers/claude/anthropic-api'
import { createClaudeCodeProvider, type ClaudeProvider } from '../providers/claude/claude-code'
import { storageCallSink, UNTRACED, withCallLog } from '../llm/call-log'
import { DEFAULT_CLAUDE_MODEL } from '../providers/claude/model'
import { getApiKeyByProvider } from '../storage/records'
import { guard, type EngineContext } from './context'

export function playgroundHandlers(ctx: EngineContext): IpcHandlersFor<typeof playgroundChannels> {
  return {
    'playground:run': (request) =>
      guard('playground:run', ctx, () => runPlaygroundChannel(ctx, request)),
    'playground:checkAio': (request) =>
      guard('playground:checkAio', ctx, () =>
        checkPlaygroundAio(ctx, parsePlaygroundAio(request), ctx.playgroundMemory)
      ),
    'playground:saveToProject': (request) =>
      guard('playground:saveToProject', ctx, () => {
        const parsed = parseSavePlayground(request)
        const stored = ctx.playgroundMemory.find(parsed.runId)
        if (stored === null) {
          throw new IpcRequestError('playground:saveToProject', 'Invalid request')
        }
        return savePlaygroundRun(ctx, parsed, stored)
      })
  }
}

async function runPlaygroundChannel(
  ctx: EngineContext,
  request: unknown
): Promise<readonly PlaygroundRunResult[]> {
  const parsed = parsePlaygroundRun(request)
  try {
    return await runPlayground({
      db: ctx.storage.db,
      request: parsed,
      readPage:
        ctx.readPlaygroundPage ??
        ((url) =>
          fetchPlaygroundPage({
            url,
            transport: ctx.http,
            logger: ctx.logger,
            secrets: ctx.knownSecrets()
          })),
      complete:
        ctx.completePlayground ??
        ((prompt, template) => completePlaygroundPrompt(ctx, prompt, template)),
      promptCount: ctx.storage.readSettings().defaultPromptCount,
      createId: () => `run-${ctx.createId()}`,
      memory: ctx.playgroundMemory
    })
  } catch (error) {
    if (error instanceof PipelineError) {
      throw new IpcRequestError('playground:run', 'The page could not be read.')
    }
    throw error
  }
}

async function completePlaygroundPrompt(
  ctx: EngineContext,
  prompt: string,
  template: { kind: string; id: string; hash: string }
): Promise<PlaygroundModelReply> {
  const settings = ctx.storage.readSettings()
  const provider = playgroundProvider(ctx, settings)
  const completion = await provider.complete({
    prompt,
    schema: null,
    model: settings.claudeModel,
    maxTokens: 8000,
    trace: {
      ...UNTRACED,
      source: 'playground',
      templateKind: template.kind,
      templateId: template.id,
      templateHash: template.hash
    }
  })
  return {
    text: completion.text,
    resolvedModel: completion.resolvedModel ?? completion.model ?? DEFAULT_CLAUDE_MODEL,
    usage: modelUsageFromCompletion(completion),
    durationMs: completion.durationMs
  }
}

/** The Settings connection, wrapped by the call log so playground runs land in llm_calls. */
function playgroundProvider(ctx: EngineContext, settings: AppSettings): ClaudeProvider {
  const provider: ClaudeProvider =
    ctx.claude ??
    (settings.claudeProvider === 'anthropic-api'
      ? anthropicProvider(ctx, settings)
      : createClaudeCodeProvider({
          command: ctx.claudeCommand,
          probe: ctx.claudeProbe,
          logger: ctx.logger,
          concurrency: settings.claudeConcurrency,
          savedBinaryPath: settings.claudeBinaryPath,
          model: settings.claudeModel,
          secrets: ctx.knownSecrets
        }))
  return withCallLog(provider, storageCallSink(ctx.storage, ctx.logger, ctx.knownSecrets), {
    now: ctx.now,
    secrets: ctx.knownSecrets
  })
}

function anthropicProvider(ctx: EngineContext, settings: AppSettings): AnthropicApiProvider {
  const key = getApiKeyByProvider(ctx.storage.db, 'anthropic')
  if (key === null) {
    throw new IpcRequestError('playground:run', 'Request failed')
  }
  return createAnthropicApiProvider({
    transport: ctx.http,
    secretStore: ctx.secrets,
    keychainRef: key.keychainRef,
    logger: ctx.logger,
    concurrency: settings.claudeConcurrency,
    model: settings.claudeModel,
    secrets: ctx.knownSecrets
  })
}
