import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { animationsDone, DRAWER_SIZES } from './drawer-helpers'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { openAllPages } from './nav-helpers'
import { installRawMarkdown } from './raw-hook'
import { chooseRowAction } from './row-menu'
import { openHash } from './screens-app'

/**
 * Scheduled reports and Export (tracking.md §4, §5): one schedule drawer on the
 * URL (settings left, live email preview right), recipients as chips, a
 * searchable time zone, Duplicate and Send now, the All sends tab, and Export's
 * scope chooser up to 2,014 pages with "Schedule this".
 *
 * No email leaves the machine: the fixture has no sending account and main's
 * mail-app opener is the unconfigured one, so Send now records a delivery
 * (failed or a draft) without any transport.
 */
const HOME = { width: 1440, height: 900 }
const NAME = 'Deep weekly report'

/** `reports-<what>-<width>.png` at 1440x900 and 1134x770, then back to 1440x900. */
async function shots(page: Page, name: string, inView?: Locator): Promise<void> {
  for (const size of DRAWER_SIZES) {
    await page.setViewportSize(size)
    await animationsDone(page)
    // The smaller window can push the subject below the fold: bring it back.
    await inView?.scrollIntoViewIfNeeded()
    await page.screenshot({ path: await e2eArtifact(`${name}-${size.width}.png`) })
  }
  await page.setViewportSize(HOME)
  await animationsDone(page)
}

async function openSeeded(
  seed: 'fixture' | 'scale',
  heading: string | RegExp = 'TextBolt'
): Promise<{ page: Page; close: () => Promise<void> }> {
  installRawMarkdown()
  const dir = await mkdtemp(path.join(os.tmpdir(), `citefox-reports-deep-${seed}-`))
  if (seed === 'fixture') {
    const { seedFixtureProject } = await import('./fixture-project')
    await seedFixtureProject(dir)
  } else {
    const { seedScaleProject } = await import('./scale-seed')
    await seedScaleProject(dir)
  }
  const { app, page } = await launchCiteFox({ userDataDir: dir, viewport: HOME })
  await openAllPages(page, heading)
  return {
    page,
    close: async () => {
      await app.close()
      await rm(dir, { recursive: true, force: true })
    }
  }
}

function scheduleDrawer(page: Page, name: string | RegExp): Locator {
  return page.getByRole('dialog', { name, exact: typeof name === 'string' })
}

