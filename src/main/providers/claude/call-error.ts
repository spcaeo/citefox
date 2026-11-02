import type { ConnectionState } from '@shared/domain'
import { ProviderError, type ProviderErrorCode } from '../errors'
import type { ClaudeLimitInfo } from './limits'
import type { ClaudeCliUsage } from './parse'

/**
 * A Claude call that failed after the model answered at least once, so tokens
 * were spent. `usage` is the sum over every model request the provider made for
 * this call (a schema retry included), so the caller can record what the failed
 * generation cost. Null when no reply reported usage.
 */
export class ClaudeCallError extends ProviderError {
  readonly usage: ClaudeCliUsage | null
  readonly resolvedModel: string | null

  constructor(
    message: string,
    options: {
      code: ProviderErrorCode
      state: ConnectionState
      nextStep: string | null
      secrets?: readonly string[]
      limit?: ClaudeLimitInfo | null
    },
    usage: ClaudeCliUsage | null,
    resolvedModel: string | null
  ) {
    super(message, options)
    this.name = 'ClaudeCallError'
    this.usage = usage
    this.resolvedModel = resolvedModel
  }
}
