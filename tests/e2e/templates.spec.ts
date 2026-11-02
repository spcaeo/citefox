import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { launchOnboardedMock } from './onboarded'
import { leaveFirstRun } from './first-run-helpers'
import { GENERATION_TEMPLATE_KINDS, isListedTemplateStep } from '@shared/domain'
import { hubTabs, openAllPages, sidebarLink } from './nav-helpers'

/** Every Claude step the Templates screen lists (Pages, Topics and Reports). */
const STEPS = GENERATION_TEMPLATE_KINDS.filter((kind) => isListedTemplateStep(kind, false)).length

/** The mock build, just onboarded (no setup wizard): TextBolt with no pages yet. */
async function openApp(
  width: number,
  height: number
): Promise<{
  app: ElectronApplication
  page: Page
  dir: string
}> {
  return launchOnboardedMock('templates', { viewport: { width, height } })
}

async function closeApp(app: ElectronApplication, dir: string): Promise<void> {
  await app.close()
  await rm(dir, { recursive: true, force: true })
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: await e2eArtifact(`${name}.png`), fullPage: false })
}

/** Opens a drawer's Expert options (remembered per drawer, so it may be open already). */
async function openExpert(dialog: Locator): Promise<void> {
  const toggle = dialog.getByRole('button', { name: /Expert options/ })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
}

function editor(page: Page): Locator {
  return page.getByRole('region', { name: 'App template editor' })
}

function stepEditor(page: Page): Locator {
  return page.getByRole('region', { name: 'Template editor' })
}

function appList(page: Page): Locator {
  return page.getByRole('grid', { name: 'App templates' })
}

/** One app template's grid row. */
function appRow(page: Page, name: string): Locator {
  return page
    .locator('[role="grid"][aria-label="App templates"] [data-row]')
    .filter({ hasText: name })
}

/** One step's grid row (found even while the Steps tab is hidden). */
/** The row whose step name is exactly `name` ("Buyer profile", not "Topic buyer profile"). */
function stepRow(page: Page, name: string): Locator {
  const exact = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
  return page
    .locator('[role="grid"][aria-label="AI steps"] [data-row]')
    .filter({ has: page.locator('.tpl-grid-label', { hasText: exact }) })
}

function stepRows(page: Page): Locator {
  return page.locator('[role="grid"][aria-label="AI steps"] [data-row]')
}

async function showTab(page: Page, name: RegExp): Promise<void> {
  await page.getByRole('tab', { name }).click()
}

async function openStep(page: Page, name: string): Promise<void> {
  await showTab(page, /^Steps/)
  await stepRow(page, name).locator('.tpl-grid-label').click()
  await expect(page.getByRole('tab', { name: /^Edit · / })).toHaveAttribute('aria-selected', 'true')
}

async function axeViolations(
  app: ElectronApplication,
  page: Page,
  selector: string
): Promise<string[]> {
  const source = readFileSync(path.join(process.cwd(), 'node_modules/axe-core/axe.min.js'), 'utf8')
  await app.evaluate(({ BrowserWindow }, script) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('No window')
    return win.webContents.executeJavaScript(script)
  }, source)
  return page.evaluate(
    async ({ root, tags }) => {
      const axeApi = (
        window as unknown as {
          axe: {
            run: (
              context: string,
              options: { runOnly: { type: 'tag'; values: string[] } }
            ) => Promise<{
              violations: { id: string; help: string; nodes: { target: string[] }[] }[]
            }>
          }
        }
      ).axe
      const result = await axeApi.run(root, { runOnly: { type: 'tag', values: tags } })
      return result.violations.map((violation) => {
        const target = violation.nodes[0]?.target.join(' ') ?? ''
        return `${violation.id}: ${violation.help} (${target})`
      })
    },
    {
      root: selector,
      tags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
    }
  )
}

