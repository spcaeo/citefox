import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { leaveFirstRun } from './first-run-helpers'
import { onboardTextBolt } from './journey-app'

/**
 * Production-shell journey on the recorded textbolt fixture.
 * Numbers are the hand-worked SRS §7 values in
 * src/main/pipeline/textbolt.integration.test.ts (not the screen).
 *
 * Score 56 = round(15 / 27 × 100). Points: page cited 4×3, other own page 2×1,
 * brand mentioned 1×1. AIOs = 9 (one prompt has no overview).
 * Outcomes: page cited 4, other own page 2, brand mentioned 1, not cited 2, no AIO 1.
 * Cited and named 3. Average position of this page = mean(2, 1, 3, 1) = 1.75.
 * The comparison cell formats that IPC value with toFixed(1), which is "1.8".
 * Funnel 10 / 9 / 6 / 4 / 3. Citation rate 44% (4 of 9).
 * Own-domain links: 4 to this page + 3 to other textbolt.com pages (prompt 10 cites both).
 * Citation rows: 17 references across the ten SERP fixtures (serp-06 has none).
 * Target URL is the normalized blog URL (utm and fragment stripped).
 */

const ROOT = process.cwd()
const FIXTURE_DIR = path.join(ROOT, 'src/main/providers/fixtures/textbolt')
const ACCOUNT_FIXTURE = path.join(ROOT, 'src/main/providers/fixtures/serpapi/account-ok.json')
const JINA_FIXTURE = path.join(ROOT, 'src/main/pipeline/fixtures/textbolt-jina.json')
const SHIM = path.join(ROOT, 'tests/e2e/claude-shim.mjs')
/** Same ten questions as TEXTBOLT_PROMPTS_EN in src/main/pipeline/textbolt-fixture.ts. */
const PROMPTS = [
  'How can I send text alerts to my employees without hiring a developer or learning a new app?',
  'Is there a way to schedule a text message to my whole team from Gmail or Outlook?',
  'Our monitoring tool only sends email alerts. How do I get those as text messages on my phone?',
  "My email-to-text through txt.att.net stopped working. What's the best replacement for business alerts?",
  'Verizon is shutting down vtext.com. What should a small business switch to so our automated alerts keep reaching phones?',
  "What's the easiest way to turn emails from our scheduling software into SMS reminders for customers and staff?",
  'Do I need 10DLC registration to send text alerts to my own employees, and is there a service that handles it for me?',
  "What's a cheap alternative to Twilio for sending business text alerts if we don't have developers?",
  "How do I send a text to my field techs early Saturday morning when I'm writing the update Friday afternoon?",
  'Can employees reply to an automated business text alert and have the reply come back to my email?'
]
const TEXTBOLT_URL = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'
const TEXTBOLT_TITLE = 'How to Set Up Text Alerts for Business (2026) | TextBolt'
const TEXTBOLT_H1 =
  'How to Set Up Text Alerts for Business, Including Scheduled Alerts From Email (No Developer Required)'
const PAGE_PATH = 'textbolt.com/blog/how-to-set-up-text-alerts-for-business/'
/** The cited page; the Sources grid shows it as a path under its site. */
const CITED_PATH = '/blog/how-to-set-up-text-alerts-for-business'
const CITATION_ROWS = 17
const TARGET_ROWS = 4
const SERP_KEY = 'serp-fixture-key-textbolt'
/** extractJinaBody(textbolt-jina.json): 10 FAQ headings, 4,860 words. */
const FAQ_COUNT = 10
const WORD_LABEL = '4,860 words'

