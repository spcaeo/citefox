import { expect, test, type Page } from '@playwright/test'
import { rm } from 'node:fs/promises'
import { launchCiteFox } from './launch'
import { openHash, openTwoMarketApp, shot } from './screens-app'
import { openAllPages } from './nav-helpers'

/**
 * The v2 "Spruce & Fox" foundation in the built app: the gallery of shared
 * components, the shell (spruce top bar, sponsor card, spruce sidebar, collapsed
 * rail) on real screens, and the collapse choice surviving a restart.
 * Screenshots land in test-results/e2e/design-v2-*.png for a visual check
 * against Mockups/v2/preview.
 */

async function settle(page: Page): Promise<void> {
  await expect(page.getByText(/^Loading/)).toHaveCount(0)
  await page.waitForTimeout(300)
}

/** Tabs strips never overflow vertically (a 1px overflow drew a stray scrollbar). */
async function expectTabStripsFit(page: Page): Promise<void> {
  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.ui-tabs')].map(
      (strip) => strip.scrollHeight - strip.clientHeight
    )
  )
  for (const extra of overflow) expect(extra).toBeLessThanOrEqual(0)
}

/**
 * Every link and button in the sidebar is either scrolled out of its scroll area
 * or really on top at its centre: nothing (the sponsor card, the foot) covers it.
 */
async function expectSidebarUncovered(page: Page): Promise<void> {
  const covered = await page.evaluate(() => {
    const nav = document.querySelector('nav.side')
    if (!nav) return ['no sidebar']
    const out: string[] = []
    for (const node of nav.querySelectorAll<HTMLElement>('a[href], button')) {
      const box = node.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      const scroller = node.closest('.side-scroll')
      if (scroller) {
        const area = scroller.getBoundingClientRect()
        if (box.top < area.top || box.bottom > area.bottom) continue
      }
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      if (!hit || !(node === hit || node.contains(hit))) {
        out.push(
          `${node.textContent?.trim() || node.getAttribute('aria-label')} under ${hit?.className}`
        )
      }
    }
    return out
  })
  expect(covered).toEqual([])
}

