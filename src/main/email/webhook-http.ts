import { ProviderTimeoutError } from '../providers/errors'
import {
  CITEFOX_USER_AGENT,
  createFetchHttpTransport,
  type HttpResponse,
  type HttpTransport
} from '../providers/http'
import { withTimeout } from '../providers/timeout'
import { WebhookDeliveryError, type WebhookTransport } from './webhook'

/** One Slack post. Slack answers in well under a second. */
export const SLACK_WEBHOOK_TIMEOUT_MS = 10_000

/** Slack's reply is a short status word. Anything longer is not read. */
const SLACK_REPLY_MAX_BYTES = 64 * 1024

/**
 * FR-23.13. Only Slack incoming webhooks are accepted:
 * `https://hooks.slack.com/services/...`, default port, no credentials.
 * Log redaction (`logging/redact`) recognizes exactly this form, and the
 * `{ "text": ... }` body is the incoming-webhook payload.
 */
export function isSlackWebhookUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return (
    url.protocol === 'https:' &&
    url.hostname === 'hooks.slack.com' &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    url.pathname.startsWith('/services/') &&
    url.pathname.length > '/services/'.length
  )
}

/**
 * Real Slack transport: one JSON POST through the shared HTTP transport,
 * which does not follow redirects. The URL is a keychain secret; it is
 * never put in an error message or a log line. A 429 or 5xx is transient.
 * A timeout is not, because Slack may already have posted the message.
 */
export function createHttpWebhookTransport(
  http: HttpTransport = createFetchHttpTransport(),
  timeoutMs: number = SLACK_WEBHOOK_TIMEOUT_MS
): WebhookTransport {
  return {
    async post(url: string, body: string): Promise<void> {
      if (!isSlackWebhookUrl(url)) {
        throw new WebhookDeliveryError(
          'Only Slack webhook URLs (https://hooks.slack.com/services/...) are supported.',
          false,
          [url]
        )
      }
      let response: HttpResponse
      try {
        response = await withTimeout(
          (signal) =>
            http.request({
              method: 'POST',
              url,
              headers: {
                'content-type': 'application/json',
                'user-agent': CITEFOX_USER_AGENT
              },
              body,
              timeoutMs,
              signal,
              maxBodyBytes: SLACK_REPLY_MAX_BYTES
            }),
          timeoutMs,
          'Slack webhook',
          [url]
        )
      } catch (error: unknown) {
        if (error instanceof ProviderTimeoutError) {
          throw new WebhookDeliveryError('The Slack webhook timed out.', false, [url])
        }
        throw new WebhookDeliveryError('The Slack webhook could not be reached.', true, [url])
      }
      if (response.status >= 200 && response.status < 300) return
      const transient = response.status === 429 || response.status >= 500
      throw new WebhookDeliveryError(`The Slack webhook answered ${response.status}.`, transient, [
        url
      ])
    }
  }
}
