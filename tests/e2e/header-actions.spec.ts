import { expect, test, type Page } from '@playwright/test'
import { openHash, openTwoMarketApp, shot } from './screens-app'

/**
 * The header action rules (Docs/HEADER.md) on the AI visibility and tracking
 * screens: at most one green button in a screen's header, actions on the
 * right, no fox-orange text links in the content, and no sideways scroll.
 * Light and dark at 1134 and 1440 wide; screenshots land in
 * test-results/e2e/head-*.png.
 */

// The seeded TextBolt page (screens-seed SEED.pageId; that module loads only at run time).
const page1 = '#/pages/page-1'

const SCREENS: readonly (readonly [string, string])[] = [
  ['summary', '#/overview'],
  ['questions', '#/questions'],
  ['topics', '#/topics'],
  ['competitors', '#/competitors'],
  ['citations', '#/citations'],
  ['fixes', '#/fixes'],
  ['history', '#/history'],
  ['reports', '#/reports'],
  ['export', '#/export'],
  ['alerts', '#/alerts'],
  ['communities', '#/communities'],
  ['youtube', '#/youtube'],
  ['page-results', `${page1}/results`],
  ['page-progress', `${page1}/progress`],
  ['page-markets', `${page1}/markets`],
  ['page-sentiment', `${page1}/sentiment`],
  ['page-communities', `${page1}/communities`],
  ['page-history', `${page1}/history`]
]

async function settle(page: Page): Promise<void> {
  await expect(page.getByText(/^(Loading|Opening)/)).toHaveCount(0, { timeout: 15_000 })
  await page.waitForTimeout(300)
}

interface HeaderFacts {
  greens: number
  sideways: number
  orange: string[]
}

/** The first header in main: its green buttons; main's sideways scroll; fox-coloured links in main. */
async function facts(page: Page): Promise<HeaderFacts> {
  return page.evaluate(() => {
    const main = document.querySelector('#main') as HTMLElement
    const header = main.querySelector('header')
    const probe = document.createElement('span')
    probe.style.color = 'var(--fox)'
    main.append(probe)
    const fox = getComputedStyle(probe).color
    probe.style.color = 'var(--fox-ink)'
    const foxInk = getComputedStyle(probe).color
    probe.remove()
    const links = [...main.querySelectorAll<HTMLElement>('a, .ui-btn-text')].filter((node) => {
      if (node.closest('.sponsor-card') || node.getClientRects().length === 0) return false
      const color = getComputedStyle(node).color
      return color === fox || color === foxInk
    })
    return {
      greens: header ? header.querySelectorAll('.ui-btn-primary').length : 0,
      sideways: Math.max(
        main.scrollWidth - main.clientWidth,
        document.documentElement.scrollWidth - document.documentElement.clientWidth
      ),
      orange: links.map((node) => `${node.className || node.tagName}: ${node.textContent ?? ''}`)
    }
  })
}

test('header actions: one green button, ⋯ for the rest, green links, no sideways scroll', async () => {
  test.setTimeout(600_000)
  const { page, close } = await openTwoMarketApp('head-actions')
  try {
    // Prompt detail: the first prompt on the page's results.
    await openHash(page, `${page1}/results`)
    await settle(page)
    const promptHref = await page.locator('#main a[href*="/prompt/"]').first().getAttribute('href')
    const screens = promptHref ? [...SCREENS, ['prompt', promptHref] as const] : SCREENS

    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((next) => {
        document.documentElement.dataset.theme = next
      }, theme)
      for (const width of [1134, 1440]) {
        await test.step(`${theme} at ${width}`, async () => {
          await page.setViewportSize({ width, height: 860 })
          for (const [name, hash] of screens) {
            await openHash(page, hash)
            await settle(page)
            const found = await facts(page)
            expect.soft(found.greens, `${name}: green buttons in the header`).toBeLessThanOrEqual(1)
            expect.soft(found.sideways, `${name}: sideways scroll`).toBeLessThanOrEqual(1)
            expect.soft(found.orange, `${name}: fox-orange links`).toEqual([])
            await shot(page, `head-${theme}-${name}-${width}`)
          }
        })
      }
    }

    await test.step('the header ⋯ opens with its items on the right', async () => {
      await page.setViewportSize({ width: 1440, height: 860 })
      await openHash(page, '#/questions')
      await settle(page)
      await page.locator('#main header').getByRole('button', { name: 'More actions' }).click()
      await expect(page.getByRole('menuitem', { name: 'Import from Excel or CSV' })).toBeVisible()
      await shot(page, 'head-dark-questions-menu-1440')
      await page.keyboard.press('Escape')
    })
  } finally {
    await close()
  }
})