test('full journey on the textbolt fixture through the production shell', async () => {
  test.setTimeout(300_000)
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-journey-'))
  const bin = path.join(dir, 'bin')
  await mkdir(bin, { recursive: true })
  const claude = path.join(bin, 'claude')
  await writeFile(claude, `#!/bin/sh\nexec node ${JSON.stringify(SHIM)} "$@"\n`)
  await chmod(claude, 0o755)
  const shimLog = path.join(dir, 'claude-shim.log')

  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1280, height: 900 },
    env: {
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      CITEFOX_FIXTURE_DIR: FIXTURE_DIR,
      CITEFOX_SHIM_LOG: shimLog,
      // Onboarding's "Read my website" reads fixed TextBolt pages, never the network.
      CITEFOX_E2E_TOPICS: '1'
    }
  })

  try {
    await installFixtureFetch(app, PROMPTS)
    await expectRealIpc(page)

    await test.step('onboarding creates the TextBolt project', async () => {
      // The nine setup steps on the shim and the fixtures (tests/e2e/setup-walk.ts).
      await onboardTextBolt(page, {
        serpKey: SERP_KEY,
        onStep: async (step) => {
          if (step !== 'engines') return
          // account-ok.json: this_month_usage 38, searches_per_month 250, plan_name Developer.
          const serpStatus = page.locator('#s7-key-message')
          await expect(serpStatus).toContainText('Key works')
          await expect(serpStatus).toContainText('38')
          await expect(serpStatus).toContainText('Developer')
        }
      })
      await leaveFirstRun(page)
      await expect(
        page.getByRole('button', { name: 'Switch project, TextBolt textbolt.com' })
      ).toBeVisible()
    })

    await test.step('add the textbolt page: setup runs by itself', async () => {
      await expect(page.getByRole('heading', { name: 'Markets' })).toBeVisible()
      await expect(page.getByText('1 market', { exact: true })).toBeVisible()
      await expect(page.getByLabel('Number of buyer questions')).toHaveValue('10')
      await page.getByLabel('Page URL').fill(TEXTBOLT_URL)
      await page.getByRole('button', { name: 'Add page' }).click()
      // Owner feedback 5: setup is automatic. This launch keeps the runner off, so
      // Start setup runs this page now: read, profile, prompts, content gaps.
      await expect(page).toHaveURL(/\/prompts$/)
      const setup = page.getByRole('region', { name: 'Setting up this page' })
      await setup.getByRole('button', { name: 'Start setup' }).click()
      const grid = page.getByRole('grid', { name: 'Buyer questions' })
      await expect(grid.locator('.ui-lg-row')).toHaveCount(10, { timeout: 90_000 })
    })

    await test.step('the read and the ten prompts are stored', async () => {
      await expect(page.getByText(PROMPTS[0] ?? '')).toBeVisible()
      await expect(page.getByText(/Operations managers, office managers/)).toBeVisible()
      await page.evaluate(() => {
        window.location.hash = window.location.hash.replace(/\/prompts$/, '/read')
      })
      await expect(
        page.getByRole('heading', { level: 1, name: 'Check what CiteFox read' })
      ).toBeVisible()
      await expect(page.getByText(TEXTBOLT_TITLE).first()).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText('CiteFox has not read this page yet.')).toHaveCount(0)
      await expect(page.getByText(TEXTBOLT_H1)).toBeVisible()
      await expect(page.getByRole('heading', { name: `FAQs found (${FAQ_COUNT})` })).toBeVisible()
      await expect(page.getByText(WORD_LABEL)).toBeVisible()
      await page.evaluate(() => {
        window.location.hash = window.location.hash.replace(/\/read$/, '/prompts')
      })
      await expect(page.getByRole('grid', { name: 'Buyer questions' })).toBeVisible()
    })

    await test.step('run the first check on the recorded searches', async () => {
      await page.getByRole('link', { name: 'Check now' }).click()
      await expect(page.getByRole('heading', { level: 1, name: 'First check' })).toBeVisible()
      await expect(page.getByText('No check is running.')).toBeVisible()
      await expect(page.getByText('1 market')).toBeVisible()
      await expect(page.getByRole('link', { name: 'First check' })).toHaveAttribute(
        'aria-current',
        'step'
      )
      const start = page.getByRole('button', { name: 'Start first check' })
      await expect(start).toBeVisible()
      await expect(start).toBeEnabled()
      await start.focus()
      await expect(start).toBeFocused()
      await shot(page, 'first-check-idle')
      await start.click()
      await expect(page.getByRole('button', { name: 'Start first check' })).toHaveCount(0)
      const bar = page.getByRole('progressbar', { name: 'Questions checked' })
      const grid = page.getByRole('grid', { name: 'Questions in the market being checked' })
      await expect(bar).toBeVisible({ timeout: 90_000 })
      await expect
        .poll(
          async () => {
            const now = await bar.getAttribute('aria-valuenow')
            const rows = await grid.getAttribute('aria-rowcount')
            // aria-rowcount counts the header row too.
            return now === '0' && rows === '11'
          },
          { timeout: 90_000 }
        )
        .toBe(true)
      await expect(
        page.getByRole('heading', { level: 1, name: /Checking 10 questions? in 1 markets?/ })
      ).toBeVisible()
      // The live line under the grid may name the same prompt while it is searched.
      await expect(grid.getByText(PROMPTS[0] ?? '')).toBeVisible()
      await expect(page.getByText('Waiting').first()).toBeVisible()
      await expect(page.getByText('Market being checked now')).toBeVisible()
      await expect(page.getByText(/searches used so far, up to/)).toBeVisible()
      await expect(page.getByText('No check is running.')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Start first check' })).toHaveCount(0)
      await shot(page, 'first-check-progress')
      const finishedHeading = page.getByRole('heading', { level: 1, name: 'Check finished' })
      await expect(finishedHeading).toBeVisible({ timeout: 180_000 })
      expect(await finishedHeading.evaluate((node) => node.textContent)).toBe('Check finished')
      await expect(page.getByText('Market being checked now')).toHaveCount(0)
      await expect(page.locator('.m3-now-label')).toHaveText('Checked')
      await expect(page.getByText(/11 searches used, up to 20/)).toBeVisible()
      await expect(page.getByText(/searches used so far/)).toHaveCount(0)
      await expect(page.getByText('No check is running.')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Start first check' })).toHaveCount(0)
      const viewResults = page.getByRole('link', { name: 'View results', exact: true })
      await expect(viewResults).toBeVisible()
      await expect(viewResults).toBeFocused()
      await expect(viewResults).toHaveAttribute('href', /\/results$/)
      await shot(page, 'first-check-finished')
      const ids = await projectAndPage(page)
      await expect
        .poll(async () => (await readResults(page, ids)).score, { timeout: 30_000 })
        .toBe(56)
      const engine = await readResults(page, ids)
      expect(engine.score).toBe(56)
      expect(engine.statuses).toEqual([
        'page_cited',
        'page_cited',
        'other_own_page',
        'brand_mentioned',
        'not_cited',
        'no_aio',
        'page_cited',
        'other_own_page',
        'not_cited',
        'page_cited'
      ])
      expect(engine.averagePosition).toBe(1.75)
      expect(engine.funnel).toEqual([10, 9, 6, 4, 3])
      expect(engine.citedAndNamed).toBe(3)
      await viewResults.click()
    })

    await test.step('results show the fixture score, outcomes, and funnel', async () => {
      const results = page.locator('#m3-results-top')
      await expect(results.getByRole('heading', { name: 'What this report covers' })).toBeVisible()
      // The report headline (reportHeadline) also says "of your 10 buyer prompts".
      await expect(results.locator('.m3-scope').getByText(/10 buyer questions?/)).toBeVisible()
      await expect(results.getByText(/^Google shows an AI Overview for 9 of your /)).toBeVisible()
      // The page path sits once, in the page header above the tabs.
      await expect(page.getByRole('main').getByText(PAGE_PATH, { exact: true })).toBeVisible()
      // KPI labels come from REPORT_KPI_LABELS (src/shared/report-copy.ts).
      const kpis = results.getByRole('region', { name: 'Headline numbers' })
      await expect(kpis.getByRole('button', { name: /^Visibility score \d/ })).toContainText('56')
      await expect(kpis.getByRole('region', { name: 'This page cited' })).toContainText('4')
      await expect(kpis.getByRole('region', { name: 'This page cited' })).toContainText('of 9')
      await expect(kpis.getByRole('region', { name: 'Citations (links)' })).toContainText('7')
      await expect(results.getByText('4 to this page')).toBeVisible()
      await expect(results.getByText(/3 to other textbolt\.com pages?/)).toBeVisible()
      await expect(kpis.getByRole('region', { name: 'AI Overview appears' })).toContainText('9')
      await expect(kpis.getByRole('region', { name: 'AI Overview appears' })).toContainText('of 10')
      const sections = page.getByRole('tablist', { name: 'Results sections' })
      await sections.getByRole('tab', { name: /^Breakdown/ }).click()
      const funnel = page.locator('#m3-funnel')
      await expect(funnel.getByRole('button', { name: /Questions checked/ })).toContainText(
        /10 questions?/
      )
      await expect(funnel.getByRole('button', { name: /textbolt\.com cited/ })).toContainText(
        '6 of 10'
      )
      await expect(funnel.getByRole('button', { name: /This page cited/ })).toContainText('4 of 10')
      await expect(
        funnel.getByRole('button', { name: /Cited and named in the text/ })
      ).toContainText('3 of 10')
      await expect(
        funnel.getByRole('button', { name: /−1 lost here · No AI Overview/ })
      ).toBeVisible()
      await expect(
        funnel.getByRole('button', {
          name: /−3 lost here · The overview did not cite your domain/
        })
      ).toBeVisible()
      await expect(
        funnel.getByRole('button', {
          name: /−2 lost here · The overview cited another page on your domain/
        })
      ).toBeVisible()
      await expect(
        funnel.getByRole('button', {
          name: /−1 lost here · This page was cited without the brand name/
        })
      ).toBeVisible()
      const opportunities = page.locator('#m3-opportunities')
      await expect(
        // The bar is a group of drill buttons, one per outcome segment.
        opportunities.getByRole('group', {
          name: 'Opportunities bar: 4 Cited · named, 2 Cited · not named, 1 Not cited · named, 2 Not cited'
        })
      ).toBeVisible()
      await expect(opportunities.getByText(/4 \+ 2 \+ 1 \+ 2 = 9 AI Overviews/)).toBeVisible()
      const summary = results.getByRole('region', { name: 'Summary' })
      await expect(summary).toContainText(
        '9 AIOs shown, 4 page cited, 2 other own page, 1 named without a link, 2 invisible.'
      )
      // Five counts, then Claude's headline leading the body in bold (P6).
      await expect(summary.locator('strong')).toHaveCount(6)
      await expect(
        summary.locator('strong').filter({ hasText: 'Counts stay with the stored check.' })
      ).toHaveCount(1)
      await expect(summary.locator('strong').nth(0)).toHaveText('9')
      await expect(summary.locator('strong').nth(1)).toHaveText('4')
      expect(await summary.innerText()).not.toContain('**')
      await summary.scrollIntoViewIfNeeded()
      await summary.screenshot({ path: await e2eArtifact('summary-emphasis.png') })
      await expect(
        results.getByText(/Current citation rate: 44% \(4 of 9 AIOs shown\)/)
      ).toBeVisible()
      await sections.getByRole('tab', { name: /^Questions/ }).click()
      const prompts = page.getByRole('grid', { name: /Buyer questions from the/ })
      // Ten prompt rows under their outcome group headers, all painted in one view.
      await expect(prompts.locator('.ui-lg-row')).toHaveCount(10)

      await sections.getByRole('tab', { name: /^Checks/ }).click()
      const position = page
        .locator('#m3-baseline')
        .getByRole('row', { name: /Average position of this page/ })
      // Cells: Metric, Baseline, Previous, Current, Change.
      const shown = (await position.getByRole('gridcell').nth(3).innerText()).trim()
      const averagePosition = (await readResults(page, await projectAndPage(page))).averagePosition
      expect(averagePosition).toBe(1.75)
      if (averagePosition === null) throw new Error('average position missing')
      expect(shown).toBe(averagePosition.toFixed(1))
      await sections.getByRole('tab', { name: /^Questions/ }).click()
      await shot(page, 'full-journey-results')
    })

    await test.step('citations list every recorded link', async () => {
      // The Results tab draws "Citations (links)" once, as a headline tile; the
      // citations section below it keeps only "Sources Google listed".
      await expect(
        page
          .getByRole('region', { name: 'Headline numbers' })
          .getByRole('region', { name: 'Citations (links)' })
      ).toContainText(/\b7 links/)
      await page
        .getByRole('tablist', { name: 'Results sections' })
        .getByRole('tab', { name: /^Who gets cited/ })
        .click()
      const sources = page.getByRole('heading', { name: 'Sources Google listed' })
      await sources.scrollIntoViewIfNeeded()
      const grid = page.getByRole('grid', { name: 'Sources Google listed' })
      await expect(grid).toHaveAttribute('aria-rowcount', String(CITATION_ROWS + 1))
      await expectGridCovers(grid, CITATION_ROWS)
      await page
        .getByRole('group', { name: 'Source type' })
        .getByRole('button', { name: 'This page' })
        .click()
      await expect(grid).toHaveAttribute('aria-rowcount', String(TARGET_ROWS + 1))
      await expect(
        grid.getByRole('link', { name: `Open ${CITED_PATH} in a new tab` }).first()
      ).toHaveAttribute('href', new RegExp(`^https://textbolt\\.com${CITED_PATH}`))
      await expectGridCovers(grid, TARGET_ROWS)
      await shot(page, 'full-journey-citations')
    })

    await test.step('scores show the 44% citation rate for the one market', async () => {
      await page.getByRole('tab', { name: 'Progress', exact: true }).click()
      await expect(
        page.getByRole('heading', { name: 'How often overviews cite this page' })
      ).toBeVisible()
      await expect(page.getByText('44%', { exact: true })).toBeVisible()
      await expect(page.getByText(/Page cited in 4 of 9 AI Overviews? shown/)).toBeVisible()
      await expect(page.getByText(/Visibility score 56/)).toBeVisible()
      await expect(
        page.getByRole('group', {
          name: /4 page cited and 5 not page cited, 9 AI Overviews?/
        })
      ).toBeVisible()
      await shot(page, 'full-journey-scores')
    })
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})

