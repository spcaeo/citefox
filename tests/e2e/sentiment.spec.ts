import type { CiteFoxApi } from '@shared/ipc'
import type { SentimentView } from '@shared/domain'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { drawerShots } from './drawer-helpers'
import { launchCiteFox } from './launch'
import { installRawMarkdown } from './raw-hook'
import { expectMainAccessible, shot } from './screens-app'
import { openAllPages } from './nav-helpers'

/**
 * The Sentiment tab on real IPC: a project seeded through the production
 * handlers with recorded SerpApi bodies and recorded Claude readings, then the
 * production app with the Claude Code stand-in on PATH for "Re-read saved
 * overviews". No network, no real Claude, a temp data folder.
 */

const ROOT = process.cwd()
const SHIM = path.join(ROOT, 'tests/e2e/claude-shim.mjs')
const FIXTURE_DIR = path.join(ROOT, 'src/main/providers/fixtures/textbolt')
const FACT = 'TextBolt plans start at $29 a month.'

async function readView(page: Page): Promise<SentimentView> {
  return page.evaluate(async () => {
    const api = (globalThis as typeof globalThis & { citefox: CiteFoxApi }).citefox
    return api['sentiment:get']({ projectId: 'proj-1', pageId: 'page-1', marketId: 'mkt-us' })
  })
}

