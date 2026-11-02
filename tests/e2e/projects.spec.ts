import AxeBuilder from '@axe-core/playwright'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import Database from 'better-sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { openAdd, openAllPages, sidebarLink } from './nav-helpers'

async function launchMock(): Promise<{ app: ElectronApplication; page: Page; dir: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-projects-'))
  const seeded = await launchCiteFox({ userDataDir: dir, viewport: { width: 1280, height: 820 } })
  try {
    await seeded.page.evaluate(() => {
      localStorage.setItem('citefox.client', 'mock')
      localStorage.setItem('citefox.mock.catalog', 'textbolt')
      localStorage.setItem('citefox.mock.pace', '0')
    })
  } finally {
    await seeded.app.close()
  }
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1280, height: 820 }
  })
  await openAllPages(page)
  return { app, page, dir }
}

async function closeApp(app: ElectronApplication, dir: string): Promise<void> {
  await app.close()
  await rm(dir, { recursive: true, force: true })
}

async function expectSearchMeter(
  bar: Locator,
  used: number,
  cap: number,
  height: number
): Promise<void> {
  const metrics = await bar.evaluate((element) => {
    const track = element.getBoundingClientRect()
    const fill = element
      .querySelector(':scope > [data-part="fill"], :scope > span')
      ?.getBoundingClientRect()
    return {
      height: track.height,
      track: track.width,
      fill: fill?.width ?? 0,
      fillHeight: fill?.height ?? 0
    }
  })
  expect(Math.abs(metrics.height - height)).toBeLessThan(0.6)
  expect(Math.abs(metrics.fillHeight - height)).toBeLessThan(0.6)
  expect(metrics.track).toBeGreaterThan(height * 4)
  const expected = Math.round((used / cap) * 100) / 100
  expect(Math.abs(metrics.fill / metrics.track - expected)).toBeLessThan(0.02)
}

/** One project's row in the Projects list grid, found by its name link. */
function projectRow(list: Locator, name: string): Locator {
  return list
    .getByRole('row')
    .filter({ has: list.page().getByRole('link', { name: `Open ${name}` }) })
}

