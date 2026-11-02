import type { CheckProgress, ReportDownloadRequest } from '@shared/ipc'
import { NO_SENDER, type ReportSender } from '@shared/report/review'
import { afterEach, describe, expect, test } from 'vitest'
import { closeSeeds, seed } from '../../engine/checks/checks.test-helper'
import { setReportBranding } from '../../storage/report-branding'
import { getProject } from '../../storage/records'
import { buildReviewDownload, reviewHtml } from './index'
import { htmlProblems, visibleText } from './quality'

/**
 * The download cover by Settings › Reports mode: an agency (agency left, client right,
 * "Prepared by" footer), in-house (company left, optional team right) and none (today's
 * file, byte for byte). The quality check passes and the sponsors stay.
 */

const NOW = new Date('2026-10-30T12:00:00.000Z')
const ZONE = 'America/Toronto'
const LOGO = 'data:image/png;base64,iVBORw0KGgo='

const REQUEST: ReportDownloadRequest = {
  projectId: 'proj-1',
  scope: { kind: 'project' },
  marketId: null,
  engine: 'all',
  from: null,
  to: null,
  report: 'visibility',
  format: 'html',
  table: null,
  timeZone: ZONE
}

const AGENCY: ReportSender = {
  mode: 'agency',
  name: 'Northwind SEO',
  logo: LOGO,
  website: 'northwindseo.com',
  email: 'hello@northwindseo.com',
  preparedBy: ''
}

afterEach(() => closeSeeds())

async function project(): Promise<{
  db: Awaited<ReturnType<typeof seed>>['projectDb']
  record: NonNullable<ReturnType<typeof getProject>>
}> {
  const seeded = await seed({
    progress: [] as CheckProgress[],
    http() {
      throw new Error('Reports must not search')
    }
  })
  const record = getProject(seeded.storage.db, 'proj-1')
  if (record === null) throw new Error('no project')
  return { db: seeded.projectDb, record }
}

function html(
  db: Awaited<ReturnType<typeof project>>['db'],
  record: Awaited<ReturnType<typeof project>>['record'],
  sender: ReportSender | null,
  icon: string | null = null
): { text: string; raw: string; problems: string[] } {
  const build = buildReviewDownload(
    db,
    record,
    REQUEST,
    NOW,
    sender === null ? null : { sender, brandIcon: () => icon }
  )
  const raw = reviewHtml(build, NOW, ZONE)
  return { raw, text: visibleText(raw), problems: htmlProblems(raw, build.variants) }
}

describe('download cover with branding', () => {
  test('no branding (and Just me) keeps today’s file exactly', async () => {
    const { db, record } = await project()
    setReportBranding(db, { preparedFor: 'Acme Inc.', logo: null }, NOW.toISOString())
    const today = html(db, record, null)
    const none = html(db, record, NO_SENDER)
    expect(none.raw).toBe(today.raw)
    expect(today.raw).not.toContain('report-byline')
    expect(today.text).toContain('Prepared for Acme Inc.')
    expect(today.text).toContain('Built with CiteFox Built')
    // An agency with no name yet is not branding either.
    expect(html(db, record, { ...AGENCY, name: '' }).raw).toBe(today.raw)
  })

  test('agency: agency logo, name, website and email left; the client right; the footer', async () => {
    const { db, record } = await project()
    const plain = html(db, record, AGENCY)
    // No client name saved: the project's brand.
    expect(plain.raw).toContain('data-testid="report-byline" data-mode="agency"')
    expect(plain.text).toContain('Northwind SEO northwindseo.com · hello@northwindseo.com')
    expect(plain.text).toContain('Prepared for TextBolt')
    setReportBranding(db, { preparedFor: 'Acme Inc.', logo: LOGO }, NOW.toISOString())
    const file = html(db, record, AGENCY)
    expect(file.problems).toEqual([])
    expect(file.text).toContain('Prepared for Acme Inc.')
    expect(file.raw).toContain(`<img class="rv-from-logo" src="${LOGO}" alt="Northwind SEO">`)
    expect(file.raw).toContain('href="https://northwindseo.com"')
    expect(file.raw).toContain('href="mailto:hello@northwindseo.com"')
    expect(file.raw).toContain(`<img class="rv-client-logo" src="${LOGO}" alt="Acme Inc.">`)
    // The old "Prepared for" line gives way to the header: said once.
    expect(file.raw).not.toContain('data-testid="prepared-for"')
    expect(file.text).toContain(
      'Prepared by Northwind SEO · Every number opens the list behind it Built with CiteFox'
    )
    // The sponsors stay.
    expect(file.text).toContain('FoxCue')
    expect(file.text).toContain('FreshlyCited')
    expect(file.text).not.toMatch(/\bclient\b/i)
  })

  test('in-house: the company (the brand and its site icon) left, the team right, no client', async () => {
    const { db, record } = await project()
    const company: ReportSender = { ...NO_SENDER, mode: 'company' }
    const bare = html(db, record, company, LOGO)
    expect(bare.problems).toEqual([])
    expect(bare.raw).toContain('data-mode="company"')
    expect(bare.raw).toContain(`<img class="rv-from-logo" src="${LOGO}" alt="TextBolt">`)
    expect(bare.text).not.toContain('Prepared for')
    expect(bare.text).not.toContain('Prepared by')
    expect(bare.text).toContain('Built with CiteFox Built')
    setReportBranding(
      db,
      { preparedFor: 'Leadership team', logo: LOGO, preparedBy: 'Growth team' },
      NOW.toISOString()
    )
    const full = html(db, record, { ...company, name: 'TextBolt Inc.' })
    expect(full.problems).toEqual([])
    expect(full.text).toContain('TextBolt Inc.')
    expect(full.text).toContain('Prepared for Leadership team')
    expect(full.text).toContain('Prepared by Growth team · Every number opens the list behind it')
    // In-house shows no client logo.
    expect(full.raw).not.toContain('class="rv-client-logo"')
    expect(full.text).not.toMatch(/\bclient\b/i)
  })
})
