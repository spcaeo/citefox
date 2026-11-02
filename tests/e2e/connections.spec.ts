import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { rm } from 'node:fs/promises'
import { e2eArtifact } from './artifacts'
import { launchOnboardedMock } from './onboarded'
import { leaveFirstRun } from './first-run-helpers'
import { sidebarLink } from './nav-helpers'
import { chooseRowAction } from './row-menu'

const SERP_REPLACEMENT = 'citefox-sample-serpapi-zz99'
const JINA_KEY = 'citefox-sample-jina-a91c'
const YOUTUBE_KEY = 'citefox-sample-youtube-q8m2'

/** The mock build, just onboarded (no setup wizard): TextBolt, a SerpApi key, Claude checked. */
async function openApp(options?: {
  width?: number
  height?: number
}): Promise<{ app: ElectronApplication; page: Page; dir: string }> {
  return launchOnboardedMock('connections', {
    viewport: { width: options?.width ?? 1280, height: options?.height ?? 820 }
  })
}

async function closeApp(app: ElectronApplication, dir: string): Promise<void> {
  await app.close()
  await rm(dir, { recursive: true, force: true })
}

/** The status capsule sits in the v2 top bar. */
function capsule(page: Page): Locator {
  return page.getByRole('banner').locator('.status-pill')
}

/** Opens a Connections tab, such as Claude or Jina Reader. */
async function openTab(page: Page, name: RegExp): Promise<void> {
  await page.getByRole('tab', { name }).click()
}

/** Opens a key's row menu and picks one item. */
async function rowAction(page: Page, scope: Locator, keyName: string, item: string): Promise<void> {
  await chooseRowAction(page, scope, keyName, item)
}

function section(page: Page, heading: string): Locator {
  return page
    .locator('section.conn-section')
    .filter({ has: page.getByRole('heading', { level: 2, name: heading }) })
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.documentElement
    return Math.max(root.scrollWidth, document.body.scrollWidth) - root.clientWidth
  })
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: await e2eArtifact(`${name}.png`),
    fullPage: true
  })
}

