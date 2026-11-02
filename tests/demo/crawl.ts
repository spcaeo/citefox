import type { Page } from '@playwright/test'

/**
 * The browser demo's tour (Docs/DEMO.md): every main screen, each question,
 * page and topic it links to, each report and engine, some drill drawers, the
 * help drawer, the Guide and Ctrl+K. `npm run demo:record` walks it to record
 * the answers; `npm run demo:check` walks it again on the finished build.
 */

export const REPORT_KINDS = ['visibility', 'changed', 'impact', 'pitch', 'content', 'rival']

/** Screens the tour must show with real content, and the heading each shows. */
export const MAIN_SCREENS: readonly { hash: string; heading: RegExp }[] = [
  { hash: '#/overview', heading: /^Summary$/ },
  { hash: '#/questions', heading: /^Questions$/ },
  { hash: '#/topics', heading: /^Topics$/ },
  { hash: '#/competitors', heading: /^Competitors$/ },
  { hash: '#/citations', heading: /^Citations$/ },
  { hash: '#/fixes', heading: /^Fixes$/ },
  { hash: '#/reports', heading: /^Reports$/ },
  { hash: '#/history', heading: /^Check history$/ }
]

const MORE_SCREENS = [
  '#/overview?engine=google_aio',
  '#/overview?engine=chatgpt',
  '#/overview?engine=perplexity',
  '#/questions?view=list',
  '#/topics?view=list',
  '#/citations?view=list',
  '#/fixes?view=changes',
  '#/pages',
  '#/pages?view=tree',
  '#/structure',
  '#/youtube',
  '#/communities',
  '#/ask',
  '#/project-settings',
  '#/project-settings?tab=track',
  '#/connections',
  '#/permissions',
  '#/settings',
  '#/settings?tab=email',
  '#/settings?tab=data',
  '#/alerts',
  '#/templates',
  '#/playground',
  '#/projects',
  '#/status',
  '#/reports?tab=emails',
  '#/export',
  '#/check',
  '#/start',
  '#/overview?drawer=help&help.id=summary',
  '#/reports?drawer=help&help.id=reports'
]

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
]
const TOPIC_VIEWS = ['tree', 'grid', 'list', 'pages', 'progress']
const ENGINES = ['google_aio', 'chatgpt', 'perplexity']
const PROJECT_ID = 'proj-1'

interface QuestionsAnswer {
  marketId: string | null
  rows: {
    promptId: string
    sourceId: string
    resultPromptId?: string | null
    resultPageId?: string | null
    runId?: string | null
  }[]
}

export interface CrawlOptions {
  /** Called before each step, for logs and screenshots. */
  onStep?: (name: string) => void | Promise<void>
  /** Fewer questions and drills: a quicker pass for the check. */
  quick?: boolean
  /** The app showed nothing after this step (a React error unmounted it). */
  onCrash?: (name: string) => void
}

export async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((next) => {
    window.location.hash = next
  }, hash)
}

/** Waits for loading text and spinners to go. Never throws. */
export async function settle(page: Page, ms = 400): Promise<void> {
  const main = page.locator('#main')
  for (let i = 0; i < 60; i += 1) {
    const loading = await main
      .getByText(/^Loading/)
      .count()
      .catch(() => 0)
    const busy = await page
      .locator('#main [aria-busy="true"]')
      .count()
      .catch(() => 0)
    if (loading === 0 && busy === 0) break
    await page.waitForTimeout(250)
  }
  await page.waitForTimeout(ms)
}

/** Calls the page's own bridge (window.citefox), as a screen would. Null on any error. */
async function api<T>(page: Page, channel: string, arg: unknown): Promise<T | null> {
  return page.evaluate(
    async ([name, value]) => {
      try {
        const bridge = (window as unknown as { citefox: Record<string, (a: unknown) => unknown> })
          .citefox
        return (await bridge[name as string]!(value)) as never
      } catch {
        return null
      }
    },
    [channel, arg] as const
  )
}

/** Opens up to `limit` drill numbers on this screen, one after another. */
async function drills(page: Page, limit: number): Promise<void> {
  const openers = page.locator('#main [data-nfr-drill]')
  const count = Math.min(await openers.count(), limit)
  for (let i = 0; i < count; i += 1) {
    const opener = openers.nth(i)
    if (!(await opener.isVisible().catch(() => false))) continue
    await opener.click({ timeout: 3000 }).catch(() => undefined)
    await settle(page, 250)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
  }
}