/** The relative luminance (0–255) of a computed `rgb(...)` background. */
async function backgroundLevel(
  locator: Locator,
  property: 'backgroundColor' | 'color' = 'backgroundColor'
): Promise<number> {
  const color = await locator.evaluate((node, key) => getComputedStyle(node)[key], property)
  const [r = 0, g = 0, b = 0] = (color.match(/\d+(\.\d+)?/g) ?? []).map(Number)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

test('Scheduled reports: drawer on the URL, chips, time zone, Send now, Duplicate, All sends', async () => {
  test.setTimeout(300_000)
  const { page, close } = await openSeeded('fixture')
  try {
    await openHash(page, '#/reports?tab=emails')
    const screen = page.locator('.rpt')
    await expect(screen.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible()
    // One short subtitle: All sends (a tab) lists the other automatic sends.
    await expect(screen.getByTestId('rpt-elsewhere')).toHaveCount(0)

    // New schedule: the drawer is on the URL and survives a reload.
    await screen.getByRole('button', { name: 'New schedule' }).first().click()
    let drawer = scheduleDrawer(page, 'New schedule')
    await expect(drawer).toBeVisible()
    expect(page.url()).toContain('drawer=schedule')
    expect(page.url()).toContain('schedule.id=new')
    await page.reload()
    drawer = scheduleDrawer(page, 'New schedule')
    await expect(drawer).toBeVisible()

    // The open project is picked; "All my projects" is a separate choice.
    const project = drawer.getByLabel('Project', { exact: true })
    await expect(project.locator('option:checked')).toHaveText(/TextBolt/)
    await expect(
      project.locator('option', { hasText: 'All my projects (one email each)' })
    ).toHaveCount(1)
    await expect(drawer.getByRole('radio', { name: /Whole project/ })).toBeChecked()
    await expect(drawer.getByText(/Change or stop this report in CiteFox › Reports/)).toBeVisible()
    await expect(drawer.getByTestId('sd-next-send')).toHaveText(/^Next send .+, 08:00 \(.+\)$/)
    await drawer.getByLabel('Name').fill(NAME)
    await shots(page, 'reports-schedule-drawer')

    // Time zone: a searchable list with the offset now.
    const zone = drawer.getByRole('combobox', { name: 'Time zone' })
    await expect(zone).toHaveValue(/UTC/)
    await zone.click()
    await zone.fill('london')
    await expect(drawer.getByRole('option', { name: /Europe\/London/ })).toBeVisible()
    await shots(page, 'reports-tz', drawer.getByRole('option', { name: /Europe\/London/ }))
    await page.keyboard.press('Enter')
    await expect(zone).toHaveValue(/^Europe\/London · UTC/)
    await expect(drawer).toBeVisible()
    await expect(drawer.getByTestId('sd-next-send')).toContainText('(Europe/London)')

    // Recipients: a pasted list becomes chips; a bad address is marked and blocks Save.
    const recipients = drawer.getByLabel('Recipients')
    await recipients.focus()
    await page.evaluate(() => {
      const input = document.activeElement as HTMLInputElement
      const data = new DataTransfer()
      data.setData('text', 'ana@example.com\nbob@example.com; not-an-address')
      input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }))
    })
    await expect(drawer.locator('[data-invalid="true"]')).toHaveCount(1)
    await expect(drawer.getByText(/1 address is not valid: not-an-address/)).toBeVisible()
    await expect(drawer.getByRole('button', { name: 'Save schedule' })).toBeDisabled()
    await shots(page, 'reports-recipients')
    await drawer.getByRole('button', { name: 'Remove not-an-address' }).click()

    // Sections are picked right in the form, with Export's list.
    const sections = drawer.getByTestId('sd-sections')
    await sections.scrollIntoViewIfNeeded()
    await expect(sections.getByRole('checkbox').first()).toBeVisible()
    await shots(page, 'reports-schedule-sections')

    await drawer.getByRole('button', { name: 'Save schedule' }).click()
    await expect(drawer).toHaveCount(0)
    await expect(screen.getByRole('button', { name: `${NAME}: open details` })).toBeVisible()
    const listed = await page.evaluate(async () => {
      const api = (
        window as unknown as {
          citefox: {
            'reports:list': () => Promise<{ id: string; timeZone: string; recipients: string[] }[]>
          }
        }
      ).citefox
      return api['reports:list']()
    })
    expect(listed[0]).toMatchObject({
      timeZone: 'Europe/London',
      recipients: ['ana@example.com', 'bob@example.com']
    })
    const id = listed[0]?.id ?? ''

    // Send now asks first and lists who gets it.
    await chooseRowAction(page, screen, NAME, 'Send now')
    const confirm = page.getByRole('alertdialog', { name: `Send ${NAME} now?` })
    await expect(confirm).toBeVisible()
    await expect(confirm.getByText('ana@example.com')).toBeVisible()
    await expect(confirm.getByText('bob@example.com')).toBeVisible()
    await shots(page, 'reports-sendnow-confirm')
    await confirm.getByRole('button', { name: 'Send now' }).click()
    await expect(confirm).toHaveCount(0)
    await expect(screen.getByTestId('rpt-sendnow-note')).toHaveText(/^(Sent to|Not sent|Waiting)/)
    await screen.getByRole('tab', { name: /^Delivery history/ }).click()
    await expect(
      screen.getByRole('grid', { name: 'Delivery history' }).getByText('Sent now').first()
    ).toBeVisible()

    // Details open from a link and after a reload; Duplicate opens a copy in edit.
    await openHash(page, `#/reports?drawer=schedule&schedule.id=${id}`)
    await page.reload()
    const detail = scheduleDrawer(page, NAME)
    await expect(detail).toBeVisible()
    await expect(detail.getByTestId('sd-send-now')).toBeVisible()
    await detail.getByRole('button', { name: 'Duplicate' }).first().click()
    const copy = scheduleDrawer(page, 'Duplicate schedule')
    await expect(copy).toBeVisible()
    await expect(copy.getByLabel('Name')).toHaveValue(`Copy of ${NAME}`)
    expect(page.url()).toContain(`schedule.from=${id}`)
    await page.goBack()
    await expect(copy).toHaveCount(0)

    // The email preview stays light in the dark theme.
    await openHash(page, '#/reports?drawer=schedule&schedule.id=new')
    const dark = scheduleDrawer(page, 'New schedule')
    await expect(dark).toBeVisible()
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark'
    })
    await animationsDone(page)
    expect(await backgroundLevel(dark.locator('.rpt-mail'))).toBeGreaterThan(200)
    expect(await backgroundLevel(dark)).toBeLessThan(100)
    // Its text is dark on that light card, so it reads.
    expect(await backgroundLevel(dark.locator('.rpt-mail-subject'), 'color')).toBeLessThan(100)
    expect(await backgroundLevel(dark.locator('.rpt-mail-body p').first(), 'color')).toBeLessThan(
      100
    )
    await page.screenshot({ path: await e2eArtifact('reports-schedule-drawer-dark-1440.png') })
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light'
    })
    await page.keyboard.press('Escape')
    await expect(dark).toHaveCount(0)

    // All sends: every automatic send in one list, on the URL.
    await openHash(page, '#/reports?view=sends')
    const sends = page.getByRole('grid', { name: 'All sends' })
    await expect(sends).toBeVisible()
    await expect(sends.getByText(NAME)).toBeVisible()
    await expect(sends.getByText('Email after each check')).toBeVisible()
    await expect(sends.getByText('Automatic export')).toBeVisible()
    await page.reload()
    await expect(page.getByRole('tab', { name: /^All sends/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(page.getByRole('grid', { name: 'All sends' })).toBeVisible()
    await shots(page, 'reports-sends')

    // Export: the scope chooser replaces the page select.
    await openHash(page, '#/export')
    const xpt = page.locator('.xpt')
    await expect(xpt.getByRole('heading', { level: 1, name: 'Export a report' })).toBeVisible()
    await expect(xpt.getByTestId('xpt-elsewhere')).toContainText('Reports')
    await expect(xpt.getByRole('radio', { name: /^This page/ })).toBeChecked()
    await expect(xpt.getByTestId('xpt-page-picker')).toBeVisible()
    await shots(page, 'reports-export-scope')
  } finally {
    await close()
  }
})

