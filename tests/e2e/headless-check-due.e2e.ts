import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { PASSWORD } from '../../src/main/email/harness'
import {
  CHECK_DUE_EXIT_CAP,
  CHECK_DUE_EXIT_ERROR,
  CHECK_DUE_EXIT_OK
} from '../../src/main/headless/check-due'
import { createHeadlessReportsPort } from '../../src/main/headless'
import { runCheckDueCommand } from '../../src/main/headless/storage-pass'
import { startSmtpTestServer } from '../../src/main/email/smtp-test-server.test-helper'
import { listStoredCheckRuns, listStoredSerpResults } from '../../src/main/storage/check-records'
import { listDeliveries } from '../../src/main/storage/email-records'
import { getKeyUsageForMonth } from '../../src/main/storage/key-usage'
import { getPageMarketLastCheckedAt } from '../../src/main/storage/pages'
import { listRecentTrayChecks } from '../../src/main/storage/tray-history'
import {
  CHECK_DUE_FINISHED,
  CHECK_DUE_NOON,
  REPORT_DUE_AT,
  REPORT_FILENAME,
  REPORT_SUBJECT,
  SERP_SECRET,
  clockAt,
  closeTracked,
  fixtureRunner,
  openTrackedProject,
  reportDelivery,
  reserveMaxSearches,
  seedCheckDueWorkspace,
  type SeedPage
} from './headless-check-due.fixture'

const DUE_ON = '2026-03-01T08:00:00.000Z'
const NOT_DUE_ON = '2026-04-19T08:00:00.000Z'

afterEach(() => {
  closeTracked()
})

test('the production bundle does not include the SMTP test server', (context) => {
  const bundlePath = join(process.cwd(), 'out/main/index.js')
  if (!existsSync(bundlePath)) {
    context.skip(true, 'out/main/index.js is absent. Run npm run build before this check.')
    return
  }
  const source = readFileSync(bundlePath, 'utf8')
  // `src/main/index.ts` inlines package.json, so the devDependency name is present.
  // Drop that manifest key, then the bundle must not mention the package or helper.
  const code = source.replace(/"smtp-server": "[^"]*"/g, '')
  expect(code).not.toContain('smtp-server')
  expect(code).not.toContain('smtp-test-server')
})

test('a due page is checked from recorded fixtures and a page that is not due is skipped', async () => {
  const workspace = seedCheckDueWorkspace({
    pages: [page('page-1', 'Alerts', DUE_ON, true), page('page-2', 'Later', NOT_DUE_ON, true)]
  })
  const clock = clockAt(CHECK_DUE_NOON)
  const wired = fixtureRunner(workspace.storage, workspace.secrets, clock)
  const first = await runCheckDueCommand({
    storage: workspace.storage,
    clock,
    timeZone: 'UTC',
    runner: wired.runner,
    estimateSearches: () => reserveMaxSearches(),
    secrets: [SERP_SECRET],
    logger: wired.logger
  })
  const second = await runCheckDueCommand({
    storage: workspace.storage,
    clock,
    timeZone: 'UTC',
    runner: wired.runner,
    estimateSearches: () => reserveMaxSearches(),
    secrets: [SERP_SECRET],
    logger: wired.logger
  })

  expect(first).toBe(CHECK_DUE_EXIT_OK)
  expect(second).toBe(CHECK_DUE_EXIT_OK)
  expect(wired.calls).toHaveLength(1)
  expect(new URL(wired.calls[0] ?? '').searchParams.get('engine')).toBe('google')
  expect(new URL(wired.calls[0] ?? '').hostname).toBe('serpapi.com')
  const project = openTrackedProject(workspace.dir)
  expect(getPageMarketLastCheckedAt(project, 'page-1', 'mkt-us')).toBe(CHECK_DUE_FINISHED)
  expect(getPageMarketLastCheckedAt(project, 'page-2', 'mkt-us')).toBe(NOT_DUE_ON)
  const runs = listStoredCheckRuns(project, readFilter(['page-1', 'page-2']))
  expect(runs.map((run) => run.pageId)).toEqual(['page-1'])
  expect(runs[0]?.status).toBe('finished')
  const stored = listStoredSerpResults(project, readFilter(['page-1']))
    .map((row) => `${row.rawSearchJson ?? ''}${row.rawAioJson ?? ''}`)
    .join('')
  expect(stored).not.toContain(SERP_SECRET)
  expect(stored.length).toBeGreaterThan(0)
  expect(listRecentTrayChecks(workspace.storage.db)).toEqual([
    expect.objectContaining({
      projectId: 'proj-1',
      pageId: 'page-1',
      finishedAt: CHECK_DUE_FINISHED
    })
  ])
  expect(wired.lines.join('\n')).not.toContain(SERP_SECRET)
})

