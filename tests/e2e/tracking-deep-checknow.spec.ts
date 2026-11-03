import { expect, test, type Locator, type Page } from '@playwright/test'
import { e2eArtifact } from './artifacts'
import { animationsDone, DRAWER_SIZES } from './drawer-helpers'
import { openSidebarGroup, sidebar } from './nav-helpers'
import { openHash, openTwoMarketApp } from './screens-app'

/**
 * Check now and Add a page (tracking.md §3, §10, §11; page.md §2d) on the
 * seeded two-market TextBolt project: every drawer opens from its URL and
 * reopens the same after a reload; the page header's Check now menu; Pin and
 * Unpin into the sidebar. No check is started (no searches), and the setup
 * runner is off, so adding a page reads nothing.
 */

/** The seeded ids (screens-seed.ts SEED; imported lazily there, so repeated here). */
const SEED = { pageId: 'page-1', us: 'mkt-us', uk: 'mkt-uk' } as const
const PAGE_URL = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'

function hash(page: Page): Promise<string> {
  return page.evaluate(() => window.location.hash)
}

function query(value: string): URLSearchParams {
  return new URLSearchParams(value.slice(value.indexOf('?') + 1))
}

/** Screenshots at both board sizes as `checknow-<name>-<width>.png`. */
async function shots(page: Page, name: string, before?: () => Promise<void>): Promise<void> {
  for (const size of DRAWER_SIZES) {
    await page.setViewportSize(size)
    await animationsDone(page)
    if (before) await before()
    await page.screenshot({ path: await e2eArtifact(`checknow-${name}-${size.width}.png`) })
  }
  await page.setViewportSize({ width: 1280, height: 900 })
}

async function reload(page: Page): Promise<void> {
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
}

function checkDrawer(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Check now' })
}