/** The paused FieldPro row: score meter, change, searches meter, market, status and row menu. */
async function expectPausedRow(row: Locator): Promise<void> {
  const meter = row.getByRole('meter', { name: 'Average score 35 of 100' })
  await expect(meter).toBeVisible()
  await expect(meter).toHaveAttribute('aria-valuenow', '35')
  await expect(row.getByText('−2 since the last check')).toBeVisible()
  await expect(row.getByText('18 of 500')).toBeVisible()
  await expect(row.getByText('🇨🇦 CA · EN')).toBeVisible()
  await expect(row.locator('.ui-chip', { hasText: 'Paused' })).toBeVisible()
  await expectSearchMeter(row.locator('.pj-searches .bar'), 18, 500, 4)
  const page = row.page()
  await row.getByRole('button', { name: 'Actions for FieldPro HVAC' }).click()
  await expect(page.getByRole('menuitem', { name: 'Resume' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menuitem', { name: 'Resume' })).toHaveCount(0)
}

async function expectSidebarFillsViewport(page: Page): Promise<void> {
  const box = await page.getByRole('navigation', { name: 'CiteFox' }).boundingBox()
  const viewport = page.viewportSize()
  expect(box).not.toBeNull()
  expect(viewport).not.toBeNull()
  if (!box || !viewport) return
  expect(Math.abs(box.height - viewport.height)).toBeLessThan(2)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeLessThan(2)
}

async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .setLegacyMode()
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(results.violations).toEqual([])
}

test('projects, page views, search, pin, and add page', async () => {
  const { app, page, dir } = await launchMock()
  try {
    await expect(page.getByText(/^Showing 25 of 186 pages/)).toBeVisible()
    await expect(page.getByText('186 tracked · 1,828 found, not tracked')).toBeVisible()
    await expect(page.getByText('Not running in the tray')).toBeVisible()
    await expect(page.getByText('14 pages due today')).toBeVisible()
    const summary = page.getByRole('region', { name: 'Summary' })
    await expect(summary.getByText('1,240', { exact: true })).toBeVisible()
    await expect(summary.getByText('of 3,000', { exact: true })).toBeVisible()
    await expect(summary.getByText(/14\s*pages/)).toBeVisible()
    await expectSearchMeter(summary.locator('.ui-goal-track'), 1240, 3000, 8)
    await summary.screenshot({ path: await e2eArtifact('after-pages-tiles-1280.png') })
    await page.setViewportSize({ width: 1024, height: 700 })
    await expectSearchMeter(summary.locator('.ui-goal-track'), 1240, 3000, 8)
    await summary.screenshot({ path: await e2eArtifact('after-pages-tiles-1024.png') })
    await page.setViewportSize({ width: 1280, height: 820 })
    await expectAccessible(page)
    await page.screenshot({ path: await e2eArtifact('pages-grid-1280x820.png') })

    const grid = page.getByRole('grid', { name: 'Pages' })
    await grid.focus()
    await page.keyboard.press('ArrowDown')
    await expect(grid.locator('[data-line="0"]')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(grid.locator('[data-line="1"]')).toBeFocused()

    const nav = page.getByRole('navigation', { name: 'CiteFox' })
    const pagesSearch = page.getByRole('searchbox', { name: 'Search pages by title or URL' })
    await pagesSearch.fill('Text alerts for business')
    const actions = grid.getByRole('button', { name: 'Actions for Text alerts for business' })
    await actions.first().click()
    await page.getByRole('menuitem', { name: 'Unpin Text alerts for business' }).click()
    await expect(nav.getByRole('link', { name: 'Text alerts for business' })).toHaveCount(0)
    await actions.first().click()
    await page.getByRole('menuitem', { name: 'Pin Text alerts for business' }).click()
    await expect(nav.getByRole('link', { name: 'Text alerts for business' })).toBeVisible()
    await pagesSearch.fill('')

    const search = page.getByRole('banner').getByRole('combobox', {
      name: 'Find anything: screens, settings, reports, help, actions, pages, topics and questions',
      exact: true
    })
    await search.fill('opt-in')
    const results = page.getByRole('group', { name: 'Pages' })
    await expect(results.getByRole('option', { name: 'SMS opt-in rules' })).toBeVisible()
    await search.fill('')

    await page.getByRole('button', { name: /Switch project/ }).click()
    await expect(
      page.getByRole('group', { name: 'Projects' }).locator('.pm-head .mono')
    ).toHaveText('3')
    await page.getByRole('link', { name: 'All projects' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible()
    await expect(page.getByText('2 active · 1 paused').first()).toBeVisible()
    const glance = page.getByRole('region', { name: 'All projects at a glance' })
    await expect(glance.getByText('240', { exact: true })).toBeVisible()
    await expect(glance.getByText('of 2,489 found')).toBeVisible()
    await expect(
      glance.getByText(/1,258 used by CiteFox · caps total 5,250 on shared keys/)
    ).toBeVisible()
    await expect(glance.getByText(/312 of 1,000 on Acme's own key/)).toBeVisible()
    // The time follows the computer's clock: "9:00 AM" on a 12-hour Mac, "9:00" or "09:00" on a 24-hour one.
    await expect(glance.getByText(/^Today 0?9:00(\s?AM)? · TextBolt$/)).toBeVisible()
    await expect(glance.getByText('14 pages due')).toBeVisible()
    const stacked = await glance.evaluate((region) => {
      const count = region.querySelector('.glance-count')?.getBoundingClientRect()
      const sub = region.querySelector('.stat-sub')?.getBoundingClientRect()
      if (!count || !sub) return null
      return { countBottom: count.bottom, subTop: sub.top }
    })
    expect(stacked).not.toBeNull()
    expect(stacked?.subTop).toBeGreaterThanOrEqual((stacked?.countBottom ?? 0) - 1)
    await expectSearchMeter(glance.locator('.bar'), 1258, 5250, 8)
    await glance.screenshot({ path: await e2eArtifact('after-projects-glance-1280.png') })
    const list = page.getByRole('grid', { name: 'Projects' })
    const fieldpro = projectRow(list, 'FieldPro HVAC')
    await expect(fieldpro.getByText('35', { exact: true })).toBeVisible()
    await expectPausedRow(fieldpro)
    await expect(
      projectRow(list, 'FieldPro HVAC').getByRole('link', { name: 'Open FieldPro HVAC' })
    ).toHaveAttribute('title', 'FieldPro HVAC')
    const textbolt = projectRow(list, 'TextBolt')
    await expect(textbolt.getByText('41', { exact: true })).toBeVisible()
    await expect(textbolt.getByText('+6 since the last check')).toBeVisible()
    await expect(textbolt.getByText('1,240 of 3,000')).toBeVisible()
    await list.screenshot({ path: await e2eArtifact('after-projects-list-1280.png') })
    // At 1134 px every column fits: the grid (its own scroller) has no sideways scroll.
    await page.setViewportSize({ width: 1134, height: 770 })
    await expect
      .poll(() => list.evaluate((grid) => grid.scrollWidth <= grid.clientWidth + 1))
      .toBe(true)
    await expect(list.getByRole('columnheader', { name: /Status/ })).toBeInViewport()
    await list.screenshot({ path: await e2eArtifact('after-projects-list-1134.png') })
    await page.setViewportSize({ width: 1280, height: 820 })
    await expectSidebarFillsViewport(page)
    await page.locator('#main').evaluate((node) => {
      node.scrollTop = node.scrollHeight
    })
    await expectSidebarFillsViewport(page)
    await page.setViewportSize({ width: 1024, height: 700 })
    await glance.scrollIntoViewIfNeeded()
    await expectSearchMeter(glance.locator('.bar'), 1258, 5250, 8)
    await glance.screenshot({ path: await e2eArtifact('after-projects-glance-1024.png') })
    await fieldpro.scrollIntoViewIfNeeded()
    await expectPausedRow(fieldpro)
    await list.screenshot({ path: await e2eArtifact('after-projects-list-1024.png') })
    await expectSidebarFillsViewport(page)
    await page.setViewportSize({ width: 1280, height: 820 })
    await page.getByRole('tab', { name: 'Usage by project' }).click()
    const usage = page.getByRole('grid', { name: 'Usage by project this month' })
    await expect(usage.getByRole('link', { name: 'Open FieldPro HVAC' })).toBeVisible()
    await expect(page.getByText(/^All projects:/)).toBeVisible()
    await expectAccessible(page)
    await page.screenshot({ path: await e2eArtifact('projects-usage-1280x820.png') })
    await page.getByRole('tab', { name: /^Projects/ }).click()
    await expectAccessible(page)
    await page.screenshot({ path: await e2eArtifact('projects-1280x820.png') })

    await page.getByRole('button', { name: /Switch project/ }).click()
    await page
      .getByRole('group', { name: 'Projects' })
      .getByRole('link', { name: 'New project' })
      .click()
    await expect(page.getByRole('heading', { level: 1, name: 'New project' })).toBeVisible()
    await page.getByLabel('Project name').fill('Northwind')
    await page.getByLabel('Website domain').fill('northwind.example')
    await page.getByLabel('Brand names').fill('Northwind')
    await page.getByRole('button', { name: 'Create project' }).click()
    await expect(page.getByText('Northwind is ready.')).toBeVisible()
    // Create opens the new project's start screen (an empty project's landing comes back
    // here too), so go on to the Projects screen in the app.
    await expect(
      page.getByRole('heading', { level: 1, name: 'How do you want to start?' })
    ).toBeVisible()
    await page.evaluate(() => {
      window.location.hash = '#/projects'
    })
    await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Switch project, Northwind/ })).toBeVisible()

    await openAdd(page, 'Topic')
    await expect(
      page.getByRole('heading', { level: 1, name: 'What do you want to track?' })
    ).toBeVisible()
    await page.getByRole('radio', { name: /A page URL/ }).check()
    await page.getByRole('button', { name: 'Open Add a page' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Add a page to track' })).toBeVisible()
    await expect(page.getByText('Reading the page is free.')).toBeVisible()
    await expectAccessible(page)
    await page.screenshot({ path: await e2eArtifact('add-page-1280x820.png') })
    await page.getByLabel('Page URL').fill('https://northwind.example/welcome')
    await page.getByRole('button', { name: 'Add page' }).click()
    // Owner feedback 5: the new page opens on its Prompts tab, setting itself up.
    await expect(page).toHaveURL(/\/prompts$/)
    await expect(page.getByRole('region', { name: 'Setting up this page' })).toBeVisible()
    // The page header shows the URL with copy and open (ui UrlText).
    const header = page.locator('#main header.ui-head')
    await expect(header.getByText('northwind.example/welcome', { exact: true })).toBeVisible()
    await expect(
      header.getByRole('link', { name: 'Open northwind.example/welcome in a new tab' })
    ).toHaveAttribute('href', /^https:\/\/northwind\.example\/welcome/)

    await page.setViewportSize({ width: 1024, height: 700 })
    // At 1024 the sidebar turns into the icon rail, which shows every item.
    await expect(page.getByRole('navigation', { name: 'CiteFox' })).toHaveAttribute(
      'data-collapsed',
      'true'
    )
    await (await sidebarLink(page, 'Your site', /^Pages/)).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Northwind' })).toBeVisible()
    await page.screenshot({ path: await e2eArtifact('pages-1024x700.png') })
  } finally {
    await closeApp(app, dir)
  }
})

test('an ipc shell with no project shows an empty state', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-gap-'))
  const seeded = await launchCiteFox({ userDataDir: dir, viewport: { width: 1280, height: 820 } })
  try {
    await expect(
      seeded.page.getByRole('heading', { level: 1, name: /See whether Google/ })
    ).toBeVisible()
  } finally {
    await seeded.app.close()
  }
  const db = new Database(path.join(dir, 'app.sqlite'))
  db.prepare('UPDATE app_state SET onboarding_finished = 1 WHERE id = 1').run()
  db.close()
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1280, height: 820 }
  })
  try {
    await expect(page.getByRole('heading', { level: 1, name: 'Summary' })).toBeVisible()
    await expect(
      page.locator('#main').getByText(/Create a project to start tracking its pages\./)
    ).toBeVisible()
    // The sidebar foot stays quiet with no project: the screen already says what to do.
    await expect(page.locator('.side-foot')).toHaveCount(0)
    await expectAccessible(page)
    await page.screenshot({ path: await e2eArtifact('pages-empty-1280x820.png') })
  } finally {
    await closeApp(app, dir)
  }
})

test('the switcher keeps the project chosen with projects:switch', async () => {
  const { app, page, dir } = await launchMock()
  try {
    await page.getByRole('button', { name: /Switch project, TextBolt/ }).click()
    await page
      .getByRole('group', { name: 'Projects' })
      .getByRole('button', { name: /Acme Clinics/ })
      .click()
    await expect(page.getByRole('heading', { level: 1, name: 'Pages' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Switch project, Acme Clinics/ })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: /Switch project, Acme Clinics/ })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'Pages' })).toBeVisible()
  } finally {
    await closeApp(app, dir)
  }
})

