import { WebhookDeliveryError, type WebhookTransport } from '../email/webhook'
import { isSlackWebhookUrl } from '../email/webhook-http'

/**
 * Unpackaged test runs only (`CITEFOX_SLACK=off`, set by tests/e2e/launch.ts): Slack
 * posts never leave the machine. A well-formed hooks.slack.com URL is accepted, except
 * one whose path ends in `/fail`, which answers like a revoked webhook (404), so a spec
 * can show both results of "Send a test message".
 */
export function offlineSlackTransport(): WebhookTransport {
  return {
    async post(url: string): Promise<void> {
      if (!isSlackWebhookUrl(url)) {
        throw new WebhookDeliveryError(
          'Only Slack webhook URLs (https://hooks.slack.com/services/...) are supported.',
          false,
          [url]
        )
      }
      if (new URL(url).pathname.endsWith('/fail')) {
        throw new WebhookDeliveryError('The Slack webhook answered 404.', false, [url])
      }
    }
  }
}
