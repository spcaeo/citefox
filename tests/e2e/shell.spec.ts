import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { openAdd, openSidebarGroup, type SidebarGroupName } from './nav-helpers'

/** Every sidebar destination, by group, in the owner-approved order (Main.dc.html, Nov 2026). */
const SIDEBAR: readonly {
  group: SidebarGroupName
  name: string | RegExp
  heading: string | RegExp
}[] = [
  { group: 'AI visibility', name: 'Summary', heading: 'Summary' },
  { group: 'AI visibility', name: 'Questions', heading: 'Questions' },
  { group: 'AI visibility', name: /^Topics \d/, heading: 'Topics' },
  { group: 'AI visibility', name: 'Competitors', heading: 'Competitors' },
  { group: 'AI visibility', name: 'Citations', heading: 'Citations' },
  { group: 'AI visibility', name: 'Fixes', heading: 'Fixes' },
  { group: 'Tracking', name: 'Check history', heading: 'Check history' },
  { group: 'Tracking', name: 'Reports', heading: 'Reports' },
  { group: 'Tracking', name: 'Alerts & schedules', heading: 'Alerts & schedules' },
  { group: 'Pinned', name: /Text alerts for business/, heading: /How to Set Up Text Alerts/ },
  { group: 'Pinned', name: /Bulk SMS pricing/, heading: 'Bulk SMS pricing' },
  { group: 'Pinned', name: /SMS opt-in rules/, heading: 'SMS opt-in rules' },
  // One Pages and one Settings item; their screens are tabs (decisions.spec.ts).
  { group: 'Your site', name: /^Pages/, heading: 'Pages' },
  { group: 'Setup', name: 'Settings', heading: 'Project settings' }
]

const TABS = [
  'Results',
  'Progress',
  'Markets',
  'Sentiment',
  'Communities',
  'Content gaps',
  'Questions',
  'Buyer profile',
  'History'
] as const

function nav(page: Page): Locator {
  return page.getByRole('navigation', { name: 'CiteFox' })
}

/** The slim top bar: breadcrumb, search, Activity, searches left, Ask CiteFox and the ⚙ menu. */
function topBar(page: Page): Locator {
  return page.getByRole('banner')
}

/**
 * A sidebar link in the groups (not the + Add menu, whose Questions opens the
 * dialog). Folded groups keep their links in the DOM, hidden.
 */
function item(page: Page, name: string | RegExp): Locator {
  return nav(page)
    .locator('.side-scroll')
    .getByRole('link', {
      name,
      includeHidden: true,
      ...(typeof name === 'string' ? { exact: true } : {})
    })
}

async function goTo(page: Page, entry: (typeof SIDEBAR)[number]): Promise<Locator> {
  await openSidebarGroup(page, entry.group)
  return item(page, entry.name)
}

async function launchShell(): Promise<{
  app: ElectronApplication
  page: Page
  dir: string
}> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-shell-'))
  const seeded = await launchCiteFox({ userDataDir: dir })
  try {
    await seeded.page.evaluate(() => {
      localStorage.setItem('citefox.client', 'mock')
      localStorage.setItem('citefox.mock.catalog', 'textbolt')
      localStorage.setItem('citefox.mock.pace', '0')
    })
  } finally {
    await seeded.app.close()
  }
  const { app, page } = await launchCiteFox({ userDataDir: dir })
  return { app, page, dir }
}

async function closeShell(app: ElectronApplication, dir: string): Promise<void> {
  await app.close()
  await rm(dir, { recursive: true, force: true })
}

async function resetFocus(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'Summary' })).toBeVisible()
  await page.evaluate(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
  })
}