test('a project search cap reached mid-pass holds the remaining pages', async () => {
  const workspace = seedCheckDueWorkspace({
    pages: [page('page-1', 'Alerts', DUE_ON, true), page('page-2', 'Other', DUE_ON, true)],
    cap: { cap: reserveMaxSearches(), capRule: 'pause', dedicatedKeyId: null }
  })
  const clock = clockAt(CHECK_DUE_NOON)
  const wired = fixtureRunner(workspace.storage, workspace.secrets, clock)
  const code = await runCheckDueCommand({
    storage: workspace.storage,
    clock,
    timeZone: 'UTC',
    runner: wired.runner,
    estimateSearches: () => reserveMaxSearches(),
    secrets: [SERP_SECRET],
    logger: wired.logger
  })

  expect(code).toBe(CHECK_DUE_EXIT_CAP)
  expect(wired.calls).toHaveLength(1)
  const project = openTrackedProject(workspace.dir)
  expect(getPageMarketLastCheckedAt(project, 'page-1', 'mkt-us')).toBe(CHECK_DUE_FINISHED)
  expect(getPageMarketLastCheckedAt(project, 'page-2', 'mkt-us')).toBe(DUE_ON)
  expect(listStoredCheckRuns(project, readFilter(['page-2']))).toEqual([])
  expect(getKeyUsageForMonth(workspace.storage.db, '2026-04').totals.searches).toBe(1)
  const log = wired.lines.join('\n')
  expect(log).not.toContain('Page check failed')
  expect(log).not.toContain(SERP_SECRET)
})

test('a cancelled check is not a failure and leaves last_checked_at unchanged', async () => {
  const workspace = seedCheckDueWorkspace({
    pages: [page('page-1', 'Alerts', DUE_ON, true)]
  })
  const clock = clockAt(CHECK_DUE_NOON)
  const wired = fixtureRunner(workspace.storage, workspace.secrets, clock, new Set(['page-1']))
  const code = await runCheckDueCommand({
    storage: workspace.storage,
    clock,
    timeZone: 'UTC',
    runner: wired.runner,
    estimateSearches: () => reserveMaxSearches(),
    secrets: [SERP_SECRET],
    logger: wired.logger
  })

  expect(code).toBe(CHECK_DUE_EXIT_OK)
  expect(wired.calls).toEqual([])
  const project = openTrackedProject(workspace.dir)
  expect(getPageMarketLastCheckedAt(project, 'page-1', 'mkt-us')).toBe(DUE_ON)
  expect(listRecentTrayChecks(workspace.storage.db)).toEqual([])
  expect(listDeliveries(workspace.storage.db)).toEqual([])
  expect(wired.lines.join('\n')).not.toContain('Page check failed')
})

test('a later page failure still exits 1 after a cancel', async () => {
  const workspace = seedCheckDueWorkspace({
    pages: [page('page-1', 'Alerts', DUE_ON, true), page('page-2', 'Missing', DUE_ON, false)]
  })
  const clock = clockAt(CHECK_DUE_NOON)
  const wired = fixtureRunner(workspace.storage, workspace.secrets, clock, new Set(['page-1']))
  const code = await runCheckDueCommand({
    storage: workspace.storage,
    clock,
    timeZone: 'UTC',
    runner: wired.runner,
    estimateSearches: () => reserveMaxSearches(),
    secrets: [SERP_SECRET],
    logger: wired.logger
  })

  expect(code).toBe(CHECK_DUE_EXIT_ERROR)
  expect(wired.calls).toEqual([])
  const project = openTrackedProject(workspace.dir)
  expect(getPageMarketLastCheckedAt(project, 'page-1', 'mkt-us')).toBe(DUE_ON)
  expect(getPageMarketLastCheckedAt(project, 'page-2', 'mkt-us')).toBe(DUE_ON)
  expect(listRecentTrayChecks(workspace.storage.db)).toEqual([])
  const log = wired.lines.join('\n')
  expect(log).toContain('Page check failed')
  expect(log).toContain('Read the page before checking it.')
  expect(log).not.toContain('Check cancelled.')
})

