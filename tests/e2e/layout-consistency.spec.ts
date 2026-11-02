import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { e2eArtifact } from './artifacts'
import { settle } from './a11y-helpers'
import { openHash, openTwoMarketApp, type SeededApp } from './screens-app'

/**
 * One look on every screen (UI audit 2026-10-23, package P1): at 1440×900 the
 * h1 starts on the main column's content edge on every page tab and app
 * section, and every KPI tile is 88px tall. Each screen is measured once in
 * beforeAll; the tests below read those numbers. A check a later package
 * fixes is `test.fixme` with that package's name, so it turns on when that
 * package lands. All numbers go to test-results/e2e/layout-consistency.json.
 */
test.describe.configure({ mode: 'serial' })

const VIEWPORT = { width: 1440, height: 900 }
const KPI_HEIGHT = 88
/**
 * Results' first KPI tile top, in px from the window top (audit: 415 before
 * P1; 330 after it, plus the 20px under the title on the header's band).
 */
const RESULTS_KPI_TOP = 350

const PAGE_TABS = [
  'results',
  'progress',
  'markets',
  'sentiment',
  'communities',
  'gaps',
  'prompts',
  'audience',
  'history'
] as const

const SECTIONS = [
  { screen: 'all-pages', hash: '#/pages' },
  { screen: 'structure', hash: '#/structure' },
  { screen: 'youtube', hash: '#/youtube' },
  { screen: 'communities', hash: '#/communities' },
  { screen: 'reports', hash: '#/reports' },
  { screen: 'project-settings', hash: '#/project-settings' },
  { screen: 'connections', hash: '#/connections' },
  { screen: 'permissions', hash: '#/permissions' },
  { screen: 'settings', hash: '#/settings' },
  { screen: 'alerts', hash: '#/alerts' },
  { screen: 'templates', hash: '#/templates' },
  { screen: 'playground', hash: '#/playground' },
  { screen: 'projects', hash: '#/projects' },
  { screen: 'new-project', hash: '#/projects/new' },
  { screen: 'add', hash: '#/add' },
  { screen: 'add-page', hash: '#/add-page' },
  { screen: 'import-pages', hash: '#/import-pages' },
  { screen: 'status', hash: '#/status' },
  { screen: 'export', hash: '#/export' },
  { screen: 'check', hash: '#/check' },
  { screen: 'ask', hash: '#/ask' },
  { screen: 'running', hash: '#/pages/page-1/running' },
  { screen: 'page-read', hash: '#/pages/page-1/read' },
  { screen: 'prompt-detail', hash: '#/pages/page-1/prompt/prompt-1' }
] as const

const SCREENS: readonly { screen: string; hash: string }[] = [
  ...PAGE_TABS.map((tab) => ({ screen: `page-${tab}`, hash: `#/pages/page-1/${tab}` })),
  ...SECTIONS
]

/** h1 checks a later package makes true: screen → package and what it changes. */
const H1_LATER: Readonly<Record<string, string>> = {}

/** KPI height checks a later package makes true. */
const KPI_LATER: Readonly<Record<string, string>> = {}

interface Measure {
  screen: string
  /** Left edge of the main column's content box. */
  contentLeft: number
  h1Left: number | null
  h1Top: number | null
  headerHeight: number | null
  tabsTop: number | null
  kpiHeights: number[]
  firstKpiTop: number | null
}

const measured = new Map<string, Measure>()
let opened: SeededApp | null = null

