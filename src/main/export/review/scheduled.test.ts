import { SCHEDULED_REPORT_KINDS, type CheckProgress } from '@shared/index'
import { REPORT_KINDS } from '@shared/report/review'
import { afterEach, describe, expect, test } from 'vitest'
import { closeSeeds, seed } from '../../engine/checks/checks.test-helper'
import { scheduledReportPayload } from '../../headless/due-reports'
import { captureLogger } from '../../providers/claude/claude-test-fakes.test-helper'
import type { ReportSchedule } from '../../email/types'
import { configureReviewPdfPrinter } from './download'
import { readyReportRequest, readyReportScope } from './scheduled'

/**
 * A schedule that sends a ready report: the same file Reports' Download saves (PDF,
 * offline HTML without a printer), its headline as the body. Nothing is emailed here:
 * this builds the payload only.
 */

const NOW = new Date('2026-10-30T12:00:00.000Z')

const SCHEDULE: ReportSchedule = {
  id: 'sch-1',
  name: 'Weekly visibility',
  projectId: 'proj-1',
  scope: null,
  report: { kind: 'visibility', rival: null },
  timing: { kind: 'weekly', day: 1, time: '08:00' },
  format: 'pdf',
  sections: [],
  marketIds: [],
  recipients: ['client@example.com'],
  accountId: null,
  timeZone: 'America/Toronto',
  subject: '{project}: Visibility report',
  summaryStyle: null,
  status: 'active',
  createdAt: '2026-10-01T00:00:00.000Z'
}

afterEach(() => {
  configureReviewPdfPrinter(null)
  closeSeeds()
})

async function storage(): Promise<Awaited<ReturnType<typeof seed>>['storage']> {
  const seeded = await seed({
    progress: [] as CheckProgress[],
    http() {
      throw new Error('A scheduled report must not search')
    }
  })
  return seeded.storage
}

describe('scheduled ready reports', () => {
  test('the schedule kinds are the ready report kinds', () => {
    expect([...SCHEDULED_REPORT_KINDS]).toEqual([...REPORT_KINDS])
  })

  test('attaches the PDF Download prints, with the report headline as the body', async () => {
    const printed: string[] = []
    configureReviewPdfPrinter(async (html) => {
      printed.push(html)
      return Buffer.from('%PDF-1.7 test')
    })
    const payload = await scheduledReportPayload(await storage(), SCHEDULE, NOW, {
      logger: captureLogger().logger
    })
    expect(payload.attachment?.contentType).toBe('application/pdf')
    expect(payload.attachment?.filename).toMatch(/visibility-report.*\.pdf$/)
    expect(Buffer.from(payload.attachment?.bytes ?? []).toString()).toBe('%PDF-1.7 test')
    expect(printed).toHaveLength(1)
    expect(printed[0]).toContain('Visibility report')
    expect(payload.facts.lines[0]).toMatch(/^Visibility report · /)
    expect(payload.facts.lines).toContain('Attached: the full report as a PDF.')
  })

  test('without a printer (a background run), the offline HTML file goes instead', async () => {
    const payload = await scheduledReportPayload(
      await storage(),
      { ...SCHEDULE, report: { kind: 'rival', rival: 'twilio.com' } },
      NOW,
      { logger: captureLogger().logger }
    )
    expect(payload.attachment?.contentType).toBe('text/html')
    expect(payload.attachment?.filename).toMatch(/head-to-head.*\.html$/)
    expect(payload.facts.lines[0]).toMatch(/^Head-to-head · /)
  })

  test('summary only: the body, no file', async () => {
    const payload = await scheduledReportPayload(
      await storage(),
      { ...SCHEDULE, format: 'summary', report: { kind: 'changed', rival: null } },
      NOW,
      { logger: captureLogger().logger }
    )
    expect(payload.attachment).toBeNull()
    expect(payload.facts.lines[0]).toMatch(/^What changed · /)
  })

  test('one topic or page is read as itself; anything wider as the whole project', () => {
    expect(readyReportScope(null)).toEqual({ kind: 'project' })
    expect(readyReportScope({ kind: 'topic', ids: ['t1'] })).toEqual({ kind: 'topic', id: 't1' })
    expect(readyReportScope({ kind: 'pages', ids: ['p1'] })).toEqual({ kind: 'page', id: 'p1' })
    expect(readyReportScope({ kind: 'pages', ids: ['p1', 'p2'] })).toEqual({ kind: 'project' })
    expect(readyReportScope({ kind: 'group', ids: ['g1'] })).toEqual({ kind: 'project' })
    const request = readyReportRequest('proj-1', {
      report: { kind: 'rival', rival: 'twilio.com' },
      scope: null,
      marketIds: ['m1'],
      timeZone: 'America/Toronto',
      html: false
    })
    expect(request).toMatchObject({
      report: 'rival',
      rival: 'twilio.com',
      marketId: 'm1',
      format: 'pdf'
    })
  })
})
