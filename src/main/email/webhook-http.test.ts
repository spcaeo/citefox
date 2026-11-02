import { describe, expect, test } from 'vitest'
import type { HttpRequest, HttpResponse, HttpTransport } from '../providers/http'
import { ProviderTimeoutError } from '../providers/errors'
import { parseAlertUpdate } from './parse'
import { WebhookDeliveryError, postWithRetry } from './webhook'
import {
  SLACK_WEBHOOK_TIMEOUT_MS,
  createHttpWebhookTransport,
  isSlackWebhookUrl
} from './webhook-http'

const HOOK = 'https://hooks.slack.com/services/T000/B000/hookSecretValue123'

function scripted(
  respond: (request: HttpRequest) => HttpResponse | Promise<HttpResponse>
): HttpTransport & { calls: HttpRequest[] } {
  const calls: HttpRequest[] = []
  return {
    calls,
    async request(request) {
      calls.push(request)
      return respond(request)
    }
  }
}

describe('Slack webhook URL', () => {
  test('accepts only https://hooks.slack.com/services/…', () => {
    expect(isSlackWebhookUrl(HOOK)).toBe(true)
    for (const bad of [
      'https://example.com/hook',
      'http://hooks.slack.com/services/T/B/X',
      'https://hooks.slack.com.evil.example/services/T/B/X',
      'https://evil.example/?https://hooks.slack.com/services/T/B/X',
      'https://hooks.slack.com:8443/services/T/B/X',
      'https://user:pw@hooks.slack.com/services/T/B/X',
      'https://hooks.slack.com/',
      'https://hooks.slack.com/api/other'
    ]) {
      expect(isSlackWebhookUrl(bad)).toBe(false)
    }
  })

  test('the alerts request refuses any other webhook URL', () => {
    expect(parseAlertUpdate({ projectId: 'proj-1', slackWebhook: HOOK }).slackWebhook).toBe(HOOK)
    expect(parseAlertUpdate({ projectId: 'proj-1', slackWebhook: '' }).slackWebhook).toBe('')
    expect(() =>
      parseAlertUpdate({ projectId: 'proj-1', slackWebhook: 'https://example.com/hook' })
    ).toThrow()
    expect(() =>
      parseAlertUpdate({
        projectId: 'proj-1',
        slackWebhook: 'https://hooks.slack.com.evil.example/services/T/B/X'
      })
    ).toThrow()
  })
})

describe('HTTP webhook transport', () => {
  test('POSTs the JSON body to Slack with a timeout and no redirects followed', async () => {
    const http = scripted(() => ({ status: 200, body: 'ok' }))
    await createHttpWebhookTransport(http).post(HOOK, '{"text":"hi"}')
    expect(http.calls).toHaveLength(1)
    expect(http.calls[0]).toMatchObject({
      method: 'POST',
      url: HOOK,
      body: '{"text":"hi"}',
      timeoutMs: SLACK_WEBHOOK_TIMEOUT_MS
    })
    expect(http.calls[0]?.headers?.['content-type']).toBe('application/json')
  })

  test('5xx and 429 are transient, 4xx and 3xx are not, and errors never carry the URL', async () => {
    const cases: Array<[number, boolean]> = [
      [500, true],
      [429, true],
      [404, false],
      [302, false]
    ]
    for (const [status, transient] of cases) {
      const http = scripted(() => ({ status, body: `no ${HOOK}` }))
      const error = await createHttpWebhookTransport(http)
        .post(HOOK, '{}')
        .then(
          () => null,
          (caught: unknown) => caught
        )
      expect(error).toBeInstanceOf(WebhookDeliveryError)
      expect(error).toMatchObject({ transient })
      expect((error as Error).message).not.toContain('hookSecretValue123')
    }
  })

  test('a timeout is not resent, so Slack does not get the summary twice', async () => {
    let posts = 0
    const http: HttpTransport = {
      async request() {
        posts += 1
        throw new ProviderTimeoutError('Slack webhook', SLACK_WEBHOOK_TIMEOUT_MS)
      }
    }
    await expect(
      postWithRetry(createHttpWebhookTransport(http), HOOK, '{}', {
        secrets: [HOOK],
        sleep: async () => undefined
      })
    ).rejects.toMatchObject({ transient: false })
    expect(posts).toBe(1)
  })

  test('refuses a non-Slack URL without sending', async () => {
    const http = scripted(() => ({ status: 200, body: 'ok' }))
    await expect(
      createHttpWebhookTransport(http).post('https://example.com/hook', '{}')
    ).rejects.toMatchObject({ transient: false })
    expect(http.calls).toHaveLength(0)
  })
})