test('connections add, test, replace, and turn a key off', async () => {
  const { app, page, dir } = await openApp()
  try {
    await leaveFirstRun(page)
    await (await sidebarLink(page, 'Setup', 'Connections')).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Connections' })).toBeVisible()
    // cloro is the first tab, tagged Recommended, and opens by default.
    await expect(page.getByRole('tab', { name: /^cloro Recommended/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(page.getByRole('heading', { name: 'cloro keys' })).toBeVisible()
    await openTab(page, /^SerpApi/)
    await expect(page).toHaveURL(/#\/connections\?tab=serpapi$/)
    await expect(page.getByRole('heading', { name: 'SerpApi keys' })).toBeVisible()
    await expect(
      page.getByText('SerpApi covers Google AI Overviews only.', { exact: false })
    ).toBeVisible()
    const serpRow = section(page, 'SerpApi keys').getByRole('row').filter({ hasText: '••••b1f4' })
    await expect(serpRow).toContainText('All projects')
    await expect(serpRow).toContainText('of 250')
    await expect(page.getByText('No failovers in the last 24 hours.')).toBeVisible()
    await expect(capsule(page)).toHaveAttribute('aria-label', /^212 searches left this month/)
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1)
    await shot(page, 'connections')

    await openTab(page, /^Jina Reader/)
    const jina = section(page, 'Jina Reader keys')
    await jina.getByLabel('API key', { exact: true }).fill(JINA_KEY)
    // The 3-step key card tests the key, then saves it: one green button.
    await expect(jina.getByRole('list', { name: 'Connect Jina in 3 steps' })).toBeVisible()
    await jina.getByRole('button', { name: 'Test and save' }).click()
    await expect(jina.getByLabel('API key', { exact: true })).toHaveCount(0)
    await expect(
      jina.getByText(/tested and saved\. Key works\. CiteFox will use the higher rate limits\./)
    ).toBeVisible()
    // Keys work and Claude is connected; the keychain access check is the one required
    // step left in What CiteFox needs, and the searches-left button says the same.
    await expect(capsule(page)).toHaveAttribute('data-tip', /· Setup: 1 step left$/)
    await expect(capsule(page)).toHaveAttribute(
      'aria-label',
      /searches left this month · Setup: 1 step left/
    )
    await shot(page, 'capsule-ok')

    await capsule(page).click()
    const dialog = page.getByRole('dialog', { name: 'Credits and connections' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'SerpApi' })).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Claude' })).toBeVisible()
    await expect(
      dialog.getByText("Claude Code doesn't report how much of your plan is left.")
    ).toBeVisible()
    await expect(dialog.getByRole('link', { name: 'All connections' })).toBeVisible()
    await shot(page, 'capsule-popover')
    await page.getByRole('button', { name: 'Close status' }).click()
    await expect(dialog).toHaveCount(0)

    await page.evaluate(() => localStorage.setItem('citefox.mock.scenario', 'serpapi-quota'))
    await openTab(page, /^SerpApi/)
    const serp = section(page, 'SerpApi keys')
    await rowAction(page, serp, 'SerpApi', 'Test key')
    await expect(serp.getByText(/out of searches/)).toBeVisible()
    await expect(
      serp.getByText('The key works. This warning is only that it has no searches left.')
    ).toBeVisible()
    await expect(serp.getByText(/rejected this key/)).toHaveCount(0)
    await expect(capsule(page)).toHaveAttribute('aria-label', /^0 searches left this month/)
    await expect(capsule(page)).toHaveAttribute('aria-label', /1 issue/)
    await expect(capsule(page)).toHaveAttribute('data-tone', 'warn')
    await shot(page, 'capsule-warning')

    await rowAction(page, serp, 'SerpApi', 'Edit key')
    // Replace key sits under the key's ⋯ menu (named after the key).
    await serp.getByRole('button', { name: 'SerpApi actions', exact: true }).click()
    await serp.getByRole('menuitem', { name: 'Replace key' }).click()
    await serp.getByLabel('New SerpApi key').fill(SERP_REPLACEMENT)
    await serp.getByRole('button', { name: 'Save new key' }).click()
    await expect(serp.getByLabel('New SerpApi key')).toHaveCount(0)
    await expect(serp.getByText('Key replaced. Test it to see if it works.')).toBeVisible()
    await expect(serp.getByText(/••••zz99/)).toBeVisible()
    await expect(serp.getByText(SERP_REPLACEMENT)).toHaveCount(0)
    // The open row shows the key's status detail; close it before reading the section status.
    await expect(serp.getByRole('group', { name: 'SerpApi status' })).toBeVisible()
    await serp.getByRole('button', { name: 'Close SerpApi settings' }).click()
    await expect(serp.getByRole('group', { name: 'SerpApi status' })).toHaveCount(0)

    await page.evaluate(() => localStorage.setItem('citefox.mock.scenario', 'serpapi-fail'))
    await rowAction(page, serp, 'SerpApi', 'Test key')
    await expect(serp.getByText(/rejected this key/)).toBeVisible()
    await expect(
      serp.getByText('The key works. This warning is only that it has no searches left.')
    ).toHaveCount(0)

    await serp.getByRole('switch', { name: 'Use SerpApi' }).click()
    await expect(serp.getByRole('switch', { name: 'Use SerpApi' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
    await expect(serp.getByText('Off', { exact: true })).toBeVisible()
    await shot(page, 'capsule-off')

    await openTab(page, /^Claude/)
    await expect(page.getByText('Model · Default (Sonnet)')).toBeVisible()
    const claude = section(page, 'Claude')
    await page.evaluate(() => localStorage.setItem('citefox.mock.scenario', 'success'))
    await claude.getByRole('button', { name: 'Run checkup' }).click()
    await expect(claude.getByText('Claude Code is ready.')).toBeVisible()
    await page.evaluate(() => localStorage.setItem('citefox.mock.scenario', 'checkup-api-key'))
    await claude.getByRole('button', { name: 'Run checkup' }).click()
    await expect(claude.getByText('API key only')).toBeVisible()
    await shot(page, 'connections-claude-tab')

    await openTab(page, /^YouTube/)

    const youtube = section(page, 'YouTube Data API')
    await youtube.getByLabel('API key', { exact: true }).fill(YOUTUBE_KEY)
    await youtube.getByRole('button', { name: 'Add API key' }).click()
    await expect(youtube.getByLabel('API key', { exact: true })).toHaveCount(0)
    await shot(page, 'capsule-youtube')
  } finally {
    await closeApp(app, dir)
  }
})

test('settings edit, save, and validation', async () => {
  const { app, page, dir } = await openApp()
  try {
    await leaveFirstRun(page)
    await (await sidebarLink(page, 'Setup', 'App settings')).click()
    await expect(page.getByRole('heading', { level: 1, name: 'App settings' })).toBeVisible()
    const tab = (name: string): Locator => page.getByRole('tab', { name, exact: true })
    await expect(tab('AI & searches')).toHaveAttribute('aria-selected', 'true')
    // The model, calls at once and the Claude path are folded under More settings.
    await expect(page.getByLabel('Model')).toBeHidden()
    await page.locator('.stg-more > summary', { hasText: 'More settings' }).click()
    await expect(page.getByLabel('Model')).toHaveValue('')
    await expect(page.getByText('Default (Sonnet). Leave this empty to keep it.')).toBeVisible()
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1)
    await shot(page, 'settings')

    await tab('General').click()
    await expect(page.getByLabel('Your name')).toHaveValue('Rakesh')
    await expect(page.getByLabel('Re-check every')).toHaveValue('7')
    await shot(page, 'settings-defaults')
    await page.getByLabel('Your name').fill('Asha')
    await page.getByLabel('Re-check every').selectOption('30')
    await tab('AI & searches').click()
    await page.getByLabel('Model').fill('claude-sonnet-5')
    await page.getByRole('button', { name: 'Save settings' }).click()
    await expect(page.getByText('Settings saved.')).toBeVisible()
    await expect(page.getByLabel('Model')).toHaveValue('claude-sonnet-5')
    await tab('General').click()
    await expect(page.getByLabel('Your name')).toHaveValue('Asha')
    await expect(page.getByLabel('Re-check every')).toHaveValue('30')

    await page.getByLabel('Questions per page').fill('0')
    await page.getByLabel('Samples per question').fill('9')
    await tab('AI & searches').click()
    await page.getByLabel('Model').fill('')
    await page.getByLabel('Monthly search budget').fill('nope')
    await page.getByRole('button', { name: 'Save settings' }).click()
    const budget = page.getByLabel('Monthly search budget')
    await expect(budget).toHaveAttribute('aria-invalid', 'true')
    await expect(page.locator('#budget-error')).toBeVisible()
    await expect(page.getByLabel('Model')).toHaveValue('')
    await tab('General').click()
    const prompts = page.getByLabel('Questions per page')
    await expect(prompts).toHaveAttribute('aria-invalid', 'true')
    await expect(prompts).toHaveAttribute('aria-describedby', 'd-prompts-error')
    await expect(page.locator('#d-prompts-error')).toHaveText(/whole number of questions/)
    const samples = page.getByLabel('Samples per question')
    await expect(samples).toHaveAttribute('aria-invalid', 'true')
    await expect(page.locator('#d-samples-error')).toBeVisible()
    for (const name of ['Email', 'Data & about']) {
      await tab(name).click()
      await shot(page, `settings-${name.toLowerCase().replace(/ /g, '-')}`)
    }
  } finally {
    await closeApp(app, dir)
  }
})

test('keyboard opens the capsule and saves settings', async () => {
  const { app, page, dir } = await openApp({ width: 1024, height: 700 })
  try {
    await leaveFirstRun(page)
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1)
    await page.evaluate(() => {
      const active = document.activeElement
      if (active instanceof HTMLElement) active.blur()
    })
    // Searches left is in the top bar, after the sidebar links.
    for (let step = 0; step < 40; step += 1) {
      await page.keyboard.press('Tab')
      const onStatus = await page.evaluate(
        () => document.activeElement?.classList.contains('status-pill') ?? false
      )
      if (onStatus) break
    }
    await expect(capsule(page)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Credits and connections' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Credits and connections' })).toHaveCount(0)
    await expect(capsule(page)).toBeFocused()

    await (await sidebarLink(page, 'Setup', 'App settings')).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { level: 1, name: 'App settings' })).toBeVisible()
    await page.getByRole('tab', { name: 'General', exact: true }).focus()
    await page.keyboard.press('Enter')
    await page.getByLabel('Your name').focus()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('Mina')
    await page.getByRole('tab', { name: 'AI & searches', exact: true }).focus()
    await page.keyboard.press('Enter')
    await page.locator('.stg-more > summary', { hasText: 'More settings' }).focus()
    await page.keyboard.press('Enter')
    await page.getByLabel('Calls at once').focus()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('0')
    await page.getByRole('button', { name: 'Save settings' }).focus()
    await page.keyboard.press('Enter')
    const calls = page.getByLabel('Calls at once')
    await expect(calls).toHaveAttribute('aria-invalid', 'true')
    await expect(calls).toHaveAttribute('aria-describedby', /concurrency-error/)
    await expect(page.locator('#concurrency-error')).toBeVisible()
    await calls.focus()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('3')
    await page.getByRole('button', { name: 'Save settings' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByText('Settings saved.')).toBeVisible()
    await expect(page.getByLabel('Calls at once')).toHaveValue('3')
    await expect(page.getByLabel('Your name')).toHaveValue('Mina')
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1)
    await shot(page, 'settings-1024')
  } finally {
    await closeApp(app, dir)
  }
})