export async function crawl(page: Page, options: CrawlOptions = {}): Promise<void> {
  const step = async (name: string, run: () => Promise<void>): Promise<void> => {
    await options.onStep?.(name)
    try {
      await run()
    } catch (error) {
      console.warn(`[demo crawl] ${name}: ${error instanceof Error ? error.message : error}`)
    }
    // A screen that crashed the app: say so, and start again from the Summary.
    if ((await page.locator('#main').count()) === 0) {
      options.onCrash?.(name)
      await openHash(page, '#/overview')
      await page.reload()
      await page.waitForSelector('#main', { timeout: 30_000 }).catch(() => undefined)
    }
  }
  const visit = async (hash: string): Promise<void> => {
    await step(hash, async () => {
      await openHash(page, hash)
      await settle(page)
    })
  }

  for (const { hash } of MAIN_SCREENS) {
    await visit(hash)
    if (hash === '#/overview' || hash === '#/competitors' || hash === '#/citations') {
      await step(`${hash} drills`, () => drills(page, options.quick ? 2 : 8))
    }
  }

  // Each question, as the Questions screen opens it (the row's page or topic, market and check).
  await visit('#/questions')
  const list = await api<QuestionsAnswer>(page, 'questions:list', {
    projectId: PROJECT_ID,
    marketId: null
  })
  const questions = [
    ...new Set(
      (list?.rows ?? []).map((row) => {
        const query = new URLSearchParams()
        if (list?.marketId) query.set('market', list.marketId)
        if (row.runId) query.set('run', row.runId)
        const text = query.toString()
        return `#/pages/${encodeURIComponent(row.resultPageId ?? row.sourceId)}/prompt/${encodeURIComponent(row.resultPromptId ?? row.promptId)}${text ? `?${text}` : ''}`
      })
    )
  ]
  for (const hash of questions.slice(0, options.quick ? 3 : 400)) await visit(hash)

  // Each tracked page and its tabs.
  const pages = await api<{ pages: { id: string }[] }>(page, 'pages:list', {
    projectId: PROJECT_ID
  })
  for (const { id } of (pages?.pages ?? []).slice(0, options.quick ? 1 : 12)) {
    for (const tab of options.quick ? ['results'] : PAGE_TABS) await visit(`#/pages/${id}/${tab}`)
  }

  // Each topic and its views.
  const topics = await api<{ topics: { id: string }[] }>(page, 'topics:list', {
    projectId: PROJECT_ID
  })
  for (const { id } of (topics?.topics ?? []).slice(0, options.quick ? 1 : 6)) {
    for (const view of options.quick ? ['tree'] : TOPIC_VIEWS) {
      await visit(`#/topics/${id}?view=${view}`)
    }
  }

  // Reports: both home views, then every report on every engine, with its drills.
  await visit('#/reports')
  await step('reports: By report', async () => {
    await page.locator('#main').getByRole('tab', { name: 'By report' }).click({ timeout: 3000 })
    await settle(page)
  })
  for (const kind of REPORT_KINDS) {
    for (const engine of options.quick ? [null] : [null, ...ENGINES]) {
      await visit(`#/reports?report=${kind}${engine ? `&engine=${engine}` : ''}`)
    }
    await step(`report ${kind} drills`, () => drills(page, options.quick ? 1 : 6))
  }

  // The main screens on each engine.
  if (!options.quick) {
    for (const { hash } of MAIN_SCREENS) {
      for (const engine of ENGINES) await visit(`${hash}?engine=${engine}`)
    }
  }

  for (const hash of options.quick ? MORE_SCREENS.slice(-2) : MORE_SCREENS) await visit(hash)

  // Ctrl+K and the Guide.
  await visit('#/overview')
  await step('Ctrl+K', async () => {
    await page.keyboard.press('Control+k')
    await page.waitForTimeout(400)
    await page.keyboard.type('report')
    await page.waitForTimeout(500)
    await page.keyboard.press('Escape')
  })
  await step('Guide', async () => {
    const guide = page.getByRole('button', { name: /^(Guide|Start the guide|Resume guide)/ })
    if ((await guide.count()) > 0) {
      await guide.first().click({ timeout: 3000 })
      await settle(page)
      await page.keyboard.press('Escape')
    }
  })
}
