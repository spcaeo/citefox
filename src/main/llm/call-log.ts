import { randomUUID } from 'node:crypto'
import { progressStep, takeClaudeContext } from '../assist/progress'
import { claudeStepLabel, connectionText } from '../assist/progress-labels'
import type { Logger } from '../logging/logger'
import { redactString } from '../logging/redact'
import { ClaudeCallError } from '../providers/claude/call-error'
import type {
  ClaudeCompletion,
  ClaudeCompletionRequest,
  ClaudeProvider,
  LlmCallTrace
} from '../providers/claude/claude-code'
import type { AppStorage } from '../storage/app-storage'
import { insertLlmCall, type LlmCallRow } from '../storage/llm-calls'
import { projectDatabasePool } from '../storage/project-db-pool'
import { getProject } from '../storage/records'

/**
 * FR-25.6. The one logging point for Claude calls: every provider the engine
 * hands out (`resolveClaude`, `openCheckClaude`, the playground) is wrapped
 * here, so the pipeline, the check reports, the playground, Ask CiteFox and
 * every assist write one `llm_calls` row per call without logging of their own.
 * The prompt and the reply are never stored. A failed write is logged and
 * never fails the call.
 */

export interface LlmCallSink {
  record(row: LlmCallRow, projectId: string | null): void
}

const LOGGED = Symbol('citefox.llmCallLogged')

type LoggedProvider = ClaudeProvider & { [LOGGED]?: true }

export const UNTRACED: LlmCallTrace = {
  source: 'other',
  projectId: null,
  templateKind: null,
  templateId: null,
  templateHash: null,
  assistId: null
}

/** Wraps `provider` once. Wrapping a wrapped provider returns it unchanged. */
export function withCallLog(
  provider: ClaudeProvider,
  sink: LlmCallSink,
  options: { now?: () => Date; clock?: () => number; secrets?: () => readonly string[] } = {}
): ClaudeProvider {
  if ((provider as LoggedProvider)[LOGGED] === true) return provider
  const now = options.now ?? (() => new Date())
  const clock = options.clock ?? (() => Date.now())
  const wrapped: LoggedProvider = {
    id: provider.id,
    async complete(request: ClaudeCompletionRequest): Promise<ClaudeCompletion> {
      const trace = request.trace ?? UNTRACED
      const startedAt = now().toISOString()
      const started = clock()
      // Owner feedback #1: the live step for this call (a no-op outside an invoke).
      const context = takeClaudeContext()
      const step = progressStep({
        kind: 'claude',
        label:
          request.progress?.label ??
          // Users see "CiteFox AI", never the provider behind it (Claude Code or Codex).
          claudeStepLabel(request.trace, context.retry),
        detail: request.progress?.detail ?? context.hint,
        claude: {
          connection: provider.id,
          connectionText: connectionText(provider.id),
          // A Codex call does not use the project's Claude model, so none is shown before it answers.
          model: provider.id === 'codex' ? null : (request.model ?? null)
        }
      })
      let completion: ClaudeCompletion
      try {
        completion = await provider.complete(request)
      } catch (error) {
        const spent = error instanceof ClaudeCallError ? error : null
        const message = error instanceof Error ? error.message : 'The CiteFox AI call failed'
        step.fail(redactString(message, { secrets: options.secrets?.() ?? [], hexKeys: true }))
        record(sink, trace, {
          ...traceColumns(trace),
          id: `llm-${randomUUID()}`,
          connection: provider.id,
          model: spent?.resolvedModel ?? (provider.id === 'codex' ? null : request.model) ?? null,
          startedAt,
          durationMs: Math.max(0, clock() - started),
          tokensIn: spent?.usage?.inputTokens ?? 0,
          tokensOut: spent?.usage?.outputTokens ?? 0,
          ok: false,
          error: redactString(message, { secrets: options.secrets?.() ?? [], hexKeys: true })
        })
        throw error
      }
      record(sink, trace, {
        ...traceColumns(trace),
        id: `llm-${randomUUID()}`,
        connection: completion.provider,
        model: completion.resolvedModel ?? completion.model ?? request.model ?? null,
        startedAt,
        durationMs: completion.durationMs > 0 ? completion.durationMs : clock() - started,
        tokensIn: completion.usage.inputTokens ?? completion.inputTokens ?? 0,
        tokensOut: completion.usage.outputTokens ?? completion.outputTokens ?? 0,
        ok: true,
        error: null
      })
      const answered = completion.resolvedModel ?? completion.model ?? request.model ?? null
      step.claude({
        connection: completion.provider,
        connectionText: connectionText(completion.provider),
        model: answered
      })
      step.done()
      return completion
    }
  }
  wrapped[LOGGED] = true
  return wrapped
}

/**
 * Writes project calls to that project's database and other calls to app.sqlite.
 * Project files come from the process-wide pool, so logging opens nothing per call.
 */
export function storageCallSink(
  storage: Pick<AppStorage, 'db' | 'paths'>,
  logger: Logger,
  secrets: () => readonly string[] = () => []
): LlmCallSink {
  return {
    record(row, projectId) {
      try {
        if (projectId !== null) {
          const project = getProject(storage.db, projectId)
          if (project !== null) {
            insertLlmCall(projectDatabasePool(storage).get(project.slug), row, {
              table: 'project'
            })
            return
          }
        }
        // A project id the app no longer knows still names the call on the app table.
        insertLlmCall(storage.db, row, { table: 'app', projectId })
      } catch (error) {
        logger.warn('could not record claude call', {
          message: redactString(error instanceof Error ? error.message : 'write failed', {
            secrets: secrets(),
            hexKeys: true
          })
        })
      }
    }
  }
}

/** A sink that throws (or a row it rejects) never fails or repeats the call. */
function record(sink: LlmCallSink, trace: LlmCallTrace, row: LlmCallRow): void {
  try {
    sink.record(row, trace.projectId)
  } catch {
    // The storage sink logs its own failures; a custom sink's error is dropped.
  }
}

function traceColumns(
  trace: LlmCallTrace
): Pick<LlmCallRow, 'source' | 'templateKind' | 'templateId' | 'templateHash' | 'assistId'> {
  return {
    source: trace.source,
    templateKind: trace.templateKind,
    templateId: trace.templateId,
    templateHash: trace.templateHash,
    assistId: trace.assistId
  }
}
