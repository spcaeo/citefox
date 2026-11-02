import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openHash, openTwoMarketApp, shot } from './screens-app'

/**
 * The slim header (Header.dc.html): the spruce 48px top bar and the sidebar's
 * brand row as one frame, the icon buttons with their tooltips, the ⚙ menu
 * with the theme, the compact screen header and the gold sponsor card at the
 * end of the content. Light and dark at 1134 and 1440 wide; screenshots land
 * in test-results/e2e/slim-*.png.
 */

async function settle(page: Page): Promise<void> {
  await expect(page.getByText(/^Loading/)).toHaveCount(0)
  await page.waitForTimeout(300)
}

async function overflow(page: Page): Promise<number> {
  return page
    .getByRole('banner')
    .first()
    .evaluate((bar) => bar.scrollWidth - bar.clientWidth)
}

test('slim header: frame, theme switch, compact header and sponsor card', async () => {
  test.setTimeout(300_000)
  const { page, close } = await openTwoMarketApp('slim-shell')
  try {
    const banner = page.getByRole('banner')
    const themeButton = banner.getByRole('button', { name: 'Theme', exact: true })
    const menu = page.getByRole('menu', { name: 'Theme' })

    for (const theme of ['light', 'dark'] as const) {
      await test.step(`${theme}: switch from the top bar's theme button`, async () => {
        await page.setViewportSize({ width: 1440, height: 900 })
        await themeButton.click()
        await menu
          .getByRole('menuitemradio', {
            name: `Theme: ${theme[0]?.toUpperCase()}${theme.slice(1)}`
          })
          .click()
        await expect
          .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
          .toBe(theme)
        // One pick closes the menu; reopened, the tick is on the choice.
        await expect(menu).toBeHidden()
        await themeButton.click()
        await expect(
          menu.getByRole('menuitemradio', { name: new RegExp(`Theme: ${theme}`, 'i') })
        ).toHaveAttribute('aria-checked', 'true')
        await shot(page, `slim-${theme}-menu-1440`)
        await page.keyboard.press('Escape')
        await expect(menu).toBeHidden()
        await expect(themeButton).toBeFocused()
        // Blur, so the screenshots below show no focus tooltip.
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      })

      for (const width of [1134, 1440]) {
        await test.step(`${theme} at ${width}`, async () => {
          await page.setViewportSize({ width, height: 860 })
          for (const [name, hash] of [
            ['summary', '#/overview'],
            ['questions', '#/questions'],
            ['pages', '#/pages'],
            ['history', '#/history']
          ] as const) {
            await openHash(page, hash)
            await settle(page)
            expect(await overflow(page)).toBeLessThanOrEqual(1)
            const bar = await page
              .locator('.topbar')
              .evaluate((node) => Math.round(node.getBoundingClientRect().height))
            expect(bar).toBe(48)
            // The gold sponsor closes the screen, inside main, after the content; only the
            // release line (the footer) follows it.
            const card = page.locator('#main > .sponsor-card')
            await expect(card).toHaveCount(1)
            expect(
              await card.evaluate((node) => {
                const next = node.nextElementSibling
                return (
                  next === null ||
                  (next.matches('footer.release-line') && next.nextElementSibling === null)
                )
              })
            ).toBe(true)
            await shot(page, `slim-${theme}-${name}-${width}`)
          }
          await card(page)
          await shot(page, `slim-${theme}-end-${width}`)
        })
      }

      await test.step(`${theme}: the top bar passes axe, tooltips show on focus`, async () => {
        await page.setViewportSize({ width: 1440, height: 860 })
        await openHash(page, '#/questions')
        await settle(page)
        const results = await new AxeBuilder({ page })
          .include('.topbar')
          .include('.side-brand-row')
          .setLegacyMode()
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
        expect(results.violations).toEqual([])
        await banner.getByRole('button', { name: /^Activity/ }).focus()
        await page.keyboard.press('Shift+Tab')
        await page.keyboard.press('Tab')
        await shot(page, `slim-${theme}-tooltip-1440`)
      })
    }

    await test.step('the collapsed rail keeps the expand button in the top spot', async () => {
      await page.setViewportSize({ width: 1134, height: 860 })
      await page.getByRole('button', { name: 'Collapse sidebar' }).click()
      const nav = page.getByRole('navigation', { name: 'CiteFox' })
      const expand = nav.getByRole('button', { name: 'Expand sidebar' })
      await expect(expand).toBeVisible()
      const box = await expand.boundingBox()
      expect(box && box.y < 48).toBe(true)
      await page.waitForTimeout(300)
      await shot(page, 'slim-dark-rail-1134')
      await expand.click()
    })

    await test.step('Hide for now folds the sponsor card for this run', async () => {
      // The first-visit "What is this page?" card floats over the card's corner: close it.
      const explainer = page.getByTestId('guide-explainer')
      if (await explainer.isVisible()) {
        await explainer.getByRole('button', { name: 'Close', exact: true }).click()
        await expect(explainer).toBeHidden()
      }
      await page.getByRole('button', { name: 'Hide for now' }).click()
      await expect(page.locator('#main > .sponsor-card-min')).toHaveCount(1)
      await page.getByRole('button', { name: /Show the FoxCue sponsor again/ }).click()
      await expect(page.locator('#main > .sponsor-card')).toHaveCount(1)
    })
  } finally {
    await close()
  }
})

/** The sponsor card stays readable: the label, the line and the call to action are visible. */
async function card(page: Page): Promise<void> {
  const sponsor = page.locator('#main > .sponsor-card')
  await sponsor.scrollIntoViewIfNeeded()
  await expect(sponsor.getByText('Sponsor', { exact: true })).toBeVisible()
  await expect(sponsor.getByRole('link', { name: /Join the waitlist at FoxCue/ })).toBeVisible()
}