test('Check now: scope drawer, #/check picker, page menu, Add a page and Pin', async () => {
  test.setTimeout(300_000)
  const seeded = await openTwoMarketApp('checknow')
  const { page } = seeded
  try {
    await test.step('the scope drawer opens from its URL and keeps its state over a reload', async () => {
      await openHash(
        page,
        `#/pages?drawer=check-now&check.scope=pages&check.ids=${SEED.pageId}&check.markets=${SEED.uk}`
      )
      const dialog = checkDrawer(page)
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('radio', { name: /Pages I pick/ })).toBeChecked()
      await expect(dialog.getByRole('checkbox', { name: /Alerts/ })).toBeChecked()
      await expect(dialog.getByTestId('check-now-cost')).toContainText('1 page · 1 market')
      await expect(dialog.getByTestId('check-now-cost')).toContainText('searches')
      await expect(dialog.getByRole('button', { name: 'Check now', exact: true })).toBeEnabled()

      await reload(page)
      await expect(checkDrawer(page)).toBeVisible()
      await expect(checkDrawer(page).getByRole('radio', { name: /Pages I pick/ })).toBeChecked()
      await expect(checkDrawer(page).getByTestId('check-now-cost')).toContainText(
        '1 page · 1 market'
      )
      await shots(page, 'scope-pages')
    })

    await test.step('only not cited reads the last check and puts the choice on the URL', async () => {
      const dialog = checkDrawer(page)
      await dialog.getByRole('radio', { name: /Only questions not cited/ }).check()
      await expect.poll(async () => query(await hash(page)).get('check.only')).toBe('notcited')
      // The UK check cited the page for one question only: the other is listed.
      await expect(dialog.getByTestId('check-now-cost')).toContainText('question')
      await reload(page)
      await expect(
        checkDrawer(page).getByRole('radio', { name: /Only questions not cited/ })
      ).toBeChecked()
      await shots(page, 'scope-notcited')
    })

    await test.step('everything due: Check now is off with the reason when nothing is due', async () => {
      await openHash(page, '#/pages?drawer=check-now')
      const dialog = checkDrawer(page)
      await expect(dialog.getByRole('radio', { name: /Everything due/ })).toBeChecked()
      const reason = dialog.getByTestId('check-now-reason')
      const cost = dialog.getByTestId('check-now-cost')
      await expect(reason.or(cost)).toBeVisible()
      if (await reason.isVisible()) {
        await expect(reason).toContainText(/Nothing is due/)
        await expect(dialog.getByRole('button', { name: 'Check now', exact: true })).toBeDisabled()
        await dialog.getByRole('button', { name: 'Pick pages instead' }).click()
        await expect(dialog.getByRole('radio', { name: /Pages I pick/ })).toBeChecked()
      }
      // The scope chips hide their radio under the label: check it through the label.
      // (Without topics, "Everything again" is the same choice as every tracked page.)
      await dialog.getByRole('radio', { name: /Everything again/ }).check({ force: true })
      await expect(dialog.getByTestId('check-now-cost')).toContainText('1 page · every market')
      await shots(page, 'scope-tracked')
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
    })

    await test.step('#/check shows the same picker on the screen URL', async () => {
      await openHash(page, '#/check?check.scope=tracked&check.markets=mkt-us')
      await expect(page.getByRole('heading', { level: 1, name: 'Check now' })).toBeVisible()
      const panel = page.getByTestId('check-now-panel')
      await expect(panel.getByRole('radio', { name: /Every tracked page/ })).toBeChecked()
      await expect(panel.getByTestId('check-now-panel-summary')).toContainText('1 page · 1 market')
      await reload(page)
      await expect(
        page.getByTestId('check-now-panel').getByRole('radio', { name: /Every tracked page/ })
      ).toBeChecked()
      // The due queue keeps its own Check now (every project) above the picker.
      await expect(page.getByRole('region', { name: 'Check now' })).toBeVisible()
      await shots(page, 'scope-screen')
    })

    await test.step('the page header Check now ▾ lists narrower checks with their cost', async () => {
      await openHash(page, `#/pages/${SEED.pageId}/results`)
      const split = page.getByTestId('page-check-split')
      await expect(split.getByRole('link', { name: 'Check now' })).toHaveAttribute(
        'href',
        `#/pages/${SEED.pageId}/running`
      )
      const open = async (): Promise<void> => {
        if ((await page.getByRole('menu').count()) === 0) {
          await split.getByRole('button', { name: 'More ways to check this page' }).click()
        }
        await expect(page.getByRole('menuitem', { name: /All markets/ })).toContainText('searches')
      }
      await open()
      await expect(page.getByRole('menuitem', { name: /This market/ })).toContainText('searches')
      await expect(page.getByRole('menuitem', { name: /Only not cited/ })).toBeVisible()
      await shots(page, 'split-menu', open)
      await open()
      await page.getByRole('menuitem', { name: /Choose what to check/ }).click()
      const dialog = checkDrawer(page)
      await expect(dialog).toBeVisible()
      const value = await hash(page)
      expect(query(value).get('check.scope')).toBe('pages')
      expect(query(value).get('check.ids')).toBe(SEED.pageId)
      await expect(dialog.getByRole('checkbox', { name: /Alerts/ })).toBeChecked()
      await shots(page, 'split-drawer')
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)

      await split.getByRole('button', { name: 'More ways to check this page' }).click()
      await page.getByRole('menuitem', { name: /Only questions I pick/ }).click()
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('radio', { name: /Questions I pick/ })).toBeChecked()
      await dialog.getByRole('checkbox', { name: /scheduled texts/ }).check()
      await expect.poll(async () => query(await hash(page)).get('check.prompts')).toBeTruthy()
      await expect(dialog.getByTestId('check-now-cost')).toContainText('1 question')
      await reload(page)
      await expect(checkDrawer(page).getByTestId('check-now-cost')).toContainText('1 question')
      await shots(page, 'split-picked')
      await page.keyboard.press('Escape')
    })

    await test.step('Add a page: from its URL, Already tracked, several addresses, then add', async () => {
      await openHash(page, `#/pages?drawer=add-page&addpage.url=${encodeURIComponent(PAGE_URL)}`)
      const dialog = page.getByRole('dialog', { name: 'Add a page' })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByTestId('add-page-tracked')).toContainText('Already tracked')
      await expect(dialog.getByRole('button', { name: 'Add page' })).toBeDisabled()
      await shots(page, 'addpage-tracked')

      const url = dialog.getByLabel('Page URL')
      await url.fill('https://textbolt.com/a https://textbolt.com/b https://textbolt.com/c')
      await expect(dialog.getByRole('link', { name: 'Import 3 pages instead' })).toHaveAttribute(
        'href',
        '#/import-pages'
      )

      await url.fill('/pricing-new')
      await dialog.getByLabel('Label', { exact: true }).fill('New pricing')
      await dialog.getByRole('radio', { name: /Type my own/ }).check()
      await expect.poll(async () => query(await hash(page)).get('addpage.url')).toBe('/pricing-new')
      await expect.poll(async () => query(await hash(page)).get('addpage.questions')).toBe('type')
      await reload(page)
      const again = page.getByRole('dialog', { name: 'Add a page' })
      await expect(again.getByLabel('Page URL')).toHaveValue('/pricing-new')
      await expect(again.getByLabel('Label', { exact: true })).toHaveValue('New pricing')
      await expect(again.getByRole('radio', { name: /Type my own/ })).toBeChecked()
      await again.getByRole('radio', { name: /Suggest with CiteFox AI/ }).check()
      await expect(again.getByTestId('add-page-cost')).toContainText('Checking uses about')
      await shots(page, 'addpage-form')

      await again.getByRole('button', { name: 'Add page' }).click()
      await expect(again).toHaveCount(0)
      await expect.poll(() => hash(page)).toMatch(/^#\/pages\/[^/]+\/prompts/)
    })

    await test.step('Pin and Unpin on the page header update the sidebar', async () => {
      await openHash(page, `#/pages/${SEED.pageId}/results`)
      // Pin to sidebar / Unpin from sidebar sit under the page header's ⋯.
      const more = page.locator('.ui-head-page').getByRole('button', { name: 'More actions' })
      // No pinned pages yet: no Pinned group until the first pin.
      const pinned = sidebar(page)
        .locator('.side-group')
        .filter({ has: page.getByRole('button', { name: /^Pinned/ }) })
        .locator(`a[href^="#/pages/${SEED.pageId}"]`)
      await expect(pinned).toHaveCount(0)
      await more.click()
      await page.getByRole('menuitem', { name: 'Pin to sidebar' }).click()
      await openSidebarGroup(page, 'Pinned')
      await expect(pinned.first()).toBeVisible()
      await shots(page, 'pin-pinned')
      await more.click()
      await page.getByRole('menuitem', { name: 'Unpin from sidebar' }).click()
      await expect(pinned).toHaveCount(0)
    })
  } finally {
    await seeded.close()
  }
})
