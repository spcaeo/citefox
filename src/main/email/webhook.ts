import { redactString } from '../logging/redact'
import { RETRY_ATTEMPTS, runAttempts } from '../providers/retry'

/**
 * Slack-compatible webhook (FR-23.13). The URL is a keychain secret (NFR-5).
 * Callers must not log `url`. Tests use {@link MemoryWebhookTransport}.
 */
export interface WebhookTransport {
  post(url: string, body: string): Promise<void>
}

export class WebhookDeliveryError extends Error {
  readonly transient: boolean

  constructor(message: string, transient: boolean, secrets?: readonly string[]) {
    super(redactString(message, { secrets }))
    this.name = 'WebhookDeliveryError'
    this.transient = transient
  }
}

export function unconfiguredWebhookTransport(): WebhookTransport {
  return {
    async post(): Promise<void> {
      throw new WebhookDeliveryError('Webhook transport is not configured.', false)
    }
  }
}

/**
 * NFR-2. A transient webhook error retries 3 times. A definitive rejection does not.
 */
export async function postWithRetry(
  transport: WebhookTransport,
  url: string,
  body: string,
  options: { sleep?: (ms: number) => Promise<void>; secrets: readonly string[] }
): Promise<void> {
  await runAttempts(
    async (attempt) => {
      try {
        await transport.post(url, body)
        return { done: true, value: undefined }
      } catch (error: unknown) {
        const wrapped = toWebhookError(error, options.secrets)
        if (!wrapped.transient || attempt === RETRY_ATTEMPTS) throw wrapped
        return { done: false, value: undefined }
      }
    },
    { sleep: options.sleep }
  )
}

export class MemoryWebhookTransport implements WebhookTransport {
  readonly posts: { url: string; body: string }[] = []
  attempts = 0
  failure: WebhookDeliveryError | null = null
  failNext: number | null = null

  async post(url: string, body: string): Promise<void> {
    this.attempts += 1
    if (this.failure !== null && (this.failNext === null || this.failNext > 0)) {
      if (this.failNext !== null) this.failNext -= 1
      throw this.failure
    }
    this.posts.push({ url, body })
  }
}

function toWebhookError(error: unknown, secrets: readonly string[]): WebhookDeliveryError {
  if (error instanceof WebhookDeliveryError) {
    return new WebhookDeliveryError(error.message, error.transient, secrets)
  }
  const message = error instanceof Error ? error.message : 'Webhook post failed'
  return new WebhookDeliveryError(message, true, secrets)
}