async function expectRealIpc(page: Page): Promise<void> {
  const probe = await page.evaluate(async () => {
    const bridge = (window as unknown as { citefox?: CiteFoxBridge }).citefox
    const stored = localStorage.getItem('citefox.client')
    const info = bridge ? await bridge['app:getInfo']() : null
    return {
      stored,
      bridged: typeof bridge?.['app:getInfo'] === 'function',
      name: info?.name ?? null
    }
  })
  expect(probe.stored).toBeNull()
  expect(probe.bridged).toBe(true)
  expect(probe.name).toBe('CiteFox')
}

async function projectAndPage(page: Page): Promise<{ projectId: string; pageId: string }> {
  return page.evaluate(async () => {
    const bridge = (window as unknown as { citefox: CiteFoxBridge }).citefox
    const projects = await bridge['projects:list']()
    const projectId = projects.activeProjectId
    if (projectId === null) throw new Error('No active project')
    const pages = await bridge['pages:list']({ projectId })
    const pageId = pages.pages[0]?.id
    if (pageId === undefined) throw new Error('No page')
    return { projectId, pageId }
  })
}

async function readResults(
  page: Page,
  ids: { projectId: string; pageId: string }
): Promise<{
  score: number | null
  statuses: string[]
  averagePosition: number | null
  funnel: number[]
  citedAndNamed: number
}> {
  return page.evaluate(async ({ projectId, pageId }) => {
    const bridge = (window as unknown as { citefox: CiteFoxBridge }).citefox
    const results = await bridge['results:get']({
      projectId,
      pageId,
      marketId: null,
      runId: null
    })
    const named = results.prompts.filter((row) => row.status === 'page_cited' && row.named === true)
    return {
      score: results.run?.visibilityScore ?? null,
      statuses: results.prompts.map((row) => row.status),
      averagePosition: results.run?.averagePosition ?? null,
      funnel: results.funnel.map((step) => step.count),
      citedAndNamed: named.length
    }
  }, ids)
}

