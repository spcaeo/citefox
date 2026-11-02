import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import type { CiteFoxApi } from '@shared/ipc'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { animationsDone, DRAWER_SIZES } from './drawer-helpers'
import { launchCiteFox } from './launch'
import { openAllPages } from './nav-helpers'
import { installRawMarkdown } from './raw-hook'
import { openHash } from './screens-app'

/**
 * Deep audit tracking.md §7 (All pages) and §8 (Site structure) on the
 * TextBolt-sized seed (2,014 pages, 186 tracked) through the real IPC
 * handlers: the full row menu, the bulk bar, the grid owning the page scroll,
 * and the cluster, group, pick pages, move pages and new cluster drawers,
 * each reachable by URL and the same after a reload. Clusters come from
 * "Group by rules" (no Claude). No live network: nothing here runs a check.
 * Screenshots: test-results/e2e/pages-<what>-<width>.png.
 */
test.describe.configure({ mode: 'serial' })

type Bridge = typeof globalThis & { citefox: CiteFoxApi }

const PROJECT = 'proj-scale'
let app: ElectronApplication
let page: Page
let dir: string
let cluster: { id: string; name: string }
let groupId: string

test.beforeAll(async () => {
  test.setTimeout(240_000)
  dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-deep-pages-'))
  installRawMarkdown()
  const { seedScaleProject } = await import('./scale-seed')
  await seedScaleProject(dir)
  const launched = await launchCiteFox({ userDataDir: dir, viewport: { width: 1440, height: 900 } })
  app = launched.app
  page = launched.page
  await openAllPages(page)
  await expect(page.getByText(/^Showing 25 of 2,014 pages/)).toBeVisible()
  const made = await page.evaluate(async (projectId) => {
    const api = (globalThis as Bridge).citefox
    await api['structure:recluster']({
      projectId,
      method: 'topic',
      useClaude: false,
      instruction: null
    })
    const view = await api['structure:get']({ projectId })
    const biggest = [...view.clusters].sort((a, b) => b.pageCount - a.pageCount)[0]
    const list = await api['allpages:list']({ projectId })
    const tracked = list.rows.filter((row) => row.status === 'tracked').slice(0, 3)
    const group = await api['structure:createGroup']({
      projectId,
      name: 'Money pages',
      note: null
    })
    await api['structure:setGroupPages']({
      projectId,
      groupId: group.id,
      add: tracked.map((row) => row.id),
      remove: []
    })
    return {
      cluster: biggest ? { id: biggest.id, name: biggest.name } : null,
      groupId: group.id
    }
  }, PROJECT)
  if (!made.cluster) throw new Error('Group by rules made no clusters')
  cluster = made.cluster
  groupId = made.groupId
  // All pages loaded before the clusters existed: reload so its Clusters section shows.
  await reloadApp()
  await expect(page.getByRole('grid', { name: 'Clusters' })).toBeVisible()
})

test.afterAll(async () => {
  await app?.close()
  await rm(dir, { recursive: true, force: true })
})

/** The current hash's query values. */
async function hashParams(): Promise<Record<string, string[]>> {
  return page.evaluate(() => {
    const query = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
    const out: Record<string, string[]> = {}
    query.forEach((value, key) => {
      out[key] = [...(out[key] ?? []), value]
    })
    return out
  })
}

/** Screenshots at both review sizes as `pages-<name>-<width>.png`, then back to 1440×900. */
async function shots(name: string, before?: () => Promise<void>): Promise<void> {
  for (const size of DRAWER_SIZES) {
    await page.setViewportSize(size)
    await before?.()
    await animationsDone(page)
    await page.screenshot({ path: await e2eArtifact(`pages-${name}-${size.width}.png`) })
  }
  await page.setViewportSize(DRAWER_SIZES[0])
}

async function reloadApp(): Promise<void> {
  await page.reload()
  await expect(page.getByRole('navigation', { name: 'CiteFox' })).toBeVisible()
}

function pagesGrid(): Locator {
  return page.getByRole('grid', { name: 'Pages' })
}

async function searchPages(text: string): Promise<void> {
  await page.getByRole('searchbox', { name: 'Search pages by title or URL' }).fill(text)
}

