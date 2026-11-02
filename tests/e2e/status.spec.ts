import type { CiteFoxApi } from '@shared/ipc'
import { expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { launchCiteFox } from './launch'
import { installRawMarkdown } from './raw-hook'
import { expectMainAccessible, openTwoMarketApp, shot } from './screens-app'
import { openAllPages } from './nav-helpers'

test('status opens from the capsule and pauses and resumes checks on real IPC', async () => {
  test.setTimeout(180_000)
  const { page, close } = await openTwoMarketApp('status')
  try {
    const capsule = page.getByRole('banner').locator('.status-pill')
    await expect(capsule).toHaveAttribute('aria-label', /^210 searches left this month/)
    await expect(capsule).toHaveAttribute('data-tip', /^210 searches left this month/)
    // Between 1134 and 1440 px (the sizes people use) the top bar never scrolls sideways,
    // and every control stays on it: the search, Activity, searches left, Ask and ⚙.
    for (const width of [1134, 1321, 1366, 1440]) {
      await page.setViewportSize({ width, height: 770 })
      await expect(capsule).toBeVisible()
      const banner = page.getByRole('banner')
      for (const control of [
        banner.locator('.topbar-search'),
        banner.getByRole('button', { name: /^Activity/ }),
        banner.getByRole('button', { name: 'Ask CiteFox', exact: true }),
        banner.getByRole('button', { name: 'Settings menu', exact: true })
      ]) {
        await expect(control).toBeInViewport()
      }
      await expect
        .poll(
          () =>
            page
              .getByRole('banner')
              .first()
              .evaluate((bar) => bar.scrollWidth - bar.clientWidth),
          { message: `top bar at ${width}` }
        )
        .toBeLessThanOrEqual(1)
    }
    await page.setViewportSize({ width: 1280, height: 900 })
    await capsule.click()
    const dialog = page.getByRole('dialog', { name: 'Credits and connections' })
    await expect(dialog).toBeVisible()
    await expect(
      dialog.getByRole('img', {
        name: '40 of 250 used on the SerpApi account this month (all apps)'
      })
    ).toBeVisible()
    await expect(dialog.getByRole('list', { name: 'SerpApi keys' }).getByRole('link')).toHaveCount(
      1
    )
    await dialog.getByRole('link', { name: 'Open Status' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Status' })).toBeVisible()
    await expect(dialog).toHaveCount(0)
    await expect(capsule).toHaveAttribute('aria-current', 'page')

    const capsuleState = await page.evaluate(() =>
      (globalThis as typeof globalThis & { citefox: CiteFoxApi }).citefox['status:getCapsule']()
    )
    const summary = page.getByRole('region', { name: 'Summary' })
    await expect(summary.locator('.sts-kpi', { hasText: 'Searches left' })).toContainText(
      (capsuleState.searchesLeft ?? 0).toLocaleString('en-US')
    )
    // One readiness model: the Open issues tile says what the capsule says.
    const capsuleLabel = (await capsule.getAttribute('aria-label')) ?? ''
    const readiness =
      /searches left this month · (?:Setup: )?([^.]+)/.exec(capsuleLabel)?.[1] ?? 'missing'
    // The pill is short ("1 step left"); the tile spells it out ("1 required step left").
    await expect(summary.locator('.sts-kpi', { hasText: 'Open issues' })).toContainText(
      new RegExp(readiness.replace(/ (steps?) left/, ' (required )?$1 left'))
    )

    // One summary row per service; keys are listed and changed on Connections.
    const connections = page.getByRole('grid', { name: 'Connections' })
    await expect(
      connections.getByRole('button', {
        name: '40 of 250 used on the SerpApi account this month (all apps): show each key'
      })
    ).toBeVisible()
    await expect(connections).toContainText('210 left')
    for (const [name, tab] of [
      ['SerpApi', 'serpapi'],
      ['Claude', 'claude'],
      ['Jina Reader', 'jina'],
      ['YouTube Data API', 'youtube']
    ] as const) {
      await expect(connections.getByRole('link', { name, exact: true })).toHaveAttribute(
        'href',
        `#/connections?tab=${tab}`
      )
    }
    await expect(connections).toContainText('Add a key to see video views')
    const sections = page.getByRole('tablist', { name: 'Status sections' })
    await sections.getByRole('tab', { name: 'Email' }).click()
    await expect(page.getByRole('region', { name: 'Email' })).toContainText('No sending account')

    await sections.getByRole('tab', { name: /^Usage/ }).click()
    const usage = page.getByRole('region', { name: "This month's searches by project" })
    await expect(usage.getByText(/TextBolt/).first()).toBeVisible()
    await sections.getByRole('tab', { name: 'Connections' }).click()

    // Every number drills, and the drawer total equals the number clicked (NFR-14).
    const drawer = page.locator('[role="dialog"].drill-drawer')
    const rows = drawer.locator('[data-drill-row]')
    const issues = summary.locator('[data-nfr-drill="status:issues"]')
    const issueFigure = Number(await issues.locator('[data-nfr-figure]').innerText())
    await issues.click()
    await expect(rows).toHaveCount(issueFigure)
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
    await expect(issues).toBeFocused()

    // A zero count is plain text (nothing to open); any other count opens exactly its rows.
    const dueCount = Number(
      await summary.locator('[data-nfr-figure="queue:due"]').first().innerText()
    )
    const due = summary.locator('[data-nfr-drill="queue:due"]')
    if (dueCount === 0) {
      await expect(due).toHaveCount(0)
    } else {
      await due.focus()
      await page.keyboard.press('Enter')
      await expect(rows).toHaveCount(dueCount)
      await page.keyboard.press('Escape')
    }

    await summary.getByRole('button', { name: /searches left: show each key/ }).click()
    await expect(drawer).toContainText('210 left')
    await expect(rows).toHaveCount(1)
    await rows.first().click()
    await expect(page.getByRole('heading', { level: 1, name: 'Connections' })).toBeVisible()
    await page.goBack()
    await expect(page.getByRole('heading', { level: 1, name: 'Status' })).toBeVisible()
    // Back returns to the drill it left (the drill is on the URL); Esc closes it.
    await expect(drawer).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)

    await sections.getByRole('tab', { name: 'Checks' }).click()
    const checks = page.getByRole('region', { name: 'Checks' })
    await expect(checks.getByText(/background job (on|off)/)).toBeVisible()
    await expect(page.getByText(/Error invoking remote method/)).toHaveCount(0)
    await expectMainAccessible(page)
    await shot(page, 'status', true)

    await checks.getByRole('button', { name: 'Pause all checks' }).click()
    await expect(checks.getByText('All checks paused until you resume.')).toBeVisible()
    await expect(checks.getByText('Off', { exact: true })).toBeVisible()
    await shot(page, 'status-paused')
    await checks.getByRole('button', { name: 'Resume checks' }).click()
    await expect(checks.getByText('Checks run on schedule.')).toBeVisible()
    const queue = await page.evaluate(() =>
      (globalThis as typeof globalThis & { citefox: CiteFoxApi }).citefox['queue:getStatus']()
    )
    expect(queue.state).toBe('running')

    // A popover chip opens its Status card and closes the popover.
    await capsule.click()
    await dialog.getByRole('button', { name: /^SerpApi: .*Show on Status$/ }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.st-screen #st-serp')).toBeFocused()

    await page.getByRole('button', { name: 'Refresh' }).click()
    await expect(page.getByText(/^Updated \d{1,2}:\d{2}(\s?[AP]M)?$/)).toBeVisible()
  } finally {
    await close()
  }
})

/** One open search-cap notice and two pages setting up, one of them failed for good. */
async function seedNoticeAndSetup(userDataDir: string): Promise<void> {
  const { SEED } = await import('./screens-seed')
  const { openAppStorage } = await import('../../src/main/storage/app-storage')
  const { closeProjectDatabase, openProjectDatabase } =
    await import('../../src/main/storage/project-files')
  const { addNotice } = await import('../../src/main/storage/notices')
  const { insertPage } = await import('../../src/main/storage/pages')
  const { writePageSetupJob } = await import('../../src/main/storage/page-setup-jobs')
  const storage = openAppStorage(userDataDir)
  const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  try {
    const now = new Date().toISOString()
    addNotice(storage.db, {
      id: 'notice-e2e',
      kind: 'search_cap',
      projectId: SEED.projectId,
      dedupeKey: `search_cap:${SEED.projectId}:e2e`,
      title: 'TextBolt reached its search cap',
      body: 'Checks are waiting. Choose what happens this month.',
      actions: [
        { id: 'allow_10_month', label: 'Continue this month at 10% over', primary: true },
        { id: 'wait_reset', label: 'Wait for the reset', primary: false }
      ],
      data: { month: now.slice(0, 7) },
      createdAt: now
    })
    for (const [id, label] of [
      ['setup-a', 'Pricing'],
      ['setup-b', 'Broken page']
    ] as const) {
      insertPage(db, {
        id,
        projectId: SEED.projectId,
        url: `https://textbolt.com/${id}/`,
        title: null,
        label,
        folder: null,
        status: 'setting_up',
        setupStep: 'read',
        intervalDays: 14,
        samples: 1,
        promptCount: 10,
        defaultMarketId: null,
        pinned: false,
        score: null,
        promptSetVersion: null
      })
    }
    writePageSetupJob(db, {
      pageId: 'setup-b',
      state: 'failed',
      step: 'read',
      attempts: 4,
      nextAttemptAt: null,
      lastError: 'The page returned 404.',
      nextStep: 'Check the URL, then retry.',
      startedAt: now,
      finishedAt: now,
      updatedAt: now
    })
  } finally {
    closeProjectDatabase(db)
    storage.close()
  }
}

test('notices and background page setup on real IPC', async () => {
  test.setTimeout(180_000)
  installRawMarkdown()
  const { seedTwoMarketProject } = await import('./screens-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-status-live-'))
  await seedTwoMarketProject(dir)
  await seedNoticeAndSetup(dir)
  const { app, page } = await launchCiteFox({ userDataDir: dir })
  try {
    await openAllPages(page)
    const capsule = page.getByRole('banner').locator('.status-pill')
    await expect(capsule).toHaveAttribute('aria-label', /1 decision waiting for you/)
    // The badge counts what needs you: setup steps left plus decisions waiting.
    await expect(capsule.locator('.sp-badge')).toHaveText(/^[1-9]\d*$/)

    // The popover lists the notice; Status answers it.
    await capsule.click()
    const dialog = page.getByRole('dialog', { name: 'Credits and connections' })
    await expect(dialog.getByText('TextBolt reached its search cap')).toBeVisible()
    await dialog.getByRole('link', { name: 'Open Status' }).click()

    const notices = page.getByRole('region', { name: 'Decisions waiting for you' })
    await expect(notices).toBeVisible()

    // Page setup (Checks tab): counts drill to their pages, totals match (NFR-14).
    await page
      .getByRole('tablist', { name: 'Status sections' })
      .getByRole('tab', { name: 'Checks' })
      .click()
    const setup = page.getByRole('region', { name: 'Page setup' })
    const drawer = page.locator('[role="dialog"].drill-drawer')
    const rows = drawer.locator('[data-drill-row]')
    await setup.getByRole('button', { name: /^1 waiting: show the pages/ }).click()
    await expect(rows).toHaveCount(1)
    await expect(drawer).toContainText('Pricing')
    await page.keyboard.press('Escape')
    const failed = setup.getByRole('button', { name: /^1 failed: show the pages/ })
    await failed.focus()
    await page.keyboard.press('Enter')
    await expect(rows).toHaveCount(1)
    await expect(drawer).toContainText('Broken page')
    await page.keyboard.press('Escape')
    await expect(setup.getByText(/The page returned 404/)).toBeVisible()
    await expectMainAccessible(page)
    await shot(page, 'status-setup-notices', true)

    await setup.getByRole('button', { name: 'Pause page setup' }).click()
    await expect(setup.getByRole('button', { name: 'Resume page setup' })).toBeVisible()
    await setup.getByRole('button', { name: 'Resume page setup' }).click()
    await setup.getByLabel('Pages an hour').fill('30')
    await setup.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(setup.getByLabel('Pages an hour')).toHaveValue('30')
    await setup.getByRole('button', { name: 'Retry Broken page' }).click()
    await expect(setup.getByRole('button', { name: /^1 failed/ })).toHaveCount(0)
    const status = await page.evaluate(() =>
      (globalThis as typeof globalThis & { citefox: CiteFoxApi }).citefox['setup:status']()
    )
    expect(status.pagesPerHour).toBe(30)
    expect(status.failed).toBe(0)

    await notices.getByRole('button', { name: /^Actions for / }).click()
    await page.getByRole('menuitem', { name: 'Wait for the reset' }).click()
    await expect(notices.getByText(/wait for the cap to reset/)).toBeVisible()
    // The decision is answered: the button no longer counts it (setup steps may remain).
    await expect(capsule).not.toHaveAttribute('aria-label', /decision/)
    const open = await page.evaluate(() =>
      (globalThis as typeof globalThis & { citefox: CiteFoxApi }).citefox['notices:list']()
    )
    expect(open.notices).toHaveLength(0)
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