/** Opens one of the Sentiment tab's section tabs (Overview, Answers, Themes, Problems, Facts). */
async function showSection(tab: Locator, name: RegExp): Promise<void> {
  await tab.getByRole('tab', { name }).click()
  await expect(tab.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true')
}

function ownCounts(view: SentimentView): { total: number; net: number | null } {
  const own = view.claims.filter((claim) => claim.isOwn)
  const positive = own.filter((claim) => claim.tone === 'positive').length
  const negative = own.filter((claim) => claim.tone === 'negative').length
  const total = own.length
  return { total, net: total < 5 ? null : Math.round(((positive - negative) / total) * 100) }
}

function netText(net: number | null): string {
  if (net === null) return 'Not enough data'
  if (net > 0) return `+${net}`
  if (net < 0) return `−${Math.abs(net)}`
  return '0'
}

test('the Sentiment tab shows claims, drills to them, and re-reads with a new brand fact', async () => {
  test.setTimeout(240_000)
  installRawMarkdown()
  const { seedSentimentProject } = await import('./sentiment-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-sentiment-'))
  await seedSentimentProject(dir)
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
      CITEFOX_SHIM_LOG: shimLog
    }
  })
  try {
    await openAllPages(page)
    await page.locator('#main').getByRole('link', { name: 'Alerts', exact: true }).first().click()
    await page.getByRole('tab', { name: 'Sentiment', exact: true }).click()
    const tab = page.getByTestId('sentiment-tab')
    await expect(tab).toBeVisible()
    await expect(page.getByText('Not available yet.')).toHaveCount(0)

    const view = await readView(page)
    expect(view.trend).toHaveLength(3)
    expect(view.claims.length).toBeGreaterThan(0)
    const { total, net } = ownCounts(view)

    await test.step('net sentiment drills to exactly the claims behind it (NFR-14)', async () => {
      const kpis = tab.getByRole('region', { name: 'Sentiment summary' })
      const netButton = kpis.getByRole('button', {
        name: `Net sentiment ${netText(net)} from ${total} claims, show them`
      })
      await expect(netButton).toBeVisible()
      await netButton.click()
      const drawer = page.getByRole('dialog')
      await expect(
        drawer.getByRole('heading', {
          name: `Claims about TextBolt · ${total} ${total === 1 ? 'claim' : 'claims'}`
        })
      ).toBeVisible()
      await expect(drawer.locator('[data-drill-row]')).toHaveCount(total)
      await shot(page, 'sentiment-drawer')
      await drawer.getByRole('button', { name: 'Close' }).first().click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
    })

    await test.step('every check on the trend drills to the claims it counts', async () => {
      const trend = tab.getByRole('region', { name: 'Net sentiment over time' })
      const drawer = page.getByRole('dialog')
      for (const point of view.trend) {
        const count = point.positive + point.neutral + point.negative
        const ids =
          point.runId === view.latestRunId
            ? view.claims.filter((claim) => claim.isOwn).map((claim) => claim.id)
            : view.earlierClaims.filter((claim) => claim.runId === point.runId)
        expect(ids).toHaveLength(count)
        const button = trend.locator(`button[data-nfr-drill="trend:${point.runId}"]`)
        await expect(button.locator('[data-nfr-figure]')).toHaveText(String(count))
        await button.click()
        await expect(drawer.locator('[data-drill-row]')).toHaveCount(count)
        await page.keyboard.press('Escape')
        await expect(drawer).toHaveCount(0)
      }
    })

    await test.step('a buyer claim opens Prompt detail in its market and check', async () => {
      const buyer = view.claims.find((claim) => claim.isOwn && claim.source === 'buyer')
      if (buyer) {
        await tab
          .getByRole('region', { name: 'Sentiment summary' })
          .getByRole('button', { name: /^Net sentiment/ })
          .click()
        const drawer = page.getByRole('dialog')
        const href = `#/pages/page-1/prompt/${encodeURIComponent(buyer.promptId)}?market=${buyer.marketId}&run=${encodeURIComponent(buyer.runId)}`
        const link = drawer.locator(`a[href="${href}"]`).first()
        await expect(link).toBeVisible()
        await link.click()
        await expect(page).toHaveURL(/#\/pages\/page-1\/prompt\//)
        await page.evaluate(() => {
          window.location.hash = '#/pages/page-1/sentiment'
        })
        await expect(tab).toBeVisible()
      }
    })

    await test.step('every section of the mock-up is drawn from the stored claims', async () => {
      await expect(tab.getByRole('heading', { name: 'Tone split' })).toBeVisible()
      await expect(tab.getByRole('heading', { name: 'Net sentiment over time' })).toBeVisible()
      await expectMainAccessible(page)
      await shot(page, 'sentiment-top')

      await showSection(tab, /^Answers/)
      await expect(tab.getByRole('heading', { name: 'Answer by answer' })).toBeVisible()
      await expectMainAccessible(page)
      await shot(page, 'sentiment-answers')
      const rank = tab.getByRole('button', { name: /^Rank #\d+ of \d+ brands? named: show/ })
      if ((await rank.count()) > 0) {
        await rank.first().click()
        const answer = page.getByTestId('st-answer-drawer')
        await expect(answer).toContainText('Brands named, in rank order')
        await expect(page).toHaveURL(/drawer=st-answer&sa\.id=/)
        const link = await page.evaluate(() => window.location.hash)
        await shot(page, 'sentiment-answer-panel')
        await drawerShots(page, 'sentiment-answer')
        // Escape closes it and the URL loses it; Back after reopening closes it too.
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog')).toHaveCount(0)
        await expect(page).not.toHaveURL(/st-answer/)
        await rank.first().click()
        await expect(answer).toBeVisible()
        await page.goBack()
        await expect(answer).toHaveCount(0)
        // A copied link opens it again.
        await page.evaluate((hash) => {
          window.location.hash = hash
        }, link)
        await expect(answer).toContainText('Sources Google listed')
        await answer
          .getByRole('button', { name: /^Close / })
          .first()
          .click()
        await expect(answer).toHaveCount(0)
      }

      await showSection(tab, /^Themes/)
      await expect(
        tab.getByRole('heading', { name: /^What the overviews say about/ })
      ).toBeVisible()
      await expect(page).toHaveURL(/view=themes/)
      await expect(tab.getByRole('heading', { name: /by theme/ })).toBeVisible()
      await expectMainAccessible(page)
      await shot(page, 'sentiment-themes')
      const themeButton = tab
        .getByRole('region', { name: 'Themes table' })
        .locator('button.st-strong')
        .first()
      await themeButton.click()
      const theme = page.getByTestId('st-theme-drawer')
      await expect(theme.getByRole('list', { name: /^Sentences about / })).toBeVisible()
      await expect(page).toHaveURL(/drawer=st-theme&sth\.id=t[0-9a-z]+/)
      await drawerShots(page, 'sentiment-theme')
      await page.goBack()
      await expect(theme).toHaveCount(0)
      await expect(page).toHaveURL(/view=themes/)
      await tab
        .getByRole('heading', { name: 'You and your competitors, by theme', exact: true })
        .scrollIntoViewIfNeeded()
      await shot(page, 'sentiment-matrix')

      await showSection(tab, /^Problems/)
      await expect(tab.getByRole('heading', { name: /driving the negative claims/ })).toBeVisible()
      const problems = tab.getByRole('region', { name: 'Factual problems table' })
      await expect(problems).toContainText('TextBolt pricing starts at $19 a month for 500 texts.')
      await expect(problems).toContainText(
        'Your pricing page says plans start at $29 a month, not $19.'
      )
      await expect(problems).toContainText('Checked against your own pages')
      await expectMainAccessible(page)
      await shot(page, 'sentiment-problems')

      await showSection(tab, /^Facts/)
      const prompts = tab.getByRole('list', { name: 'Brand questions' })
      await expect(prompts.getByRole('listitem')).toHaveCount(3)
      await expect(tab.getByText('3 questions × 2 markets = 6–12 searches per check')).toBeVisible()
      await expect(tab.getByText(/never count toward the visibility score/)).toBeVisible()
      await expectMainAccessible(page)
      await shot(page, 'sentiment-brand-prompts')
    })

    await test.step('a new brand fact is checked when Claude re-reads the saved overviews', async () => {
      await showSection(tab, /^Facts/)
      const facts = tab.getByRole('form', { name: 'Add a brand fact' })
      await facts.getByLabel('New brand fact').fill(FACT)
      await facts.getByRole('button', { name: 'Add fact' }).click()
      await expect(tab.getByRole('list', { name: 'Brand facts' })).toContainText(FACT)
      await tab.getByRole('button', { name: /Re-read saved overviews/ }).click()
      await expect(
        // Provider names stay hidden: the status line says CiteFox AI.
        tab.getByText('CiteFox AI is reading the saved overviews. No new searches.')
      ).toBeVisible()
      await showSection(tab, /^Problems/)
      const problems = tab.getByRole('region', { name: 'Factual problems table' })
      await expect(problems).toContainText(`Brand fact: ${FACT}`, { timeout: 90_000 })
      await expect(problems).toContainText('Checked against your brand facts')
      const log = readFileSync(shimLog, 'utf8')
      expect(log).toContain('sentiment-pricing-facts')
      expect(log).not.toContain('unmatched')
      const after = await readView(page)
      expect(after.reading).toEqual({ pending: 0, failed: 0, running: false })
      expect(after.facts.map((fact) => fact.text)).toEqual([FACT])
      await showSection(tab, /^Facts/)
      await tab.getByRole('heading', { name: 'Brand facts' }).scrollIntoViewIfNeeded()
      await shot(page, 'sentiment-facts')
    })
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