async function measure(page: Page, screen: string): Promise<Measure> {
  const found = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>('#main')
    const visible = (node: Element): boolean => {
      const box = node.getBoundingClientRect()
      return box.width > 0 && box.height > 0
    }
    const mainBox = main?.getBoundingClientRect()
    const pad = main ? Number.parseFloat(getComputedStyle(main).paddingLeft) : 0
    const h1 = [...(main?.querySelectorAll('h1') ?? [])].find(visible)
    const header = h1?.closest('header')
    const tabs = main?.querySelector('[role="tablist"][aria-label="Page sections"]')
    const kpis = [...(main?.querySelectorAll('.ui-kpi') ?? [])].filter(visible)
    const round = (value: number): number => Math.round(value * 10) / 10
    // The header's own rows, without the padding of its section band.
    const headerStyle = header ? getComputedStyle(header) : null
    const headerPad = headerStyle
      ? Number.parseFloat(headerStyle.paddingTop) + Number.parseFloat(headerStyle.paddingBottom)
      : 0
    return {
      contentLeft: round((mainBox?.left ?? 0) + pad),
      h1Left: h1 ? round(h1.getBoundingClientRect().left) : null,
      h1Top: h1 ? round(h1.getBoundingClientRect().top) : null,
      headerHeight: header ? round(header.getBoundingClientRect().height - headerPad) : null,
      tabsTop: tabs ? round(tabs.getBoundingClientRect().top) : null,
      kpiHeights: kpis.map((node) => round(node.getBoundingClientRect().height)),
      firstKpiTop: kpis[0] ? round(kpis[0].getBoundingClientRect().top) : null
    }
  })
  return { screen, ...found }
}

test.beforeAll(async () => {
  test.setTimeout(600_000)
  opened = await openTwoMarketApp('layout-consistency')
  const { page } = opened
  await page.setViewportSize(VIEWPORT)
  for (const entry of SCREENS) {
    await openHash(page, entry.hash)
    await expect(page.locator('#main h1').first()).toBeVisible()
    await settle(page)
    await page.waitForTimeout(400)
    await page.evaluate(() => document.querySelector('#main')?.scrollTo(0, 0))
    measured.set(entry.screen, await measure(page, entry.screen))
    await page.screenshot({ path: await e2eArtifact(`layout-consistency-${entry.screen}.png`) })
  }
  await writeFile(
    await e2eArtifact('layout-consistency.json'),
    JSON.stringify([...measured.values()], null, 2)
  )
})

test.afterAll(async () => {
  await opened?.close()
})

function result(screen: string): Measure {
  const found = measured.get(screen)
  if (!found) throw new Error(`${screen} was not measured`)
  return found
}

for (const { screen } of SCREENS) {
  const later = H1_LATER[screen]
  const title = `${screen}: the h1 starts on the content edge`
  const check = (): void => {
    const found = result(screen)
    expect(found.h1Left, `${screen} has an h1`).not.toBeNull()
    expect(
      Math.abs((found.h1Left ?? 0) - found.contentLeft),
      JSON.stringify(found)
    ).toBeLessThanOrEqual(1)
  }
  if (later) test.fixme(`${title} (${later})`, check)
  else test(title, check)
}

test('the h1 starts at the same x on every screen', () => {
  const lefts = SCREENS.filter(({ screen }) => !H1_LATER[screen]).map(
    ({ screen }) => result(screen).h1Left ?? 0
  )
  expect(Math.max(...lefts) - Math.min(...lefts), lefts.join(', ')).toBeLessThanOrEqual(2)
})

for (const { screen } of SCREENS) {
  const later = KPI_LATER[screen]
  const title = `${screen}: every KPI tile is ${KPI_HEIGHT}px tall`
  const check = (): void => {
    for (const height of result(screen).kpiHeights) {
      expect(Math.abs(height - KPI_HEIGHT), `${screen}: ${height}px`).toBeLessThanOrEqual(1)
    }
  }
  if (later) test.fixme(`${title} (${later})`, check)
  else test(title, check)
}

test('page tabs: the compact page header keeps the tabs high', () => {
  for (const tab of PAGE_TABS) {
    const found = result(`page-${tab}`)
    // PageNav row (32) + gap (8) + one title row (36).
    expect(found.headerHeight, `${tab} header`).toBeLessThanOrEqual(80)
  }
})

test(`Results: the first KPI tile starts at ${RESULTS_KPI_TOP}px or higher`, () => {
  const found = result('page-results')
  expect(found.firstKpiTop).not.toBeNull()
  expect(found.firstKpiTop ?? Infinity).toBeLessThanOrEqual(RESULTS_KPI_TOP)
})