function focusedLabel(page: Page): Promise<string> {
  return page.evaluate(() => {
    const active = document.activeElement
    return (active?.getAttribute('aria-label') || active?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
  })
}

test('sidebar destinations are reachable by click and expose aria-current', async () => {
  const { app, page, dir } = await launchShell()
  try {
    // The project opens on Summary; every group starts open.
    await expect(page.getByRole('heading', { level: 1, name: 'Summary' })).toBeVisible()
    await expect(item(page, 'Summary')).toHaveAttribute('aria-current', 'page')
    for (const [name, expanded] of [
      ['AI visibility', 'true'],
      ['Tracking', 'true'],
      ['Pinned', 'true']
    ] as const) {
      await expect(nav(page).getByRole('button', { name: new RegExp(`^${name}`) })).toHaveAttribute(
        'aria-expanded',
        expanded
      )
    }
    await expect(nav(page).getByRole('searchbox')).toHaveCount(0)
    // Searches left is an icon button; with no keys yet its badge counts the setup steps.
    const status = topBar(page).locator('.status-pill')
    await expect(status).toHaveAttribute('aria-label', /^Setup: 2 steps left/)
    await expect(status.locator('.sp-badge')).toHaveText('2')

    for (const entry of SIDEBAR) {
      const link = await goTo(page, entry)
      await link.click()
      await expect(link).toHaveAttribute('aria-current', 'page')
      await expect(page.getByRole('heading', { level: 1, name: entry.heading })).toBeVisible()
      for (const other of SIDEBAR) {
        if (other === entry) continue
        await expect(item(page, other.name)).not.toHaveAttribute('aria-current', 'page')
      }
    }

    // Fold state is remembered: Tracking folded here stays folded after a reload.
    await nav(page)
      .getByRole('button', { name: /^Tracking/ })
      .click()
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'Project settings' })).toBeVisible()
    await expect(nav(page).getByRole('button', { name: /^Tracking/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    await nav(page)
      .getByRole('button', { name: /^Tracking/ })
      .click()

    // Ask CiteFox lives in the top bar and opens as a drawer over the screen.
    const ask = topBar(page).getByRole('button', { name: 'Ask CiteFox', exact: true })
    await ask.click()
    await expect(ask).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('dialog', { name: 'Ask CiteFox' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'Project settings' })).toBeVisible()
    await expect(page).toHaveURL(/drawer=ask/)
  } finally {
    await closeShell(app, dir)
  }
})