async function paintedRows(grid: Locator): Promise<string[]> {
  return grid
    .locator('[data-row]')
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute('data-row') ?? '').filter((index) => index !== '')
    )
}

/**
 * A list grid only paints a slice. Scroll until every data-row index exists.
 * Its aria-rowcount counts the header row too.
 */
async function expectGridCovers(grid: Locator, count: number): Promise<void> {
  await expect(grid).toHaveAttribute('aria-rowcount', String(count + 1))
  await grid.evaluate((node) => {
    node.scrollTop = 0
  })
  const seen = new Set<string>()
  let stuck = 0
  for (let guard = 0; guard < 30 && seen.size < count; guard += 1) {
    const batch = await paintedRows(grid)
    for (const index of batch) seen.add(index)
    if (seen.size === count) break
    const moved = await grid.evaluate((node) => {
      const next = Math.min(node.scrollTop + Math.max(node.clientHeight - 8, 1), node.scrollHeight)
      if (next === node.scrollTop) return false
      node.scrollTop = next
      return true
    })
    if (!moved) {
      stuck += 1
      if (stuck > 2) break
      continue
    }
    stuck = 0
    const signature = batch.join(',')
    await expect.poll(async () => (await paintedRows(grid)).join(',')).not.toBe(signature)
  }
  expect([...seen].sort((left, right) => Number(left) - Number(right))).toEqual(
    Array.from({ length: count }, (_, index) => String(index))
  )
}

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => {
    document.querySelector('#main')?.scrollTo(0, 0)
  })
  await page.screenshot({ path: await e2eArtifact(`${name}.png`), fullPage: false })
}