test('Export at 2,014 pages: pick pages, keep them on the URL, and Schedule this', async () => {
  test.setTimeout(300_000)
  const { page, close } = await openSeeded('scale')
  try {
    await openHash(page, '#/export')
    const xpt = page.locator('.xpt')
    await expect(xpt.getByRole('heading', { level: 1, name: 'Export a report' })).toBeVisible()
    await xpt.getByRole('radio', { name: /Pages I pick/ }).check({ force: true })
    const picker = xpt.getByTestId('xpt-scope-chooser-picker')
    await expect(picker.getByText(/0 picked · 2,014 pages in all/)).toBeVisible()
    await picker.getByRole('searchbox').fill('text alerts')
    const first = picker.getByRole('checkbox').first()
    await first.check()
    await picker.getByRole('checkbox').nth(1).check()
    await expect(xpt.getByTestId('xpt-scope-count')).toHaveText('2 pages in this export.')
    expect(page.url()).toContain('scope=pages')
    expect(page.url()).toMatch(/ids=[^&]+%2C|ids=[^&]+,/)
    await shots(page, 'reports-export-scale')

    // A copied link (here: a reload) opens the same export.
    await page.reload()
    const again = page.locator('.xpt')
    await expect(again.getByRole('radio', { name: /Pages I pick/ })).toBeChecked()
    await expect(again.getByTestId('xpt-scope-count')).toHaveText('2 pages in this export.')

    // Schedule this: the schedule drawer opens with the same pages.
    await again.getByRole('button', { name: 'More actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Schedule this' }).click()
    const drawer = scheduleDrawer(page, 'New schedule')
    await expect(drawer).toBeVisible()
    expect(page.url()).toContain('schedule.scope=pages')
    await expect(drawer.getByRole('radio', { name: /Pages I pick/ })).toBeChecked()
    await expect(drawer.getByText(/2 picked/)).toBeVisible()
  } finally {
    await close()
  }
})