test('+ Add opens its four paths, and Questions opens over the route', async () => {
  const { app, page, dir } = await launchShell()
  try {
    await expect(page.getByRole('heading', { level: 1, name: 'Summary' })).toBeVisible()
    await openAdd(page, 'Topic')
    await expect(
      page.getByRole('heading', { level: 1, name: 'What do you want to track?' })
    ).toBeVisible()
    // Page to track opens the Add a page drawer over the route.
    await openAdd(page, 'Page to track')
    const addPage = page.getByRole('dialog', { name: 'Add a page' })
    await expect(addPage).toBeVisible()
    expect(await page.evaluate(() => window.location.hash)).toContain('drawer=add-page')
    await page.keyboard.press('Escape')
    await expect(addPage).toHaveCount(0)
    await openAdd(page, 'Import: Sitemap')
    await expect(page.getByRole('heading', { level: 1, name: 'Import pages' })).toBeVisible()

    await page.evaluate(() => {
      window.location.hash = '#/overview'
    })
    await expect(page.getByRole('heading', { level: 1, name: 'Summary' })).toBeVisible()
    await openAdd(page, 'Questions')
    const dialog = page.getByRole('dialog', { name: 'Add questions' })
    await expect(dialog).toBeVisible()
    expect(await page.evaluate(() => window.location.hash)).toBe('#/overview?drawer=add-questions')
    await expect(page.getByRole('heading', { level: 1, name: 'Summary' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Close' }).first().click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/overview')

    // Escape closes the menu and puts focus back on + Add.
    const add = nav(page).getByRole('button', { name: 'Add', exact: true })
    await add.click()
    await expect(add).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')
    await expect(add).toHaveAttribute('aria-expanded', 'false')
    await expect(add).toBeFocused()
  } finally {
    await closeShell(app, dir)
  }
})

test('Cmd+K or Ctrl+K searches pages, topics and questions from the top bar', async () => {
  const { app, page, dir } = await launchShell()
  try {
    await resetFocus(page)
    await page.keyboard.press('ControlOrMeta+k')
    const box = topBar(page).getByRole('combobox', {
      name: 'Find anything: screens, settings, reports, help, actions, pages, topics and questions'
    })
    await expect(box).toBeFocused()
    await box.fill('pricing')
    const results = page.getByRole('listbox', { name: 'Search results' })
    const match = results
      .getByRole('group', { name: 'Pages' })
      .getByRole('option', { name: /Bulk SMS pricing/ })
      .first()
    await expect(match).toBeVisible()
    await match.click()
    await expect(page.getByRole('tablist', { name: 'Page sections' })).toBeVisible()
    await expect(box).toHaveValue('')

    // Pages and questions in their named groups, the arrow keys walking across both.
    await box.fill('alerts')
    await expect(results.getByRole('group', { name: 'Questions' })).toBeVisible()
    await box.press('ArrowDown')
    await box.press('ArrowDown')
    await expect(results.getByRole('option', { selected: true })).toHaveCount(1)
    await page.screenshot({ path: await e2eArtifact('topbar-search-groups.png') })

    // A question opens its Prompt detail from the keyboard: arrow to it, then Enter.
    await box.fill('twilio developers')
    const question = results
      .getByRole('group', { name: 'Questions' })
      .getByRole('option', { name: /cheap alternative to Twilio/ })
    await expect(question).toBeVisible()
    await expect(question).toContainText('Page: Text alerts for business')
    await expect(page.getByText('Searching pages and questions…')).toHaveCount(0)
    await expect(results.getByRole('option')).toHaveCount(1)
    await box.press('ArrowDown')
    await expect(question).toHaveAttribute('aria-selected', 'true')
    await expect(box).toHaveAttribute(
      'aria-activedescendant',
      (await question.getAttribute('id')) ?? ''
    )
    await box.press('Enter')
    await expect
      .poll(() => page.evaluate(() => window.location.hash))
      .toMatch(/^#\/pages\/alerts\/prompt\/[^/?]+$/)
    await expect(box).toHaveValue('')
    await expect(results).toHaveCount(0)
  } finally {
    await closeShell(app, dir)
  }
})

test('sidebar destinations are reachable from the keyboard in order', async () => {
  const { app, page, dir } = await launchShell()
  try {
    await resetFocus(page)
    // Topics opens the Topics screen; the project's topics follow under it.
    await expect(item(page, 'Summary')).toBeVisible()
    const topics = await nav(page).locator('a[href^="#/topics/"] .nav-text').allTextContents()

    const expected = [
      'Skip to main content',
      'CiteFox',
      // The brand row: Collapse sits right of the logo.
      'Collapse sidebar',
      'Switch project, TextBolt, textbolt.com',
      'Add',
      'AI visibility',
      'Summary',
      'Questions',
      'Topics',
      ...topics,
      'Competitors',
      'Citations',
      'Fixes',
      'Tracking',
      'Check history',
      'Reports',
      'Alerts & schedules',
      'Pinned',
      'Text alerts for business',
      'Bulk SMS pricing',
      'SMS opt-in rules',
      // One Pages and one Settings item under the groups.
      'Pages',
      'Settings'
    ]

    for (const name of expected) {
      await page.keyboard.press('Tab')
      expect(await focusedLabel(page)).toContain(name.replace(/\s+/g, ' ').trim().slice(0, 18))
    }

    // Then the silver sponsor and the tray, and the top bar: the page, topic and question
    // search, Activity, searches left, Ask CiteFox, the theme, then the ⚙ menu, and then the screen.
    const seen: string[] = []
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press('Tab')
      const label = await focusedLabel(page)
      seen.push(label)
      if (label === 'Settings menu') break
    }
    const at = (label: string | RegExp): number =>
      seen.findIndex((entry) => (typeof label === 'string' ? entry === label : label.test(entry)))
    expect(
      at('Find anything: screens, settings, reports, help, actions, pages, topics and questions')
    ).toBeGreaterThan(-1)
    // The one readiness model: Claude not checked and no SerpApi key are 2 required steps.
    const order = [
      at('Find anything: screens, settings, reports, help, actions, pages, topics and questions'),
      at(/^Activity/),
      at(/Setup: 2 steps left/),
      at('Ask CiteFox'),
      at('Theme'),
      at('Settings menu')
    ]
    expect(order.every((index) => index > -1)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    // After the top bar, focus goes into the screen.
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement?.closest('#main') !== null)).toBe(true)

    // A group header folds and opens from the keyboard.
    const tracking = nav(page).getByRole('button', { name: /^Tracking/ })
    await tracking.focus()
    await page.keyboard.press('Enter')
    await expect(tracking).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('Enter')
    await expect(tracking).toHaveAttribute('aria-expanded', 'true')

    for (const entry of SIDEBAR) {
      const link = await goTo(page, entry)
      await link.focus()
      await page.keyboard.press('Enter')
      await expect(link).toHaveAttribute('aria-current', 'page')
      await expect(page.getByRole('heading', { level: 1, name: entry.heading })).toBeVisible()
    }

    const capsule = topBar(page).getByRole('button', { name: /^Setup: 2 steps left/ })
    await capsule.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Credits and connections' })).toBeVisible()
    await expect(capsule).toHaveAttribute('aria-expanded', 'true')
    // No open notices: the badge counts only the 2 setup steps; no "decisions waiting"
    // section, and no page-setup line.
    await expect(capsule.locator('.sp-badge')).toHaveText('2')
    await expect(capsule).not.toHaveAttribute('aria-label', /decision/)
    const popover = page.getByRole('dialog', { name: 'Credits and connections' })
    await expect(popover.getByRole('heading', { name: 'Decisions waiting' })).toHaveCount(0)
    await expect(popover.locator('.sp-setup')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Credits and connections' })).toHaveCount(0)
    await expect(capsule).toBeFocused()
    // A press outside closes the popover too.
    await capsule.click()
    await expect(popover).toBeVisible()
    // The popover opens under the top bar on the right; press on the heading's left edge.
    await page
      .getByRole('heading', { level: 1 })
      .first()
      .click({ position: { x: 4, y: 4 } })
    await expect(popover).toHaveCount(0)
  } finally {
    await closeShell(app, dir)
  }
})

test('keyboard focus is visible on the brand', async () => {
  const { app, page, dir } = await launchShell()
  try {
    await resetFocus(page)
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    const brand = nav(page).getByRole('link', { name: 'CiteFox', exact: true })
    await expect(brand).toBeFocused()
    const outline = await brand.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        style: style.outlineStyle,
        width: Number.parseFloat(style.outlineWidth),
        color: style.outlineColor
      }
    })
    const visible = await brand.evaluate((element) => element.matches(':focus-visible'))
    expect(visible).toBe(true)
    expect(outline.style).toBe('solid')
    expect(outline.width).toBeGreaterThan(0)
    // Light on the near-black sidebar (FoxCue look, --spruce-ink).
    expect(outline.color).toBe('rgb(238, 238, 238)')
  } finally {
    await closeShell(app, dir)
  }
})