async function openRowMenu(name: string): Promise<Locator> {
  const button = pagesGrid()
    .getByRole('button', { name: `Actions for ${name}` })
    .first()
  await button.evaluate((node) => node.scrollIntoView({ block: 'center' }))
  await button.click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  return menu
}

test('the grid owns the page scroll at both sizes; Needs attention is one line', async () => {
  for (const size of DRAWER_SIZES) {
    await page.setViewportSize(size)
    await openHash(page, '#/pages')
    await expect(page.getByText(/^Showing 25 of 2,014 pages/)).toBeVisible()
    const attention = page.getByRole('region', { name: 'Needs attention' })
    await expect(attention.getByRole('button', { name: 'Review' })).toBeVisible()
    const box = await attention.boundingBox()
    // One line, not the full list over the grid.
    expect(box?.height ?? 999).toBeLessThan(90)
    const scroll = await page.evaluate(() => {
      const grids = [...document.querySelectorAll<HTMLElement>('#main [role="grid"]')]
      const main = document.querySelector<HTMLElement>('#main')
      return {
        grids: grids.length,
        grid: Math.max(...grids.map((grid) => grid.scrollHeight - grid.clientHeight)),
        main: main ? main.scrollHeight - main.clientHeight : -1
      }
    })
    // No vertical scroll inside any grid on the page (Pages, Clusters); the page itself scrolls.
    expect(scroll.grids).toBeGreaterThanOrEqual(2)
    expect(scroll.grid).toBeLessThanOrEqual(1)
    expect(scroll.main).toBeGreaterThan(0)
    await animationsDone(page)
    await page.screenshot({ path: await e2eArtifact(`pages-scroll-${size.width}.png`) })
  }
  await page.setViewportSize(DRAWER_SIZES[0])

  // Review opens the list with a URL that survives a reload; Show less folds it.
  await page
    .getByRole('region', { name: 'Needs attention' })
    .getByRole('button', { name: 'Review' })
    .click()
  expect((await hashParams()).attention).toEqual(['open'])
  await reloadApp()
  const attention = page.getByRole('region', { name: 'Needs attention' })
  await expect(attention.getByRole('button', { name: 'Wrong page cited' })).toBeVisible()
  await page.getByRole('button', { name: 'Show less' }).click()
  expect((await hashParams()).attention).toBeUndefined()
  await expect(attention.getByRole('button', { name: 'Review' })).toBeVisible()
})

test('the row menu has every action for tracked pages and fewer for untracked ones', async () => {
  await searchPages('Text alerts for business')
  const menu = await openRowMenu('Text alerts for business')
  for (const item of [
    'Open page',
    'Check now…',
    'Pause tracking',
    'Rename…',
    'Add questions…',
    'Add to group…',
    'Move to cluster…',
    'Copy URL',
    'Open live page',
    'Stop tracking…'
  ]) {
    await expect(menu.getByRole('menuitem', { name: item, exact: true })).toBeVisible()
  }
  await page.keyboard.press('Escape')
  await shots('rowmenu', async () => {
    await page.keyboard.press('Escape')
    await openRowMenu('Text alerts for business')
  })
  await page.keyboard.press('Escape')

  // Stop tracking asks first; Cancel changes nothing.
  await (
    await openRowMenu('Text alerts for business')
  )
    .getByRole('menuitem', { name: 'Stop tracking…' })
    .click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('History stays; no more searches are used.')
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(confirm).toHaveCount(0)

  await searchPages('')
  await page
    .getByRole('group', { name: 'View' })
    .getByRole('button', { name: /^Untracked/ })
    .click()
  const row = pagesGrid().locator('[data-row]').first()
  await row.getByRole('button', { name: /^Actions for / }).click()
  const untracked = page.getByRole('menu')
  await expect(untracked.getByRole('menuitem', { name: 'Track this page' })).toBeVisible()
  await expect(untracked.getByRole('menuitem', { name: 'Stop tracking…' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: /^All/ }).click()
})

test('the bulk bar: common actions as buttons, the rest under More', async () => {
  await page
    .getByRole('group', { name: 'View' })
    .getByRole('button', { name: /^Tracked/ })
    .click()
  const boxes = pagesGrid().locator('[data-row] input[type="checkbox"]')
  await boxes.nth(0).check()
  await boxes.nth(1).check()
  const bar = page.getByRole('region', { name: 'Bulk actions' })
  for (const name of ['Check now', 'Pause', 'Add to group', 'Export']) {
    await expect(bar.getByRole('button', { name, exact: true })).toBeVisible()
  }
  await expect(bar.getByRole('button', { name: 'Track', exact: true })).toHaveCount(0)
  await shots('bulk', async () => {
    await bar.evaluate((node) => node.scrollIntoView({ block: 'center' }))
  })
  await bar.getByRole('button', { name: /^More/ }).click()
  const more = page.getByRole('menu')
  for (const name of [/^Move to cluster/, /^New group with these 2 pages/, /^Stop tracking/]) {
    await expect(more.getByRole('menuitem', { name })).toBeVisible()
  }
  await page.keyboard.press('Escape')
  await bar.getByRole('button', { name: 'Clear' }).click()
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: /^All/ }).click()
})