async function installFixtureFetch(
  app: Awaited<ReturnType<typeof launchCiteFox>>['app'],
  prompts: readonly string[]
): Promise<void> {
  const serp: Record<string, { status: number; body: string }> = {}
  for (const name of readdirSync(FIXTURE_DIR)) {
    if (!name.startsWith('serp-')) continue
    const file = JSON.parse(readFileSync(path.join(FIXTURE_DIR, name), 'utf8')) as {
      status: number
      body: unknown
    }
    serp[name] = { status: file.status, body: JSON.stringify(file.body) }
  }
  const account = JSON.parse(readFileSync(ACCOUNT_FIXTURE, 'utf8')) as {
    status: number
    body: unknown
  }
  await app.evaluate(
    async (
      _electron,
      config: {
        jinaBody: string
        accountStatus: number
        accountBody: string
        serp: Record<string, { status: number; body: string }>
        prompts: readonly string[]
      }
    ) => {
      const original = globalThis.fetch.bind(globalThis)
      const respond = (status: number, body: string): Response =>
        new Response(body, { status, headers: { 'content-type': 'application/json' } })
      globalThis.fetch = async (
        input: RequestInfo | URL,
        init?: RequestInit
      ): Promise<Response> => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.startsWith('https://r.jina.ai/')) return respond(200, config.jinaBody)
        if (url.startsWith('https://serpapi.com/account')) {
          return respond(config.accountStatus, config.accountBody)
        }
        if (url.startsWith('https://serpapi.com/')) {
          await new Promise((resolve) => setTimeout(resolve, 200))
          const parsed = new URL(url)
          let name: string
          if (parsed.searchParams.get('engine') === 'google_ai_overview') name = 'serp-01-aio.json'
          else {
            const query = parsed.searchParams.get('q') ?? ''
            const index = config.prompts.indexOf(query)
            if (index === 0) name = 'serp-01-token.json'
            else if (index > 0) name = `serp-${String(index + 1).padStart(2, '0')}.json`
            // Any other question (onboarding's first check) gets one recorded answer.
            else name = 'serp-02.json'
          }
          const file = config.serp[name]
          if (file === undefined) {
            return respond(500, JSON.stringify({ error: 'no serp fixture', url }))
          }
          return respond(file.status, file.body)
        }
        return original(input, init)
      }
    },
    {
      jinaBody: readFileSync(JINA_FIXTURE, 'utf8'),
      accountStatus: account.status,
      accountBody: JSON.stringify(account.body),
      serp,
      prompts
    }
  )
}

interface CiteFoxBridge {
  'app:getInfo'(): Promise<{ name: string }>
  'projects:list'(): Promise<{ activeProjectId: string | null }>
  'pages:list'(request: { projectId: string }): Promise<{ pages: readonly { id: string }[] }>
  'results:get'(request: {
    projectId: string
    pageId: string
    marketId: string | null
    runId: string | null
  }): Promise<{
    run: { visibilityScore: number | null; averagePosition: number | null } | null
    prompts: readonly { status: string; named: boolean | null }[]
    funnel: readonly { count: number }[]
  }>
}
