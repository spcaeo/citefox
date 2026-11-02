import { expect, test, type Page } from '@playwright/test'
import { e2eArtifact } from './artifacts'
import { SEEDED, settle } from './a11y-helpers'
import { openHash, openTwoMarketApp } from './screens-app'

/**
 * Every seeded screen at the smallest supported window (1024×700) and a
 * large one (1440×900): no sideways page scroll, and nothing pokes out past
 * the main column unless it sits in its own scroll box (wide tables do).
 */
const SIZES = [
  { width: 1024, height: 700 },
  { width: 1440, height: 900 }
] as const

interface Overflow {
  page: number
  main: number
  outside: string[]
}

async function measure(page: Page): Promise<Overflow> {
  return page.evaluate(() => {
    const root = document.documentElement
    const main = document.querySelector<HTMLElement>('#main')
    if (!main) return { page: 0, main: 0, outside: [] }
    const edge = main.getBoundingClientRect().right
    const scrolls = (node: Element): boolean => {
      for (let at = node.parentElement; at && at !== main; at = at.parentElement) {
        const x = getComputedStyle(at).overflowX
        if (x === 'auto' || x === 'scroll' || x === 'hidden' || x === 'clip') return true
      }
      return false
    }
    const outside: string[] = []
    for (const node of main.querySelectorAll('*')) {
      const box = node.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      if (box.right <= edge + 1 || scrolls(node)) continue
      if (getComputedStyle(node).position === 'fixed') continue
      const label = `${node.tagName.toLowerCase()}.${[...node.classList].join('.')}`
      outside.push(`${label} (+${Math.round(box.right - edge)}px)`)
      if (outside.length >= 5) break
    }
    return {
      page: Math.max(root.scrollWidth, document.body.scrollWidth) - root.clientWidth,
      main: main.scrollWidth - main.clientWidth,
      outside
    }
  })
}

test('seeded screens fit 1024×700 and 1440×900 without sideways scroll', async () => {
  test.setTimeout(600_000)
  const { page, close } = await openTwoMarketApp('layout')
  const problems: string[] = []
  try {
    for (const size of SIZES) {
      await page.setViewportSize(size)
      for (const entry of SEEDED) {
        await openHash(page, entry.hash)
        await expect(
          page.getByRole('heading', { level: 1, name: entry.heading }).first()
        ).toBeVisible()
        await settle(page)
        const found = await measure(page)
        if (found.page > 1 || found.main > 1 || found.outside.length > 0) {
          problems.push(
            `${entry.screen} @${size.width}: page +${found.page}px, main +${found.main}px ${found.outside.join(', ')}`
          )
        }
        await page.evaluate(() => document.querySelector('#main')?.scrollTo(0, 0))
        await page.screenshot({
          path: await e2eArtifact(`${entry.screen}-${size.width}.png`)
        })
      }
    }
  } finally {
    await close()
  }
  expect(problems).toEqual([])
})