test('gallery, shell and sponsors render in the v2 style', async () => {
  test.setTimeout(240_000)
  const { app, page, close } = await openTwoMarketApp('design-v2')
  try {
    await page.setViewportSize({ width: 1440, height: 900 })

    await test.step('shell: spruce top bar and sidebar, sponsor card', async () => {
      await openHash(page, '#/pages')
      await settle(page)
      await expect(
        page.getByRole('banner').getByRole('navigation', { name: 'Breadcrumb' })
      ).toBeVisible()
      // The gold sponsor closes the screen: a card inside main, after the content. Only the
      // small release line in the footer comes after it.
      const strip = page.getByRole('main').getByRole('complementary', { name: 'Gold sponsor' })
      await expect(strip).toContainText('Sponsor')
      expect(
        await strip.evaluate((node) => {
          const next = node.nextElementSibling
          return next === null || (next.matches('footer.release-line') && !next.nextElementSibling)
        })
      ).toBe(true)
      await expect(
        strip.getByRole('link', { name: /Join the waitlist at FoxCue/ })
      ).toHaveAttribute(
        'href',
        'https://foxcue.com/?utm_source=citefox&utm_medium=app&utm_campaign=sponsor'
      )
      await expect(page.getByRole('complementary', { name: 'Silver sponsor' })).toBeVisible()
      const side = await page.locator('.side').evaluate((node) => ({
        width: Math.round(node.getBoundingClientRect().width),
        background: getComputedStyle(node).backgroundColor
      }))
      expect(side.width).toBe(220)
      expect(side.background).toBe('rgb(17, 17, 17)')
      // The top bar is near-black too, and as tall as the sidebar's brand row: one frame.
      const bar = await page.locator('.topbar').evaluate((node) => ({
        height: node.getBoundingClientRect().height,
        background: getComputedStyle(node).backgroundColor
      }))
      expect(Math.round(bar.height)).toBe(48)
      expect(bar.background).toBe('rgb(17, 17, 17)')
      const brandRow = await page
        .locator('.side-brand-row')
        .evaluate((node) => node.getBoundingClientRect().height)
      expect(Math.round(brandRow)).toBe(48)
      const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily)
      expect(font).toContain('Inter')
      await shot(page, 'design-v2-all-pages-1440')
    })

    await test.step('short windows: the sidebar middle scrolls, nothing is covered', async () => {
      for (const size of [
        { width: 1280, height: 620 },
        { width: 1024, height: 600 }
      ]) {
        await page.setViewportSize(size)
        await page.waitForTimeout(300)
        await expectSidebarUncovered(page)
        await shot(page, `design-v2-sidebar-${size.width}x${size.height}`)
      }
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.waitForTimeout(300)
    })

    await test.step('existing screens under the aliased tokens', async () => {
      for (const [name, hash] of [
        ['results', '#/pages/page-1/results'],
        ['prompts', '#/pages/page-1/prompts'],
        ['reports', '#/reports'],
        ['settings', '#/settings']
      ] as const) {
        await openHash(page, hash)
        await settle(page)
        await shot(page, `design-v2-${name}-1440`)
      }
      await page.getByRole('tab', { name: 'Data & about' }).click()
      const about = page.getByRole('region', { name: 'About CiteFox' })
      await about.scrollIntoViewIfNeeded()
      await expect(page.getByText('Why sponsors?')).toBeVisible()
      await shot(page, 'design-v2-settings-about-1440')
    })

    await test.step('collapsed rail with Ctrl+B and its tooltips', async () => {
      await openHash(page, '#/pages')
      await settle(page)
      await page.locator('#main').click({ position: { x: 5, y: 5 } })
      await page.keyboard.press('Control+b')
      const nav = page.getByRole('navigation', { name: 'CiteFox' })
      await expect(nav).toHaveAttribute('data-collapsed', 'true')
      await expect(nav.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
      // The width animates (180 ms) unless reduced motion is set.
      await expect
        .poll(() => nav.evaluate((node) => Math.round(node.getBoundingClientRect().width)))
        .toBe(64)
      // A rail link with no count, so its tooltip is the plain name.
      await nav.getByRole('link', { name: 'Competitors', exact: true }).hover()
      await page.waitForTimeout(250)
      await shot(page, 'design-v2-collapsed-1440')
    })

    await test.step('the gallery', async () => {
      await openHash(page, '#/playground/gallery')
      await expect(page.getByRole('heading', { level: 1, name: 'FoxCue look' })).toBeVisible()
      await settle(page)
      await expectTabStripsFit(page)
      await page.setViewportSize({ width: 1440, height: 5600 })
      await page.waitForTimeout(400)
      await shot(page, 'design-v2-gallery')
      // Open menus and the bulk bar, as on the Theme board.
      await page.setViewportSize({ width: 1440, height: 900 })
      const todo = page.getByRole('grid', { name: 'To-do questions' })
      await todo.scrollIntoViewIfNeeded()
      await todo.getByRole('checkbox', { name: 'Select Q6' }).check()
      await todo.getByRole('checkbox', { name: 'Select Q4' }).check()
      await expect(page.getByText('2 selected')).toBeVisible()
      await todo.getByRole('button', { name: 'Actions for Q10' }).click()
      await expect(page.getByRole('menu', { name: 'Actions for Q10' })).toBeVisible()
      await shot(page, 'design-v2-gallery-grid')
      await page.keyboard.press('Escape')
      const ai = page.getByRole('button', { name: 'AI actions', exact: true }).first()
      await ai.scrollIntoViewIfNeeded()
      await ai.click()
      await expect(page.getByRole('menu', { name: 'AI actions' })).toContainText(
        'Runs on your AI plan. Uses no searches.'
      )
      await shot(page, 'design-v2-gallery-ai-menu')
      await page.keyboard.press('Escape')
    })

    await test.step('1024 wide: the rail by itself, nothing pokes out', async () => {
      await page.keyboard.press('Control+b')
      await openHash(page, '#/pages/page-1/results')
      await settle(page)
      await page.setViewportSize({ width: 1024, height: 700 })
      await page.waitForTimeout(300)
      await shot(page, 'design-v2-results-1024')
    })
  } finally {
    await close()
  }
  void app
})

test('the sidebar collapse choice survives a restart', async () => {
  test.setTimeout(120_000)
  const { app, page } = await openTwoMarketApp('design-v2-persist')
  const dir = await app.evaluate(({ app: electron }) => electron.getPath('userData'))
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await expect(page.getByRole('navigation', { name: 'CiteFox' })).toHaveAttribute(
    'data-collapsed',
    'true'
  )
  await page.waitForTimeout(300)
  await app.close()
  const again = await launchCiteFox({ userDataDir: dir, viewport: { width: 1280, height: 900 } })
  try {
    await openAllPages(again.page)
    await expect(again.page.getByRole('navigation', { name: 'CiteFox' })).toHaveAttribute(
      'data-collapsed',
      'true'
    )
    await again.page.getByRole('button', { name: 'Expand sidebar' }).click()
    await expect(again.page.getByRole('navigation', { name: 'CiteFox' })).not.toHaveAttribute(
      'data-collapsed',
      'true'
    )
  } finally {
    await again.app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