test('check now starts, waits on a second pass, and still runs for a paused project', async () => {
  const { app, page, dir } = await launchMock()
  try {
    await page.evaluate(() => {
      window.location.hash = '#/check'
    })
    await expect(page.getByRole('heading', { level: 1, name: 'Check now' })).toBeVisible()
    await page.getByRole('button', { name: 'Check due pages now' }).click()
    await expect(page.getByText('Check started for 14 pages.')).toBeVisible()
    await page.getByRole('button', { name: 'Check due pages now' }).click()
    await expect(page.getByText("Today's check already ran.")).toBeVisible()

    await page.getByRole('button', { name: /Switch project, TextBolt/ }).click()
    await page
      .getByRole('group', { name: 'Projects' })
      .getByRole('button', { name: /FieldPro HVAC/ })
      .click()
    await page.evaluate(() => {
      window.location.hash = '#/check'
    })
    await expect(page.getByText('This project is paused. Check now still runs.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Check due pages now' })).toBeEnabled()
    await expect(page.getByText('Paused', { exact: true })).toBeVisible()
  } finally {
    await closeApp(app, dir)
  }
})

test('check now waits while the whole queue is paused', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-queue-'))
  const seeded = await launchCiteFox({ userDataDir: dir, viewport: { width: 1280, height: 820 } })
  try {
    await seeded.page.evaluate(() => {
      localStorage.setItem('citefox.client', 'mock')
      localStorage.setItem('citefox.mock.catalog', 'textbolt')
      localStorage.setItem('citefox.mock.pace', '0')
      localStorage.setItem('citefox.mock.queue', 'paused_all')
    })
  } finally {
    await seeded.app.close()
  }
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1280, height: 820 }
  })
  try {
    await openAllPages(page)
    await page.evaluate(() => {
      window.location.hash = '#/check'
    })
    await page.getByRole('button', { name: 'Check due pages now' }).click()
    await expect(page.getByText('Check now waits while checks are paused.')).toBeVisible()
  } finally {
    await closeApp(app, dir)
  }
})