test('Move to cluster: a searchable list on the URL, the same after a reload', async () => {
  await searchPages('Text alerts for business')
  await (
    await openRowMenu('Text alerts for business')
  )
    .getByRole('menuitem', { name: 'Move to cluster…' })
    .click()
  const drawer = page.getByRole('dialog', { name: 'Move to cluster' })
  await expect(drawer).toBeVisible()
  const params = await hashParams()
  expect(params.drawer).toEqual(['move-pages'])
  expect(params['move.to']).toEqual(['cluster'])
  const word = cluster.name.split(/\s+/)[0] ?? cluster.name
  await drawer.getByRole('searchbox', { name: 'Search clusters' }).fill(word)
  await expect.poll(async () => (await hashParams())['move.q']).toEqual([word])
  // The cluster the page is in now shows, but cannot be picked.
  await expect(
    drawer.getByRole('radio', { name: new RegExp(`^${escape(cluster.name)}`) }).first()
  ).toBeDisabled()
  await drawer.locator('.sc-picker-list input[type="radio"]:not([disabled])').first().check()
  const picked = (await hashParams())['move.pick']?.[0] ?? ''
  expect(picked).not.toBe('')
  expect(picked).not.toBe(cluster.id)
  await reloadApp()
  const again = page.getByRole('dialog', { name: 'Move to cluster' })
  await expect(again.getByRole('searchbox', { name: 'Search clusters' })).toHaveValue(word)
  await expect(again.getByRole('button', { name: 'Move 1 page' })).toBeEnabled()
  await shots('move')
  // New cluster… asks for a name.
  await again.getByRole('searchbox', { name: 'Search clusters' }).fill('')
  await again.getByRole('radio', { name: /^New cluster/ }).check()
  await expect(again.getByLabel(/New cluster name/)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await searchPages('')
})

test('a cluster opens in its drawer: search and picks on the URL, split stacks Move pages', async () => {
  // Site structure is now All pages' Tree view; its clusters part keeps the drawer.
  await openHash(page, '#/pages?view=tree&part=clusters')
  const grid = page.getByRole('grid', { name: 'Clusters' })
  await grid.getByRole('button', { name: `Show pages of ${cluster.name}`, exact: true }).click()
  const drawer = page.getByRole('dialog', { name: cluster.name })
  const list = drawer.getByRole('grid', { name: `Pages in ${cluster.name}` })
  await expect(list).toBeVisible()
  const crumbs = drawer.getByRole('navigation', { name: 'Drawer breadcrumb' })
  await expect(crumbs).toContainText('Pages')
  await expect(crumbs).toContainText('Clusters')
  await expect(crumbs).not.toContainText('Site structure')
  await expect(drawer).toContainText(/\d+ pages? · \d+ tracked/)
  expect((await hashParams())['cluster.id']).toEqual([cluster.id])
  await list.locator('[data-row] input[type="checkbox"]').first().check()
  await expect.poll(async () => (await hashParams())['cluster.pick']?.length).toBe(1)
  await reloadApp()
  const again = page.getByRole('dialog', { name: cluster.name })
  await expect(again.getByRole('region', { name: 'Bulk actions' })).toBeVisible()
  await shots('cluster-drawer')
  await again.getByRole('button', { name: 'Move to new cluster' }).click()
  const move = page.getByRole('dialog', { name: 'Move to a new cluster' })
  await expect(move).toBeVisible()
  const params = await hashParams()
  expect(params.drawer).toEqual(['cluster', 'move-pages'])
  expect(params['move.from']).toEqual([cluster.id])
  await page.keyboard.press('Escape')
  await expect(move).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('a group opens in its drawer; Add pages stacks the picker over 2,014 pages', async () => {
  await openHash(page, '#/structure/groups')
  await page.getByRole('button', { name: 'Show pages of Money pages', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: 'Money pages' })
  await expect(drawer.getByRole('grid', { name: 'Pages in Money pages' })).toBeVisible()
  await expect(drawer).toContainText('3 pages · 3 tracked')
  expect((await hashParams())['group.id']).toEqual([groupId])
  await shots('group-drawer')

  await drawer.getByRole('button', { name: 'Add pages' }).last().click()
  const picker = page.getByRole('dialog', { name: 'Add pages to Money pages' })
  await expect(picker.getByText(/2,0\d\d/).first()).toBeVisible()
  await picker.getByRole('searchbox', { name: 'Search pages' }).fill('pricing')
  await expect.poll(async () => (await hashParams())['pick.q']).toEqual(['pricing'])
  await picker.getByRole('button', { name: /^Pick these \d+/ }).click()
  await expect.poll(async () => ((await hashParams())['pick.ids'] ?? []).length).toBe(1)
  await reloadApp()
  const again = page.getByRole('dialog', { name: 'Add pages to Money pages' })
  await expect(again.getByRole('searchbox', { name: 'Search pages' })).toHaveValue('pricing')
  await shots('pick-pages')
  const add = again.getByRole('button', { name: /^Add \d+ pages?$/ })
  const label = (await add.textContent()) ?? ''
  const added = Number(/Add ([\d,]+)/.exec(label)?.[1]?.replace(/,/g, '') ?? '0')
  expect(added).toBeGreaterThan(0)
  await add.click()
  await expect(again).toHaveCount(0)
  const group = page.getByRole('dialog', { name: 'Money pages' })
  await expect(group).toContainText(`${(3 + added).toLocaleString('en-US')} pages`)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('New cluster: name and pick pages; Delete cluster asks first', async () => {
  await openHash(page, '#/structure/clusters')
  await page.getByRole('button', { name: 'New cluster', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: 'New cluster' })
  expect((await hashParams())['pick.for']).toEqual(['cluster:new'])
  await drawer.getByLabel(/Cluster name/).fill('Pricing pages')
  await drawer.getByRole('searchbox', { name: 'Search pages' }).fill('pricing')
  const boxes = drawer.locator('.sc-picker-list input[type="checkbox"]:not([disabled])')
  await boxes.nth(0).check()
  await boxes.nth(1).check()
  await shots('new-cluster')
  await drawer.getByRole('button', { name: 'Create cluster with 2 pages' }).click()
  await expect(drawer).toHaveCount(0)
  await expect(page.getByText(/Made the cluster “Pricing pages” with 2 pages/)).toBeVisible()
  // Many clusters page the list: find the new one by name.
  await page.getByPlaceholder('Search clusters, pillars or themes').fill('Pricing pages')
  const grid = page.getByRole('grid', { name: 'Clusters' })
  await expect(grid.getByRole('button', { name: 'Show pages of Pricing pages' })).toBeVisible()

  const actions = grid.getByRole('button', { name: 'Actions for Pricing pages', exact: true })
  await actions.evaluate((node) => node.scrollIntoView({ block: 'center' }))
  await actions.click()
  await page.getByRole('menuitem', { name: 'Delete cluster' }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('become unclustered')
  await confirm.getByRole('button', { name: 'Delete cluster' }).click()
  await expect(grid.getByRole('button', { name: 'Show pages of Pricing pages' })).toHaveCount(0)
  await expect(page.getByText(/Its pages are unclustered now/)).toBeVisible()
})

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