test('the nine page tabs are reachable by click and by keyboard', async () => {
  const { app, page, dir } = await launchShell()
  try {
    await item(page, /Text alerts for business/).click()
    const tablist = page.getByRole('tablist', { name: 'Page sections' })
    await expect(tablist.getByRole('tab')).toHaveCount(TABS.length)

    for (const name of TABS) {
      const tab = tablist.getByRole('tab', { name, exact: true })
      await tab.click()
      await expect(tab).toHaveAttribute('aria-selected', 'true')
      await expect(tab).toHaveAttribute('aria-current', 'page')
      await expect(page.locator('#page-tabpanel')).toHaveAttribute(
        'aria-labelledby',
        (await tab.getAttribute('id')) ?? ''
      )
      for (const other of TABS) {
        if (other === name) continue
        await expect(tablist.getByRole('tab', { name: other, exact: true })).not.toHaveAttribute(
          'aria-current',
          'page'
        )
      }
    }

    await expect(item(page, /Text alerts for business/)).toHaveAttribute('aria-current', 'page')
    await expect(item(page, /^Pages/)).not.toHaveAttribute('aria-current', 'page')

    const results = tablist.getByRole('tab', { name: 'Results', exact: true })
    await results.focus()
    await page.keyboard.press('End')
    await expect(tablist.getByRole('tab', { name: 'History', exact: true })).toBeFocused()
    await expect(tablist.getByRole('tab', { name: 'History', exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await page.keyboard.press('Home')
    await expect(results).toBeFocused()
    await expect(results).toHaveAttribute('aria-selected', 'true')

    for (const name of TABS.slice(1)) {
      await page.keyboard.press('ArrowRight')
      const tab = tablist.getByRole('tab', { name, exact: true })
      await expect(tab).toBeFocused()
      await expect(tab).toHaveAttribute('aria-selected', 'true')
      await expect(tab).toHaveAttribute('aria-current', 'page')
    }
    await page.keyboard.press('ArrowRight')
    await expect(results).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(tablist.getByRole('tab', { name: 'History', exact: true })).toBeFocused()
  } finally {
    await closeShell(app, dir)
  }
})
