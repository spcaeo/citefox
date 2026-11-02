import { describe, expect, test } from 'vitest'
import { CHECK_CANCELLED_MESSAGE } from '../queue/runner'
import { accountBody, emailHarness, notice } from './harness'
import {
  changeEventsFromPages,
  desktopNoticeFor,
  pageCheckFactsForRun,
  VIEW_RESULTS
} from './index'
import { WebhookDeliveryError } from './webhook'

const WEBHOOK = 'https://hooks.slack.com/services/T00/B00/quiltmaplehook'

describe('check alerts', () => {
  test('FR-24.7 desktop notice uses only the check facts', async () => {
    const { service } = emailHarness()
    service.updateAlerts({ projectId: 'proj-1', desktop: true })
    const result = await service.notifyCheckFinished({
      checkId: 'check-1',
      projectId: 'proj-1',
      projectName: 'TextBolt',
      paused: false,
      pages: [
        {
          failed: false,
          notice: notice({
            pageCitedChange: null,
            score: null,
            scoreChange: null,
            contentChanged: false
          })
        }
      ]
    })
    expect(result.notices).toEqual([
      {
        projectId: 'proj-1',
        pageId: 'page-1',
        title: 'Alerts',
        body: 'AIOs citing this page: 2 of 5\nNo score yet\nPage changed: no',
        action: VIEW_RESULTS
      }
    ])
    const again = await service.notifyCheckFinished({
      checkId: 'check-1',
      projectId: 'proj-1',
      projectName: 'TextBolt',
      paused: false,
      pages: [{ failed: false, notice: notice() }]
    })
    expect(again.notices).toEqual([])
  })

  test('an email summary after a check is one message and a paused project sends nothing', async () => {
    const { service, ports } = emailHarness()
    const account = service.saveAccount(accountBody())
    service.updateAlerts({
      projectId: 'proj-1',
      desktop: true,
      emailAfterCheck: true,
      emailTo: ['ada@example.com', 'ada@example.com'],
      emailAccountId: account.id,
      slackEnabled: true,
      slackWebhook: WEBHOOK
    })
    const paused = await service.notifyCheckFinished({
      checkId: 'check-1',
      projectId: 'proj-1',
      projectName: 'TextBolt',
      paused: true,
      pages: [{ failed: true, notice: notice() }]
    })
    expect(paused.skipped).toBe('paused')
    expect(paused.notices).toEqual([])
    expect(ports.transport.attempts).toBe(0)
    expect(ports.webhooks.attempts).toBe(0)
    expect(ports.drafts.drafts).toHaveLength(0)
    expect(service.listDeliveries()).toHaveLength(0)

    const sent = await service.notifyCheckFinished({
      checkId: 'check-1',
      projectId: 'proj-1',
      projectName: 'TextBolt',
      paused: false,
      pages: [
        { failed: false, notice: notice({ pageId: 'page-1', pageLabel: 'Alerts' }) },
        {
          failed: false,
          notice: notice({
            pageId: 'page-2',
            pageLabel: 'Other',
            pageCitedChange: 1,
            scoreChange: 3,
            contentChanged: false
          })
        }
      ]
    })
    expect(sent.email.action).toBe('recorded')
    expect(ports.transport.sent).toHaveLength(1)
    expect(ports.transport.sent[0]?.message.to).toEqual(['ada@example.com'])
    expect(ports.transport.sent[0]?.message.subject).toBe('TextBolt')
    expect(ports.transport.sent[0]?.message.text).toContain('Alerts')
    expect(ports.transport.sent[0]?.message.text).toContain('AIOs citing this page: 2 of 5 (-1)')
    expect(ports.transport.sent[0]?.message.text).toContain('Score: 40 (-6)')
    expect(ports.transport.sent[0]?.message.text).toContain('Page changed: yes')
    expect(ports.transport.sent[0]?.message.text).toContain('Other')
    expect(ports.webhooks.posts).toHaveLength(1)
    expect(ports.webhooks.posts[0]?.url).toBe(WEBHOOK)
    expect(JSON.parse(ports.webhooks.posts[0]?.body ?? '{}')).toMatchObject({
      text: expect.any(String)
    })
    const again = await service.notifyCheckFinished({
      checkId: 'check-1',
      projectId: 'proj-1',
      projectName: 'TextBolt',
      paused: false,
      pages: [{ failed: false, notice: notice() }]
    })
    expect(again.email).toEqual({ action: 'skipped', reason: 'already_sent' })
    expect(ports.transport.sent).toHaveLength(1)
    expect(ports.webhooks.posts).toHaveLength(1)
  })

  test('mail_app opens one draft and does not call SMTP', async () => {
    const { service, ports } = emailHarness()
    service.saveAccount(accountBody())
    service.setMode({ mode: 'mail_app' })
    service.updateAlerts({
      projectId: 'proj-1',
      emailAfterCheck: true,
      emailTo: ['ada@example.com']
    })
    const result = await service.notifyCheckFinished({
      checkId: 'check-1',
      projectId: 'proj-1',
      projectName: 'TextBolt',
      paused: false,
      pages: [{ failed: false, notice: notice() }]
    })
    expect(result.email.action).toBe('recorded')
    if (result.email.action === 'recorded') {
      expect(result.email.delivery.outcome).toBe('draft')
      expect(result.email.delivery.reason).toBe('Waiting for a click.')
      expect(result.email.delivery.ok).toBe(false)
    }
    expect(ports.transport.attempts).toBe(0)
    expect(ports.drafts.drafts).toHaveLength(1)
  })

  test('Slack URL stays in the keychain and an empty string clears it', () => {
    const { service, secrets, lines } = emailHarness()
    const stored = service.updateAlerts({
      projectId: 'proj-1',
      slackEnabled: true,
      slackWebhook: WEBHOOK
    })
    expect(stored.slackWebhookStored).toBe(true)
    expect(JSON.stringify(stored)).not.toContain('quiltmaplehook')
    expect(JSON.stringify(stored)).not.toContain('hooks.slack.com')
    const kept = service.updateAlerts({ projectId: 'proj-1', slackWebhook: null })
    expect(kept.slackWebhookStored).toBe(true)
    const cleared = service.updateAlerts({ projectId: 'proj-1', slackWebhook: '' })
    expect(cleared.slackWebhookStored).toBe(false)
    expect(lines.join('\n')).not.toContain('quiltmaplehook')
    expect(secrets.get('citefox.slack.id-1')).toBeNull()
  })

  test('a rejected Slack webhook is redacted and is not retried', async () => {
    const { service, ports, lines } = emailHarness()
    service.updateAlerts({ projectId: 'proj-1', slackEnabled: true, slackWebhook: WEBHOOK })
    ports.webhooks.failure = new WebhookDeliveryError(`rejected ${WEBHOOK}`, false)
    const result = await service.notifyCheckFinished({
      checkId: 'check-1',
      projectId: 'proj-1',
      projectName: 'TextBolt',
      paused: false,
      pages: [{ failed: false, notice: notice() }]
    })
    expect(result.slack.action).toBe('recorded')
    if (result.slack.action === 'recorded') {
      expect(result.slack.delivery.outcome).toBe('failed')
      expect(result.slack.delivery.reason).toBe('The Slack webhook was rejected.')
    }
    expect(ports.webhooks.attempts).toBe(1)
    const blob = lines.join('\n')
    expect(blob).not.toContain('quiltmaplehook')
    expect(blob).not.toContain(WEBHOOK)
    expect(blob).toContain('[REDACTED]')
  })

  test('FR-23.8 page changes and the score drop threshold', () => {
    const pages = [
      {
        failed: true,
        notice: notice({
          pageId: 'page-1',
          pageLabel: 'Alerts',
          pageCitedChange: -1,
          scoreChange: -6
        })
      },
      {
        failed: false,
        notice: notice({
          pageId: 'page-2',
          pageLabel: 'Other',
          pageCitedChange: 1,
          scoreChange: -5
        })
      },
      {
        failed: false,
        notice: notice({
          pageId: 'page-3',
          pageLabel: 'First',
          pageCitedChange: null,
          score: null,
          scoreChange: null
        })
      }
    ]
    const events = changeEventsFromPages(pages, 5)
    expect(events.map((event) => event.kind)).toEqual([
      'lost_citation',
      'score_drop',
      'check_failed',
      'gained_citation'
    ])
    expect(events.find((event) => event.kind === 'score_drop')?.points).toBe(6)
    expect(changeEventsFromPages(pages, 6).some((event) => event.kind === 'score_drop')).toBe(false)
  })

  test('a cap alert is one email per project per month and pause does not consume it', async () => {
    const { service, ports } = emailHarness()
    service.saveAccount(accountBody())
    service.updateAlerts({ projectId: 'proj-1', emailTo: ['ada@example.com'] })
    const alert = {
      at: '2026-02-04T12:00:00.000Z',
      projectId: 'proj-1',
      name: 'TextBolt',
      used: 10,
      cap: 10,
      month: '2026-02'
    }
    const paused = await service.notifyCap({ alert, paused: true })
    expect(paused).toEqual({ action: 'skipped', reason: 'paused' })
    expect(ports.transport.attempts).toBe(0)
    const sent = await service.notifyCap({ alert, paused: false })
    expect(sent.action).toBe('recorded')
    expect(ports.transport.sent[0]?.message.text).toBe('Searches used: 10\nCap: 10\nMonth: 2026-02')
    const again = await service.notifyCap({ alert, paused: false })
    expect(again).toEqual({ action: 'skipped', reason: 'already_sent' })
    expect(ports.transport.sent).toHaveLength(1)
  })

  test('monthlyPdfTo is null or one address and a comma-separated list is rejected', () => {
    const { service } = emailHarness()
    expect(service.getAlerts({ projectId: 'proj-1' }).monthlyPdfTo).toBeNull()
    const saved = service.updateAlerts({
      projectId: 'proj-1',
      monthlyPdfTo: 'client@example.com',
      desktop: true
    })
    expect(saved.monthlyPdfTo).toBe('client@example.com')
    expect(service.getAlerts({ projectId: 'proj-1' }).monthlyPdfTo).toBe('client@example.com')
    const kept = service.updateAlerts({ projectId: 'proj-1', desktop: false })
    expect(kept.monthlyPdfTo).toBe('client@example.com')
    expect(kept.desktop).toBe(false)
    expect(
      service.updateAlerts({ projectId: 'proj-1', monthlyPdfTo: null }).monthlyPdfTo
    ).toBeNull()
    expect(() =>
      service.updateAlerts({ projectId: 'proj-1', monthlyPdfTo: 'ada@example.com,bea@example.com' })
    ).toThrow('Invalid request')
    expect(() =>
      service.updateAlerts({ projectId: 'proj-1', monthlyPdfTo: 'not-an-email' })
    ).toThrow('Invalid request')
    expect(service.getAlerts({ projectId: 'proj-1' }).monthlyPdfTo).toBeNull()
  })

  test('desktop notices default on and email stays off', async () => {
    const { service, ports } = emailHarness()
    const page = notice()
    expect(service.getAlerts({ projectId: 'proj-1' })).toMatchObject({
      desktop: true,
      emailAfterCheck: false,
      emailTo: [],
      slackEnabled: false,
      slackWebhookStored: false,
      monthlyClientPdf: false
    })
    const result = await service.notifyCheckFinished({
      checkId: 'check-1',
      projectId: 'proj-1',
      projectName: 'TextBolt',
      paused: false,
      pages: [{ failed: false, notice: page }]
    })
    expect(result.notices).toEqual([desktopNoticeFor(page)])
    expect(result.email).toEqual({ action: 'skipped', reason: 'disabled' })
    expect(result.slack).toEqual({ action: 'skipped', reason: 'disabled' })
    expect(ports.transport.attempts).toBe(0)
  })

  test('a cancelled check sends no failure alert and no summary', async () => {
    const { service, ports } = emailHarness()
    const account = service.saveAccount(accountBody())
    service.updateAlerts({
      projectId: 'proj-1',
      desktop: true,
      emailAfterCheck: true,
      emailTo: ['ada@example.com'],
      emailAccountId: account.id,
      slackEnabled: true,
      slackWebhook: WEBHOOK
    })
    const cancelled = pageCheckFactsForRun(notice({ pageId: 'page-1', pageLabel: 'Cancelled' }), {
      outcome: 'error',
      message: CHECK_CANCELLED_MESSAGE,
      searches: []
    })
    expect(cancelled).toMatchObject({ failed: false, cancelled: true })
    const failed = pageCheckFactsForRun(
      notice({ pageId: 'page-2', pageLabel: 'Broken', pageCitedChange: 0, scoreChange: 0 }),
      { outcome: 'error', message: 'boom', searches: [] }
    )
    const onlyCancelled = await service.notifyCheckFinished({
      checkId: 'check-cancel',
      projectId: 'proj-1',
      projectName: 'TextBolt',
      paused: false,
      pages: [{ ...cancelled, failed: true }]
    })
    expect(onlyCancelled.notices).toEqual([])
    expect(onlyCancelled.email).toEqual({ action: 'skipped', reason: 'empty' })
    expect(onlyCancelled.slack).toEqual({ action: 'skipped', reason: 'empty' })
    expect(ports.transport.attempts).toBe(0)
    expect(ports.webhooks.attempts).toBe(0)
    expect(
      changeEventsFromPages([{ ...cancelled, failed: true }], 5).some(
        (event) => event.kind === 'check_failed'
      )
    ).toBe(false)

    const mixed = await service.notifyCheckFinished({
      checkId: 'check-mixed',
      projectId: 'proj-1',
      projectName: 'TextBolt',
      paused: false,
      pages: [cancelled, failed]
    })
    expect(mixed.notices.map((notice) => notice.pageId)).toEqual(['page-2'])
    expect(ports.transport.sent).toHaveLength(1)
    expect(ports.transport.sent[0]?.message.text).toContain('Broken')
    expect(ports.transport.sent[0]?.message.text).not.toContain('Cancelled')
    expect(changeEventsFromPages([cancelled, failed], null).map((event) => event.kind)).toEqual([
      'check_failed'
    ])
  })
})
