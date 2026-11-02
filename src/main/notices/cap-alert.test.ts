import type { AlertSettings } from '@shared/domain'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { NotifyResult } from '../email/types'
import { createCheckEngine } from '../engine/checks/engine'
import type { CapStopEvent } from '../engine/checks/cap-stop'
import { closeSeeds, envelope, seed } from '../engine/checks/checks.test-helper'
import { readStoredCheckCatalog } from '../headless/storage-pass'
import type { CapAlert } from '../queue/types'
import { readEffectiveScheduleCap, writeProjectScheduleCap } from '../storage/project-schedule'
import { capAlertFromStop, capEmail, createCapAlertHandler, type DesktopNotice } from './cap-alert'
import { listNotices, resolveNotice } from './service'

afterEach(() => {
  closeSeeds()
  vi.useRealTimers()
})

describe('FR-11.4 notify rule', () => {
  test('a manual check stopped at a notify cap raises the desktop alert, email, and one notice', async () => {
    // The whole test lives in Oct 2026 (the scheduler's month is read from the clock).
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-19T12:00:00.000Z') })
    const http: string[] = []
    const seeded = await seed({
      progress: [],
      http(request) {
        http.push(request.url)
        return envelope('google-no-aio.json')
      }
    })
    writeProjectScheduleCap(seeded.projectDb, { cap: 0, capRule: 'notify', dedicatedKeyId: null })
    const desktop: DesktopNotice[] = []
    const emails: CapAlert[] = []
    const stops: CapStopEvent[] = []
    const onCap = createCapAlertHandler({
      storage: seeded.storage,
      logger: { warn: () => undefined },
      now: () => new Date('2026-10-19T12:00:00.000Z'),
      desktop: (notice) => desktop.push(notice),
      email: async (alert) => {
        emails.push(alert)
      }
    })
    const engine = createCheckEngine({
      ...seeded.checkDeps,
      onCapStop: (stop) => {
        stops.push(stop)
        const alert = capAlertFromStop(stop, new Date('2026-10-19T12:00:00.000Z'))
        if (alert !== null) onCap(alert)
      }
    })
    const request = { projectId: 'proj-1', pageIds: ['page-1'], marketIds: null, promptIds: null }
    const job = await engine.start(request)
    expect(job.status).toBe('error')
    expect(http).toEqual([])
    expect(stops).toEqual([
      expect.objectContaining({ projectId: 'proj-1', capRule: 'notify', cap: 0, reason: 'manual' })
    ])
    expect(desktop).toEqual([
      expect.objectContaining({
        projectId: 'proj-1',
        title: 'TextBolt reached its search cap',
        hash: '#/status'
      })
    ])
    expect(emails).toHaveLength(1)
    const listed = listNotices(seeded.storage)
    expect(listed.notices).toEqual([
      expect.objectContaining({
        kind: 'search_cap',
        projectId: 'proj-1',
        projectName: 'TextBolt',
        actions: [
          expect.objectContaining({ id: 'allow_10_month', primary: true }),
          expect.objectContaining({ id: 'wait_reset', primary: false })
        ]
      })
    ])

    // The same month: no second alert.
    await engine.start(request)
    expect(desktop).toHaveLength(1)
    expect(emails).toHaveLength(1)
    expect(listNotices(seeded.storage).notices).toHaveLength(1)

    const month = stops[0]?.month ?? ''
    const answered = await resolveNotice(
      {
        storage: seeded.storage,
        logger: { warn: () => undefined },
        // The stop's own month (Oct 2026), not today's, so the test holds on any date.
        now: () => new Date('2026-10-19T12:00:00.000Z')
      },
      { noticeId: listed.notices[0]?.id ?? '', actionId: 'allow_10_month' }
    )
    expect(answered.message).toContain('up to 10% over the cap')
    expect(readEffectiveScheduleCap(seeded.projectDb, month).capRule).toBe('allow_10')
    // The scheduler's queue reads the same rule for the month.
    expect(readStoredCheckCatalog(seeded.storage).queueProjects[0]?.capRule).toBe('allow_10')
    expect(listNotices(seeded.storage).notices).toEqual([])
  })

  test('pause and allow_10 stops are not alerts', () => {
    const stop: CapStopEvent = {
      projectId: 'proj-1',
      name: 'TextBolt',
      capRule: 'pause',
      cap: 10,
      used: 10,
      month: '2026-10',
      reason: 'manual'
    }
    expect(capAlertFromStop(stop, new Date())).toBeNull()
    expect(capAlertFromStop({ ...stop, capRule: 'allow_10' }, new Date())).toBeNull()
    expect(capAlertFromStop({ ...stop, capRule: 'notify' }, new Date())).toMatchObject({
      projectId: 'proj-1',
      used: 10,
      cap: 10,
      month: '2026-10'
    })
  })

  test('Wait for the reset closes the notice and keeps the rule', async () => {
    const seeded = await seed({ progress: [], http: () => envelope('google-no-aio.json') })
    writeProjectScheduleCap(seeded.projectDb, { cap: 5, capRule: 'notify', dedicatedKeyId: null })
    const host = {
      storage: seeded.storage,
      logger: { warn: () => undefined },
      now: () => new Date()
    }
    createCapAlertHandler(host)({
      at: '2026-10-19T12:00:00.000Z',
      projectId: 'proj-1',
      name: 'TextBolt',
      used: 5,
      cap: 5,
      month: '2026-10'
    })
    const notice = listNotices(seeded.storage).notices[0]
    const answered = await resolveNotice(host, {
      noticeId: notice?.id ?? '',
      actionId: 'wait_reset'
    })
    expect(answered.message).toBe('CiteFox will wait for the cap to reset on Nov 1.')
    expect(readEffectiveScheduleCap(seeded.projectDb, '2026-10').capRule).toBe('notify')
    await expect(
      resolveNotice(host, { noticeId: notice?.id ?? '', actionId: 'wait_reset' })
    ).rejects.toThrow('already answered')
  })

  test('the cap email goes out only when the project names recipients', async () => {
    const sent: CapAlert[] = []
    const alert: CapAlert = {
      at: '2026-10-19T12:00:00.000Z',
      projectId: 'proj-1',
      name: 'TextBolt',
      used: 5,
      cap: 5,
      month: '2026-10'
    }
    let emailTo: string[] = []
    const send = capEmail({
      getAlerts: (): AlertSettings => ({
        projectId: 'proj-1',
        desktop: true,
        emailAfterCheck: false,
        emailAccountId: null,
        emailTo,
        slackEnabled: false,
        slackWebhookStored: false,
        monthlyClientPdf: false,
        monthlyPdfTo: null
      }),
      notifyCap: async (input): Promise<NotifyResult> => {
        sent.push(input.alert)
        return { action: 'skipped', reason: 'already_sent' }
      }
    })
    await send(alert)
    expect(sent).toEqual([])
    emailTo = ['ada@example.com']
    await send(alert)
    expect(sent).toEqual([alert])
  })
})