test('a due scheduled report is generated once and delivered through the SMTP test server', async () => {
  const server = await startSmtpTestServer({
    mode: 'none',
    username: 'mailer',
    password: PASSWORD
  })
  let closed = false
  const closeServer = async (): Promise<void> => {
    if (closed) return
    closed = true
    await server.close()
  }
  try {
    const workspace = seedCheckDueWorkspace({
      pages: [page('page-1', 'Alerts', null, true)],
      smtpPort: server.port
    })
    const clock = clockAt(REPORT_DUE_AT)
    const wired = fixtureRunner(workspace.storage, workspace.secrets, clock)
    const first = await runCheckDueCommand({
      storage: workspace.storage,
      clock,
      timeZone: 'UTC',
      runner: wired.runner,
      estimateSearches: () => reserveMaxSearches(),
      secrets: [SERP_SECRET, PASSWORD],
      logger: wired.logger,
      reports: reportDelivery(workspace.secrets, wired.logger)
    })
    const second = await runCheckDueCommand({
      storage: workspace.storage,
      clock,
      timeZone: 'UTC',
      runner: wired.runner,
      estimateSearches: () => reserveMaxSearches(),
      secrets: [SERP_SECRET, PASSWORD],
      logger: wired.logger,
      reports: reportDelivery(workspace.secrets, wired.logger)
    })

    expect(first).toBe(CHECK_DUE_EXIT_OK)
    expect(second).toBe(CHECK_DUE_EXIT_OK)
    expect(server.mails).toHaveLength(1)
    const raw = server.mails[0]?.raw ?? ''
    expect(raw).toContain(`Subject: ${REPORT_SUBJECT}`)
    expect(raw).toContain(`filename=${REPORT_FILENAME}`)
    expect(raw).toContain('Content-Type: application/pdf')
    expect(raw).toContain('JVBERi0')
    expect(raw).not.toContain(PASSWORD)
    expect(raw).not.toContain(SERP_SECRET)
    const deliveries = listDeliveries(workspace.storage.db)
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0]).toMatchObject({
      scheduleId: 'sched-weekly',
      trigger: 'weekly',
      projectId: 'proj-1',
      recipients: ['client@example.com'],
      outcome: 'sent',
      ok: true,
      occurrenceKey: 'report:sched-weekly:weekly:2026-02-02'
    })
    expect(wired.calls).toHaveLength(1)
  } finally {
    await closeServer()
  }
})

test('the packaged --check-due entry passes a reports port and a due schedule is delivered once', async () => {
  const main = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
  const imported = main.slice(0, main.indexOf("} from './headless'"))
  expect(imported).toContain('createHeadlessReportsPort')
  const run = main.indexOf('runCheckDueCommand({')
  const call = main.slice(run, main.indexOf('} catch (error: unknown) {', run))
  expect(call).toContain('reports: createHeadlessReportsPort({')
  expect(call).toContain('secrets,')
  expect(call).toContain('redacted: appSecretRegistry().list()')

  const server = await startSmtpTestServer({
    mode: 'none',
    username: 'mailer',
    password: PASSWORD
  })
  let closed = false
  const closeServer = async (): Promise<void> => {
    if (closed) return
    closed = true
    await server.close()
  }
  try {
    const workspace = seedCheckDueWorkspace({
      pages: [page('page-1', 'Alerts', null, true)],
      smtpPort: server.port
    })
    const clock = clockAt(REPORT_DUE_AT)
    const wired = fixtureRunner(workspace.storage, workspace.secrets, clock)
    const reports = createHeadlessReportsPort({
      secrets: workspace.secrets,
      logger: wired.logger,
      redacted: [SERP_SECRET, PASSWORD]
    })
    const first = await runCheckDueCommand({
      storage: workspace.storage,
      clock,
      timeZone: 'UTC',
      runner: wired.runner,
      estimateSearches: () => reserveMaxSearches(),
      secrets: [SERP_SECRET, PASSWORD],
      logger: wired.logger,
      reports
    })
    const second = await runCheckDueCommand({
      storage: workspace.storage,
      clock,
      timeZone: 'UTC',
      runner: wired.runner,
      estimateSearches: () => reserveMaxSearches(),
      secrets: [SERP_SECRET, PASSWORD],
      logger: wired.logger,
      reports
    })

    expect(first).toBe(CHECK_DUE_EXIT_OK)
    expect(second).toBe(CHECK_DUE_EXIT_OK)
    expect(server.mails).toHaveLength(1)
    const raw = server.mails[0]?.raw ?? ''
    expect(raw).toContain(`Subject: ${REPORT_SUBJECT}`)
    expect(raw).toContain(`filename=${REPORT_FILENAME}`)
    expect(raw).not.toContain(PASSWORD)
    expect(raw).not.toContain(SERP_SECRET)
    const deliveries = listDeliveries(workspace.storage.db)
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0]).toMatchObject({
      scheduleId: 'sched-weekly',
      trigger: 'weekly',
      outcome: 'sent',
      ok: true
    })
    const log = wired.lines.join('\n')
    expect(log).not.toContain(PASSWORD)
    expect(log).not.toContain(SERP_SECRET)
  } finally {
    await closeServer()
  }
})

function page(id: string, label: string, lastCheckedAt: string | null, ready: boolean): SeedPage {
  return {
    id,
    label,
    url: `https://textbolt.com/${id}`,
    lastCheckedAt,
    ready
  }
}

function readFilter(pageIds: string[]): {
  projectId: string
  pageIds: string[]
  marketId: string
  from: null
  to: null
  runId: null
  promptId: null
} {
  return {
    projectId: 'proj-1',
    pageIds,
    marketId: 'mkt-us',
    from: null,
    to: null,
    runId: null,
    promptId: null
  }
}