test('named templates can be created, duplicated, defaulted, deleted, and restored', async () => {
  test.setTimeout(180_000)
  const { app, page, dir } = await openApp(1280, 820)
  try {
    await leaveFirstRun(page)
    // App settings first (Settings in the sidebar, then its App settings tab), then
    // the old App settings › Templates address, which opens the Templates editor (one home).
    await (await sidebarLink(page, 'Setup', 'App settings')).click()
    await expect(page.getByRole('heading', { level: 1, name: 'App settings' })).toBeVisible()
    await page.evaluate(() => {
      window.location.hash = '#/settings?tab=templates'
    })
    await expect(page.getByRole('heading', { level: 1, name: 'Templates' })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: `${STEPS} steps` })).toBeVisible()
    await shot(page, 'templates-steps')
    await showTab(page, /^Edit · /)
    await expect(stepEditor(page).getByText('icp.md')).toBeVisible()
    await expect(stepEditor(page).getByRole('button', { name: 'Reset to default' })).toBeDisabled()
    await showTab(page, /^App templates/)
    await expect(page.getByRole('status').filter({ hasText: /^1 template$/ })).toBeVisible()
    await expect(editor(page).getByRole('button', { name: 'Duplicate to edit' })).toBeVisible()
    await expect(editor(page).getByText('Read-only')).toBeVisible()
    await expect(editor(page).getByLabel('Name')).toHaveCount(0)
    await expect(editor(page).getByText('0 buyer profiles · Not used yet')).toBeVisible()
    await expect(editor(page).getByText('prompt sets')).toHaveCount(0)
    await expect(editor(page).getByRole('button', { name: 'Set as default' })).toHaveCount(0)
    await expect(editor(page).getByText('This template is already the default.')).toHaveCount(0)
    const shippedRow = appRow(page, 'CiteFox default')
    await expect(shippedRow).toContainText('Default')
    await expect(shippedRow).toContainText('—')
    await expect(shippedRow.locator('[title^="v1 · "]')).toHaveText('v1')
    expect(await axeViolations(app, page, '.tpl-page')).toEqual([])
    await shot(page, 'templates-list')
    await appList(page).screenshot({ path: await e2eArtifact('after-template-rows.png') })
    await shot(page, 'templates-shipped')
    await shot(page, 'template-detail')

    await editor(page).getByRole('button', { name: 'Duplicate to edit' }).click()
    await editor(page).getByLabel('Name').fill('Nightly buyer')
    await editor(page).getByLabel('Notes').fill('For the night shift')
    await editor(page).getByRole('button', { name: 'Duplicate', exact: true }).click()
    await expect(editor(page).getByLabel('Name')).toHaveValue('Nightly buyer')
    await editor(page).getByRole('button', { name: 'Edit text', exact: true }).click()
    await editor(page).getByRole('textbox', { name: 'Template text' }).fill('Hello {{ url }}')
    await editor(page).getByRole('button', { name: 'Save', exact: true }).click()
    await expect(editor(page).getByText(/Saved as v2\./)).toBeVisible()
    const nightly = appRow(page, 'Nightly buyer')
    await expect(nightly).toContainText('Edited')
    await expect(nightly.locator('[title^="v2 · "]')).toHaveText('v2')
    await expect(editor(page).getByRole('heading', { name: 'Nightly buyer' })).toBeVisible()
    await expect(editor(page).getByText('0 buyer profiles · Not used yet')).toBeVisible()
    await expect(editor(page).getByText('templateHash')).toHaveCount(0)
    await expect(editor(page).getByText(/templateUpdatedAt/)).toHaveCount(0)
    await shot(page, 'templates-edit')

    await editor(page).getByLabel('Name').fill('   ')
    await editor(page).getByRole('button', { name: 'Save', exact: true }).click()
    await expect(editor(page).getByRole('alert')).toHaveText(
      'A template name must be 1 to 80 characters.'
    )
    await editor(page).getByLabel('Name').fill('Nightly buyer')
    await editor(page).getByRole('button', { name: 'Save', exact: true }).click()

    await page.getByRole('button', { name: 'New template' }).click()
    await editor(page).getByLabel('Name').fill('Field notes')
    await editor(page).getByRole('button', { name: 'Create', exact: true }).click()
    await expect(editor(page).getByLabel('Name')).toHaveValue('Field notes')
    await editor(page).getByRole('button', { name: 'Template actions' }).click()
    await editor(page).getByRole('menuitem', { name: 'Set as default' }).click()
    // The default can't be deleted and is already the default: nothing is left under ⋯.
    await expect(editor(page).getByRole('button', { name: 'Template actions' })).toHaveCount(0)
    await expect(editor(page).getByText('This template is already the default.')).toHaveCount(0)
    await expect(
      editor(page).getByText('Set another template as the default before deleting this one.')
    ).toBeVisible()
    await expect(stepRow(page, 'Buyer profile')).toContainText('Edited')

    await appRow(page, 'CiteFox default').locator('.tpl-grid-label').click()
    await editor(page).getByRole('button', { name: 'Template actions' }).click()
    await editor(page).getByRole('menuitem', { name: 'Set as default' }).click()
    await expect(stepRow(page, 'Buyer profile')).toContainText('Default')
    await appRow(page, 'Field notes').locator('.tpl-grid-label').click()
    await editor(page).getByRole('button', { name: 'Template actions' }).click()
    await editor(page).getByRole('menuitem', { name: 'Delete' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Delete this template?' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByRole('button', { name: 'Deleted (1)' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    await expect(page.getByText('Deleted. Restore it from the deleted list.')).toHaveCount(0)
    await expect(editor(page).getByRole('heading', { name: 'CiteFox default' })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: '1 deleted template' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Restore Field notes' })).toBeVisible()
    await page.getByRole('button', { name: 'Preview Field notes' }).click()
    await expect(page.getByRole('button', { name: 'Hide Field notes' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    await expect(page.getByRole('region', { name: 'Field notes', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Restore Field notes' }).scrollIntoViewIfNeeded()
    await shot(page, 'templates-deleted')
    await page.getByRole('button', { name: 'Restore Field notes' }).click()
    await expect(appRow(page, 'Field notes')).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: '3 templates' })).toBeVisible()
    await shot(page, 'templates-restored')

    await page.evaluate(() => {
      window.location.hash = '#/playground'
    })
    await expect(page.getByRole('heading', { level: 1, name: 'Playground' })).toBeVisible()
    await page.getByRole('radio', { name: 'Compare' }).check()
    await page.getByRole('button', { name: 'Compare', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText('Pick 1 to 3 templates of one kind.')
    const compare = page.getByRole('group', { name: 'Templates to compare' })
    await compare.getByRole('checkbox', { name: 'CiteFox default', exact: true }).check()
    await compare.getByRole('checkbox', { name: 'Nightly buyer' }).check()
    await compare.getByRole('checkbox', { name: 'Field notes' }).check()
    await expect(page.getByRole('status').filter({ hasText: '3 of 3 selected' })).toBeVisible()
    await page
      .getByLabel('URL')
      .fill('https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/')
    await page.getByRole('button', { name: 'Compare', exact: true }).click()
    const columns = page.locator('.pg-compare')
    await expect(columns.getByRole('heading', { name: 'CiteFox default' })).toBeVisible()
    await expect(columns.getByRole('heading', { name: 'Nightly buyer' })).toBeVisible()
    await expect(columns.getByRole('heading', { name: 'Field notes' })).toBeVisible()
    for (const name of ['CiteFox default', 'Nightly buyer', 'Field notes']) {
      const card = page.locator('.pg-compare-card', {
        has: page.getByRole('heading', { level: 2, name, exact: true })
      })
      await expect(card).toHaveCount(1)
      await expect(card.locator('h2')).toHaveText(name)
      await expect(card.locator('.pg-prose').first()).toContainText(`Wording from ${name}.`)
    }
    expect(await axeViolations(app, page, '.pg-page')).toEqual([])
    await columns.scrollIntoViewIfNeeded()
    await shot(page, 'compare-3')
    const wideTracks = await columns.evaluate((node) => getComputedStyle(node).gridTemplateColumns)
    expect(wideTracks.trim().split(/\s+/)).toHaveLength(3)
    await page.setViewportSize({ width: 1024, height: 820 })
    const stackedTracks = await columns.evaluate(
      (node) => getComputedStyle(node).gridTemplateColumns
    )
    expect(stackedTracks.trim().split(/\s+/)).toHaveLength(1)
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    const sidebar = page.getByRole('navigation', { name: 'CiteFox' })
    const sidebarBox = await sidebar.boundingBox()
    expect(sidebarBox).not.toBeNull()
    expect(sidebarBox?.y).toBeGreaterThanOrEqual(0)
    expect(sidebarBox?.y).toBeLessThan(120)
    // The icon rail scrolls on its own; the open screen's item (Settings) stays in view.
    await expect(sidebar.getByRole('link', { name: 'Settings', exact: true })).toBeInViewport()
    await shot(page, 'compare-1024')
    await shot(page, 'sidebar-1024-after')
  } finally {
    await closeApp(app, dir)
  }
})

test('step search and status filters stay on the loaded list', async () => {
  test.setTimeout(120_000)
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-template-filter-'))
  const viewport = { width: 1280, height: 900 }
  const seeded = await launchCiteFox({ userDataDir: dir, viewport })
  try {
    await seeded.page.evaluate(() => {
      localStorage.setItem('citefox.client', 'mock')
      localStorage.setItem('citefox.mock.catalog', 'textbolt')
      localStorage.setItem('citefox.mock.pace', '0')
    })
  } finally {
    await seeded.app.close()
  }
  const { app, page } = await launchCiteFox({ userDataDir: dir, viewport })
  try {
    await openAllPages(page)
    await page.evaluate(() => {
      window.location.hash = '#/templates'
    })
    await expect(page.getByRole('heading', { level: 1, name: 'Templates' })).toBeVisible()
    const search = page.getByRole('searchbox', { name: 'Search steps' })
    await expect(search).toBeVisible()
    const statusFilter = page.getByRole('group', { name: 'Status' })
    await expect(statusFilter.getByRole('button', { name: /^Default/ })).toBeVisible()
    await expect(statusFilter.getByRole('button', { name: /^Edited/ })).toBeVisible()
    await expect(statusFilter.getByRole('button', { name: /^Overridden/ })).toBeVisible()
    await page
      .getByRole('region', { name: 'AI steps' })
      .screenshot({ path: await e2eArtifact('after-templates-search.png') })
    await showTab(page, /^Edit · /)
    await expect(stepEditor(page).getByLabel('Model')).toBeVisible()
    await expect(stepEditor(page).getByLabel('Output language')).toBeVisible()
    await expect(
      stepEditor(page).getByRole('button', { name: 'AI actions for this template' })
    ).toBeVisible()

    await openStep(page, 'Buyer questions')
    await stepEditor(page).getByRole('button', { name: 'Edit', exact: true }).click()
    await stepEditor(page)
      .getByRole('textbox', { name: 'Template' })
      .fill('Write {{ prompt_count }} long situational buyer questions.')
    await stepEditor(page).getByRole('button', { name: 'Save', exact: true }).click()
    await expect(stepEditor(page).getByText(/Saved as v1 · hash/)).toBeVisible()
    await expect(stepRow(page, 'Buyer questions')).toContainText('Overridden for this project')

    await showTab(page, /^Steps/)
    await search.fill('coverage')
    await expect(stepRow(page, 'Coverage matrix')).toBeVisible()
    await expect(stepRow(page, 'Coverage fixes')).toBeVisible()
    await expect(stepRow(page, 'Buyer questions')).toHaveCount(0)
    await expect(
      page.getByRole('status').filter({ hasText: `Showing 2 of ${STEPS} steps` })
    ).toBeVisible()
    await statusFilter.getByRole('button', { name: /^Overridden/ }).click()
    await expect(page.getByText('No steps match “coverage”')).toBeVisible()
    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect(search).toHaveValue('')
    await expect(stepRows(page)).toHaveCount(STEPS)

    await statusFilter.getByRole('button', { name: /^Overridden/ }).click()
    await expect(stepRow(page, 'Buyer questions')).toBeVisible()
    await expect(stepRow(page, 'Coverage matrix')).toHaveCount(0)
    await expect(
      page.getByRole('status').filter({ hasText: `Showing 1 of ${STEPS} steps` })
    ).toBeVisible()
    await page
      .getByRole('region', { name: 'AI steps' })
      .screenshot({ path: await e2eArtifact('after-templates-filtered.png') })
    await statusFilter.getByRole('button', { name: /^All/ }).click()
    await expect(statusFilter.getByRole('button', { name: /^Overridden/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    await expect(
      page.getByRole('status').filter({ hasText: new RegExp(`^${STEPS} steps$`) })
    ).toBeVisible()
    expect(await axeViolations(app, page, '.tpl-page')).toEqual([])
  } finally {
    await closeApp(app, dir)
  }
})

test('the per-run picker leaves the default unset and names a picked template', async () => {
  test.setTimeout(120_000)
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-picker-'))
  const viewport = { width: 1280, height: 820 }
  const seeded = await launchCiteFox({ userDataDir: dir, viewport })
  try {
    await seeded.page.evaluate(() => {
      localStorage.setItem('citefox.client', 'mock')
      localStorage.setItem('citefox.mock.catalog', 'textbolt')
      localStorage.setItem('citefox.mock.pace', '0')
    })
  } finally {
    await seeded.app.close()
  }
  const { app, page } = await launchCiteFox({ userDataDir: dir, viewport })
  try {
    await openAllPages(page)
    await page.evaluate(() => {
      window.location.hash = '#/templates'
    })
    await expect(page.getByRole('heading', { level: 1, name: 'Templates' })).toBeVisible()
    await showTab(page, /^App templates/)
    await editor(page).getByRole('button', { name: 'Duplicate to edit' }).click()
    await editor(page).getByLabel('Name').fill('Field buyer')
    await editor(page).getByRole('button', { name: 'Duplicate', exact: true }).click()
    await expect(editor(page).getByLabel('Name')).toHaveValue('Field buyer')
    await openStep(page, 'Coverage matrix')
    await expect(stepEditor(page).getByRole('heading', { name: 'Coverage matrix' })).toBeVisible()
    await showTab(page, /^App templates/)
    await editor(page).getByRole('button', { name: 'Duplicate to edit' }).click()
    await editor(page).getByLabel('Name').fill('Field gaps')
    await editor(page).getByRole('button', { name: 'Duplicate', exact: true }).click()
    await expect(editor(page).getByLabel('Name')).toHaveValue('Field gaps')

    await page.evaluate(() => {
      window.location.hash = '#/pages/alerts/audience'
    })
    // Owner feedback 5: each tab keeps its template and rerun in a small settings panel.
    await page.getByRole('button', { name: 'Profile settings' }).click()
    const profileSettings = page.getByRole('dialog', { name: 'Profile settings' })
    await openExpert(profileSettings)
    await expect(profileSettings.getByLabel('Template')).toBeVisible()
    await expect(
      profileSettings.getByText('No template picked. The default applies.')
    ).toBeVisible()
    await shot(page, 'run-picker')
    await expect(
      profileSettings.getByRole('link', { name: /^Template: CiteFox default/ })
    ).toBeVisible()
    await profileSettings.getByLabel('Template').selectOption({ label: 'Field buyer' })
    await expect(profileSettings.getByText('This run uses Field buyer.')).toBeVisible()
    await profileSettings.getByRole('button', { name: 'Regenerate' }).click()
    await expect(page.getByRole('link', { name: /^Template: Field buyer/ }).first()).toBeVisible()
    await page.keyboard.press('Escape')

    await page.getByRole('tab', { name: 'Questions', exact: true }).click()
    await page.getByRole('button', { name: 'Question settings' }).click()
    const promptSettings = page.getByRole('dialog', { name: 'Question settings' })
    await openExpert(promptSettings)
    await expect(promptSettings.getByText('No template picked. The default applies.')).toBeVisible()
    await promptSettings.getByRole('button', { name: 'Write the questions again' }).click()
    await expect(promptSettings).toHaveCount(0)
    await expect(
      page
        .getByRole('region', { name: 'About these questions' })
        .getByRole('link', { name: /^Template: CiteFox default/ })
    ).toBeVisible()

    await page.getByRole('tab', { name: 'Content gaps', exact: true }).click()
    await page.getByRole('button', { name: 'Content gaps settings' }).click()
    const gapsSettings = page.getByRole('dialog', { name: 'Content gaps settings' })
    await openExpert(gapsSettings)
    await gapsSettings.getByLabel('Template').selectOption({ label: 'Field gaps' })
    await gapsSettings.getByRole('button', { name: 'Write content gaps again' }).click()
    if (!(await gapsSettings.isVisible())) {
      await page.getByRole('button', { name: 'Content gaps settings' }).click()
    }
    await expect(
      page
        .getByRole('dialog', { name: 'Content gaps settings' })
        .getByRole('link', { name: /^Template: Field gaps/ })
    ).toBeVisible()
  } finally {
    await closeApp(app, dir)
  }
})

test('Templates sit under Project settings, and Playground is a Settings tab from the keyboard', async () => {
  test.setTimeout(120_000)
  const { app, page, dir } = await openApp(1280, 820)
  try {
    await leaveFirstRun(page)
    const side = page.getByRole('navigation', { name: 'CiteFox' })
    // App settings is a tab of Settings; Templates have no sidebar item.
    await (await sidebarLink(page, 'Setup', 'App settings')).click()
    await expect(page.getByRole('heading', { level: 1, name: 'App settings' })).toBeVisible()
    await expect(side.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    )
    await expect(side.getByRole('link', { name: 'Templates', exact: true })).toHaveCount(0)
    // Templates have one home: no App settings tab for them any more.
    await expect(page.getByRole('tab', { name: 'Templates', exact: true })).toHaveCount(0)

    await page.evaluate(() => {
      window.location.hash = '#/settings?tab=templates'
    })
    await expect(page.getByRole('heading', { level: 1, name: 'Templates' })).toBeVisible()
    await expect(page).toHaveURL(/#\/templates$/)
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(
      'Project settings'
    )
    const settingsTabs = hubTabs(page, 'Settings')
    await expect(settingsTabs.getByRole('tab', { name: 'Project settings' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(side.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    )
    await page.screenshot({
      path: await e2eArtifact('settings-templates-nav.png'),
      fullPage: true
    })
    expect(await axeViolations(app, page, '.tpl-page')).toEqual([])

    await page.evaluate(() => {
      window.location.hash = '#/templates?view=library'
    })
    await expect(page.getByRole('tab', { name: /^App templates/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(editor(page)).toBeVisible()
    await showTab(page, /^Edit · /)
    await expect(page.getByRole('button', { name: 'Run on sample' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open in the playground' })).toBeVisible()

    // Playground (a dev-build tab) opens from its link, under the Settings tab bar.
    const open = page.getByRole('link', { name: 'Open in the playground' })
    await open.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { level: 1, name: 'Playground' })).toBeVisible()
    await expect(settingsTabs.getByRole('tab', { name: 'Playground' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(side.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(await axeViolations(app, page, '.pg-page')).toEqual([])
  } finally {
    await closeApp(app, dir)
  }
})

test('templates editor fits a 1024 by 700 window', async () => {
  test.setTimeout(120_000)
  const { app, page, dir } = await openApp(1024, 700)
  try {
    await leaveFirstRun(page)
    await page.evaluate(() => {
      window.location.hash = '#/templates'
    })
    await expect(page.getByRole('heading', { level: 1, name: 'Templates' })).toBeVisible()
    await shot(page, 'templates-steps-1024')
    await showTab(page, /^Edit · /)
    await expect(page.getByRole('button', { name: 'Insert {{ url }}' })).toBeVisible()
    await shot(page, 'templates-1024')
  } finally {
    await closeApp(app, dir)
  }
})
