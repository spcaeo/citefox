import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import Database from 'better-sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { installRawMarkdown } from './raw-hook'
import { openAllPages, sidebar } from './nav-helpers'

const SCHEDULE_NAME = 'Drill weekly report'

/**
 * Drill-downs on Export and Scheduled reports through the real handlers
 * (REPORT-SPEC "Interaction model", NFR-14): every count opens exactly what it
 * counts, rows open their detail, and Show in Finder reveals the saved file.
 */
test('export summary counts open their lists and Show in Finder reveals the file', async () => {
  test.setTimeout(180_000)
  const opened = await openSeeded()
  const { app, page } = opened
  try {
    await page.locator('#main').getByRole('link', { name: 'Alerts', exact: true }).click()
    await page.locator('.ui-head-page').getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: 'Export report' }).click()
    const screen = page.locator('.xpt')
    await expect(screen.getByRole('heading', { level: 1, name: 'Export a report' })).toBeVisible()

    for (const id of ['export:pages', 'export:markets', 'export:checks']) {
      const opener = screen.locator(`[data-nfr-drill="${id}"]`)
      await expect(opener).toBeVisible()
      const shown = Number(await opener.locator(`[data-nfr-figure="${id}"]`).innerText())
      expect(shown).toBeGreaterThan(0)
      await opener.focus()
      await page.keyboard.press('Enter')
      const drawer = page.locator(`[role="dialog"][data-drill="${id}"]`)
      await expect(drawer).toBeVisible()
      await expect(drawer.locator('[data-drill-row]')).toHaveCount(shown)
      await page.keyboard.press('Escape')
      await expect(drawer).toHaveCount(0)
      await expect(opener).toBeFocused()
    }

    await app.evaluate(({ dialog, shell }) => {
      const target = global as typeof globalThis & {
        __citefoxExportPath?: string
        __citefoxRevealed?: string[]
      }
      target.__citefoxRevealed = []
      dialog.showSaveDialog = (async () => {
        const filePath = target.__citefoxExportPath
        if (filePath === undefined || filePath.length === 0) return { canceled: true }
        return { canceled: false, filePath }
      }) as typeof dialog.showSaveDialog
      shell.showItemInFolder = (filePath: string) => {
        target.__citefoxRevealed?.push(filePath)
      }
    })
    const filePath = path.join(opened.dir, 'drill-report.zip')
    await app.evaluate((_, next: string) => {
      ;(global as typeof globalThis & { __citefoxExportPath?: string }).__citefoxExportPath = next
    }, filePath)
    await screen
      .getByRole('radiogroup', { name: 'Format' })
      .getByRole('radio', { name: /CSV/ })
      .click()
    await expect(
      screen.getByRole('button', {
        name: /^Save (HTML report|PDF|Excel workbook|CSV tables|JSON)$/
      })
    ).toBeEnabled()
    await screen
      .getByRole('button', { name: /^Save (HTML report|PDF|Excel workbook|CSV tables|JSON)$/ })
      .click()
    // The file manager of the computer the test runs on (Linux in Docker).
    const reveal =
      process.platform === 'darwin'
        ? 'Show in Finder'
        : process.platform === 'win32'
          ? 'Show in Explorer'
          : 'Show in folder'
    await screen.getByRole('button', { name: reveal, exact: true }).click()
    await expect(screen.getByText(/Shown in Finder\. On this computer:/)).toBeVisible()
    const revealed = await app.evaluate(
      () => (global as typeof globalThis & { __citefoxRevealed?: string[] }).__citefoxRevealed
    )
    expect(revealed).toEqual([filePath])
    // The renderer cannot reveal a path no export wrote.
    const refused = await page.evaluate(async () => {
      const api = (
        window as unknown as {
          citefox: {
            'exports:reveal': (request: { filePath: string }) => Promise<{ ok: boolean }>
          }
        }
      ).citefox
      return api['exports:reveal']({ filePath: '/etc/hosts' })
    })
    expect(refused.ok).toBe(false)
    await shot(page, 'drill-export')
  } finally {
    await opened.close()
  }
})

