// Dev-only prompt test bench (scripts/prompt-eval.mjs). Not imported by the app.
import type {
  ClaudeCompletion,
  ClaudeCompletionRequest,
  ClaudeProvider
} from '../providers/claude/claude-code'

/**
 * Every Claude call the bench makes, as sent and as answered: the provider the engine
 * host uses is wrapped, so the app's own code builds each prompt and the bench only
 * keeps a copy. Calls are told apart by their routing id (`trace.assistId`), so calls
 * that run side by side (the competitor searches) still land on the right step.
 */
export interface RecordedCall {
  /** Order the call was sent in, from 1. */
  n: number
  assistId: string | null
  webSearch: boolean
  prompt: string
  /** The raw reply text; null when the call failed. */
  reply: string | null
  error: string | null
  /** Waiting for a free turn plus the call. */
  wallMs: number
  /** The call alone (the provider's own timing); null when it failed. */
  callMs: number | null
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
}

export interface CallRecorder {
  provider: ClaudeProvider
  calls(): readonly RecordedCall[]
  /** Calls whose number is above `after`, with this routing id (null: any). */
  since(after: number, assistId?: string | null): RecordedCall[]
  count(): number
}

export function recordCalls(inner: ClaudeProvider, clock: () => number = Date.now): CallRecorder {
  const calls: RecordedCall[] = []
  const provider: ClaudeProvider = {
    id: inner.id,
    async complete(request: ClaudeCompletionRequest): Promise<ClaudeCompletion> {
      const call: RecordedCall = {
        n: calls.length + 1,
        assistId: request.trace?.assistId ?? null,
        webSearch: request.webSearch === true,
        prompt: request.prompt,
        reply: null,
        error: null,
        wallMs: 0,
        callMs: null,
        model: request.model ?? null,
        inputTokens: null,
        outputTokens: null
      }
      calls.push(call)
      const started = clock()
      try {
        const completion = await inner.complete(request)
        call.reply = completion.text
        call.callMs = completion.durationMs
        call.model = completion.resolvedModel ?? completion.model
        call.inputTokens = completion.inputTokens
        call.outputTokens = completion.outputTokens
        return completion
      } catch (error) {
        call.error = error instanceof Error ? error.message : String(error)
        throw error
      } finally {
        call.wallMs = clock() - started
      }
    }
  }
  return {
    provider,
    calls: () => calls,
    since: (after, assistId = null) =>
      calls.filter((call) => call.n > after && (assistId === null || call.assistId === assistId)),
    count: () => calls.length
  }
}
