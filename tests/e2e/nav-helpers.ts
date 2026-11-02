import { expect, type Locator, type Page } from '@playwright/test'

/**
 * The sidebar after the nav redesign: the project opens on Summary; AI visibility,
 * Tracking and Pinned are folding groups; under them sit one Pages item (Pages,
 * YouTube and Communities as tabs) and one Settings item (Project settings,
 * Connections, App settings and, in dev builds, Playground as tabs). + Add holds
 * Questions, Topic, Page to track, then Import: Excel or CSV file and Import: Sitemap.
 */
export function sidebar(page: Page): Locator {
  return page.getByRole('navigation', { name: 'CiteFox' })
}

/**
 * `Your site` and `Setup` were groups before the Pages and Settings hubs; specs
 * still name them, and they mean those hubs now.
 */
export type SidebarGroupName = 'AI visibility' | 'Tracking' | 'Pinned' | 'Your site' | 'Setup'

/** The hub (sidebar item) each old Your site and Setup screen is a tab of. */
const HUB_OF: Readonly<Record<string, 'Pages' | 'Settings'>> = {
  YouTube: 'Pages',
  Communities: 'Pages',
  'Project settings': 'Settings',
  Connections: 'Settings',
  'App settings': 'Settings',
  Playground: 'Settings'
}

/** Opens a sidebar group when it is folded. The icon rail has no group headers: it shows every item. */
export async function openSidebarGroup(page: Page, name: SidebarGroupName): Promise<void> {
  // Pages and Settings are plain items now: nothing to open.
  if (name === 'Your site' || name === 'Setup') return
  // Retried: right after a resize the sidebar may still be turning into the rail.
  await expect(async () => {
    if ((await sidebar(page).getAttribute('data-collapsed')) !== null) return
    const head = sidebar(page).getByRole('button', { name: new RegExp(`^${name}`) })
    if ((await head.getAttribute('aria-expanded', { timeout: 2_000 })) === 'false') {
      await head.click({ timeout: 2_000 })
    }
    await expect(head).toHaveAttribute('aria-expanded', 'true', { timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
}

/** The tab bar of the Pages or Settings hub over the open screen. */
export function hubTabs(page: Page, hub: 'Pages' | 'Settings'): Locator {
  return page.locator('#main').getByRole('navigation', { name: hub, exact: true })
}

/**
 * A sidebar link, opening its group first. A screen that moved into the Pages or
 * Settings hub opens that hub from the sidebar and returns its tab there instead
 * (Playground, a dev-build tab, is opened by its address).
 */
export async function sidebarLink(
  page: Page,
  group: SidebarGroupName,
  name: string | RegExp
): Promise<Locator> {
  const hub = typeof name === 'string' ? HUB_OF[name] : undefined
  if (hub !== undefined && typeof name === 'string') {
    if (name === 'Playground') {
      await page.evaluate(() => {
        window.location.hash = '#/playground'
      })
    } else {
      await sidebar(page)
        .getByRole('link', { name: new RegExp(`^${hub}`) })
        .click()
    }
    return hubTabs(page, hub).getByRole('tab', { name, exact: true })
  }
  await openSidebarGroup(page, group)
  return sidebar(page).getByRole(
    'link',
    typeof name === 'string' ? { name, exact: true } : { name }
  )
}

export type AddEntry =
  'Questions' | 'Topic' | 'Page to track' | 'Import: Excel or CSV file' | 'Import: Sitemap'

/**
 * Opens + Add and picks one of its paths. Topic opens the New topic dialog;
 * this helper goes on to its "Open the full wizard" link (the chooser, "What do you
 * want to track?"), which the wizard specs start from. `openNewTopic` stops at the
 * dialog.
 */
export async function openAdd(page: Page, entry: AddEntry): Promise<void> {
  await pickAdd(page, entry)
  if (entry !== 'Topic') return
  await page
    .getByRole('dialog', { name: 'New topic' })
    .getByRole('link', { name: 'Open the full wizard' })
    .click()
}

/** + Add → Topic: the New topic dialog over the current screen. */
export async function openNewTopic(page: Page): Promise<Locator> {
  await pickAdd(page, 'Topic')
  const dialog = page.getByRole('dialog', { name: 'New topic' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function pickAdd(page: Page, entry: AddEntry): Promise<void> {
  const button = sidebar(page).getByRole('button', { name: 'Add', exact: true })
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click()
  await sidebar(page)
    .getByRole('list', { name: 'Add' })
    .getByRole('link', { name: entry, exact: true })
    .click()
}

/**
 * Opens All pages (`#/pages`) and waits for its heading and for `project` (its name,
 * or a pattern for the project switcher's name) to be the open project.
 */
export async function openAllPages(
  page: Page,
  project: string | RegExp = 'TextBolt'
): Promise<void> {
  await expect(page.getByRole('navigation', { name: 'CiteFox' })).toBeVisible()
  await page.evaluate(() => {
    window.location.hash = '#/pages'
  })
  await expect(page.getByRole('heading', { level: 1, name: 'Pages' })).toBeVisible()
  const switcher =
    typeof project === 'string'
      ? new RegExp(`^Switch project, ${project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
      : project
  await expect(page.getByRole('button', { name: switcher })).toBeVisible()
}