test('schedule rows, cells and deliveries open their details', async () => {
  test.setTimeout(180_000)
  const first = await openSeeded()
  let scheduleId: string
  try {
    await sidebar(first.page).getByRole('link', { name: 'Reports', exact: true }).click()
    // Reports opens on Ready reports; schedules sit under Scheduled emails.
    await first.page.getByRole('tab', { name: /^Scheduled emails/ }).click()
    await first.page.getByRole('button', { name: 'New schedule' }).first().click()
    const form = first.page.locator('.rpt [data-drawer="schedule"]')
    await form.getByLabel('Name').fill(SCHEDULE_NAME)
    await form.getByLabel('Project', { exact: true }).selectOption({ label: 'TextBolt' })
    for (const address of ['one@example.com', 'two@example.com']) {
      await form.getByLabel('Recipients').fill(address)
      await form.getByRole('button', { name: 'Add', exact: true }).click()
    }
    await form.getByRole('button', { name: 'Save schedule' }).click()
    await expect(
      first.page.getByRole('button', { name: `${SCHEDULE_NAME}: open details` })
    ).toBeVisible()
    const listed = await first.page.evaluate(async () => {
      const api = (
        window as unknown as { citefox: { 'reports:list': () => Promise<{ id: string }[]> } }
      ).citefox
      return api['reports:list']()
    })
    scheduleId = listed[0]?.id ?? ''
  } finally {
    await first.app.close()
  }
  expect(scheduleId).not.toBe('')
  // A failed send of that schedule, as the email engine records it.
  const db = new Database(path.join(first.dir, 'app.sqlite'))
  db.prepare(
    `INSERT INTO deliveries (id, schedule_id, at, trigger, project_id, recipients, ok, error, outcome, next_step)
     VALUES (?, ?, ?, 'weekly', 'proj-1', ?, 0, ?, 'failed', ?)`
  ).run(
    'drill-delivery',
    scheduleId,
    new Date(Date.now() - 3_600_000).toISOString(),
    JSON.stringify(['one@example.com']),
    'SMTP sign-in failed: 535 authentication failed',
    'Fix the sending account in Email setup.'
  )
  db.close()

  const opened = await openSeeded(first.dir)
  const { page } = opened
  try {
    await sidebar(page).getByRole('link', { name: 'Reports', exact: true }).click()
    await page.getByRole('tab', { name: /^Scheduled emails/ }).click()
    const screen = page.locator('.rpt')
    const name = screen.getByRole('button', { name: `${SCHEDULE_NAME}: open details` })
    await expect(name).toBeVisible()
    await shot(page, 'scheduled-reports-grid')

    // Recipients: the drawer lists exactly the two addresses.
    await screen
      .getByRole('button', { name: new RegExp(`: show the 2 recipients of ${SCHEDULE_NAME}$`) })
      .click()
    const recipients = page.getByRole('dialog', {
      name: new RegExp(`Recipients of ${SCHEDULE_NAME}`)
    })
    await expect(recipients.locator('[data-drill-row]')).toHaveCount(2)
    await page.keyboard.press('Escape')

    // Next sends: three weekly slots.
    await screen
      .getByRole('button', { name: new RegExp(`: show the next sends of ${SCHEDULE_NAME}$`) })
      .click()
    const next = page.getByRole('dialog', { name: new RegExp(`Next sends of ${SCHEDULE_NAME}`) })
    await expect(next.locator('[data-drill-row]')).toHaveCount(3)
    await page.keyboard.press('Escape')

    // The row opens the schedule detail by keyboard.
    const row = page
      .locator('[data-row]')
      .filter({ has: page.getByRole('button', { name: `${SCHEDULE_NAME}: open details` }) })
      .first()
    await row.focus()
    await page.keyboard.press('Enter')
    const detail = page.getByRole('dialog', { name: SCHEDULE_NAME, exact: true })
    await expect(detail).toBeVisible()
    await expect(detail.getByText('Next sends')).toBeVisible()
    await expect(detail.getByTestId('sd-deliveries')).toContainText(/Deliveries\s*1/)
    await page.keyboard.press('Escape')
    await expect(detail).toHaveCount(0)

    // Last result opens that delivery.
    await screen
      .getByRole('button', { name: new RegExp(`: open the last delivery of ${SCHEDULE_NAME}$`) })
      .click()
    const fromLast = page.getByRole('dialog', { name: new RegExp(`^${SCHEDULE_NAME} · `) })
    await expect(fromLast.getByText(/535 authentication failed/)).toBeVisible()
    await page.keyboard.press('Escape')

    // Delivery history: a click on the row opens the delivery detail.
    await screen.getByRole('tab', { name: /^Delivery history/ }).click()
    const history = screen.getByRole('grid', { name: 'Delivery history' })
    const delivery = history.locator('[data-row]').first()
    await expect(delivery).toBeVisible()
    await delivery.click({ position: { x: 8, y: 8 } })
    const drawer = page.getByRole('dialog', { name: new RegExp(`^${SCHEDULE_NAME} · `) })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByText('Sent to · 1')).toBeVisible()
    await expect(drawer.getByText('Fix the sending account in Email setup.')).toBeVisible()
    await expect(drawer.getByRole('link', { name: 'Fix in Email setup' })).toBeVisible()
    await expect(
      drawer.getByRole('button', { name: new RegExp(`^Retry ${SCHEDULE_NAME}`) })
    ).toBeVisible()
    await drawer.getByRole('button', { name: 'Open schedule', exact: true }).click()
    await expect(page.getByRole('dialog', { name: SCHEDULE_NAME, exact: true })).toBeVisible()
    await shot(page, 'drill-schedules')
  } finally {
    await opened.close()
  }
})

async function openSeeded(existing?: string): Promise<{
  app: ElectronApplication
  page: Page
  dir: string
  close: () => Promise<void>
}> {
  installRawMarkdown()
  const { seedFixtureProject } = await import('./fixture-project')
  const dir = existing ?? (await mkdtemp(path.join(os.tmpdir(), 'citefox-drill-reports-')))
  if (existing === undefined) await seedFixtureProject(dir)
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1280, height: 900 }
  })
  await openAllPages(page)
  return {
    app,
    page,
    dir,
    close: async () => {
      await app.close()
      await rm(dir, { recursive: true, force: true })
    }
  }
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: await e2eArtifact(`${name}.png`), fullPage: false })
}
