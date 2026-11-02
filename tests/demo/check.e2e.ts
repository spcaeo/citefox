import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from 'vitest'
import { SAMPLES } from '../../scripts/site/samples.mjs'
import { openBrowser } from './browser'
import { crawl, MAIN_SCREENS, openHash, settle } from './crawl'
import { SITE_PREFIX, startSiteServer } from './server'

/**
 * `npm run demo:check` (Docker only, scripts/demo/docker.mjs): the finished
 * site/ served like GitHub Pages. Each main demo screen shows its heading and
 * real content, the whole tour runs without a console error, a blocked action
 * shows the demo notice, no provider name is on screen, and each sample report
 * opens with its pill. Screenshots go to CITEFOX_DEMO_SHOTS.
 */

const SHOTS = resolve(process.env.CITEFOX_DEMO_SHOTS ?? 'test-results/demo-shots')
const PROVIDERS = /\b(cloro|serp ?api|jina|claude|anthropic|codex)\b/i

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true })
  await page.mouse.move(1430, 890)
  await page.waitForTimeout(300)
  await capture(page, join(SHOTS, `${name}.png`), 'png')
}

/** Straight from CDP: Playwright's own screenshot can stall in an Electron window. */
async function capture(page: Page, path: string, format: 'png' | 'jpeg'): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  try {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format,
      ...(format === 'jpeg' ? { quality: 70 } : {})
    })
    writeFileSync(path, Buffer.from(data, 'base64'))
  } finally {
    await cdp.detach().catch(() => undefined)
  }
}

test('the live demo and the sample reports', async () => {
  const site = await startSiteServer(resolve('site'))
  const { app, page, errors } = await openBrowser(`${site.origin}${SITE_PREFIX}demo/`)
  const problems: string[] = []
  try {
    await page.waitForSelector('#main', { timeout: 60_000 })
    const banner = page.locator('.demo-banner')
    expect(await banner.innerText()).toMatch(/Live demo · sample data · Download the free app/)
    expect(await page.title()).toBe(
      'CiteFox live demo — try the AI visibility tracker in your browser'
    )

    console.log('[check] app loaded')
    for (const { hash, heading } of MAIN_SCREENS) {
      console.log(`[check] ${hash}`)
      await openHash(page, hash)
      await settle(page, 900)
      const h1 = await page
        .locator('#main h1')
        .first()
        .innerText()
        .catch(() => '')
      if (!heading.test(h1.trim())) problems.push(`${hash}: heading "${h1}"`)
      const text = await page.locator('#main').innerText()
      if (text.length < 300) problems.push(`${hash}: only ${text.length} characters`)
      if (/could not|went wrong|failed to/i.test(text)) problems.push(`${hash}: shows an error`)
      const shown = (await page.locator('body').innerText()).match(PROVIDERS)
      if (shown) problems.push(`${hash}: shows "${shown[0]}"`)
      await shot(page, `demo-${hash.replace(/[#/?=&]+/g, '-').replace(/^-|-$/g, '')}`)
      // A screen that keeps asking (an answer that makes it ask again) spins forever.
      const busy = await page.evaluate(() => {
        const map = (window as unknown as { __citefoxDemoCalls: Map<string, number> })
          .__citefoxDemoCalls
        const top = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
        map.clear()
        return top
      })
      console.log(`[check] calls ${JSON.stringify(busy)}`)
      for (const [channel, count] of busy) {
        if (count > 200) problems.push(`${hash}: ${channel} called ${count} times`)
      }
    }

    // A question page, a report and a drill drawer.
    await openHash(page, '#/reports?report=visibility')
    await settle(page, 900)
    await shot(page, 'demo-report-visibility')
    const drill = page.locator('#main [data-nfr-drill]').first()
    if ((await drill.count()) > 0) {
      await drill.click()
      await settle(page, 600)
      await shot(page, 'demo-report-drill')
      await page.keyboard.press('Escape')
    }

    // A blocked action: the notice, never an error.
    await openHash(page, '#/overview')
    await settle(page)
    // Summary's Check now opens the Check screen; its start button is the blocked action.
    await page
      .locator('#main')
      .getByRole('link', { name: /^Check now/ })
      .first()
      .click()
    await settle(page)
    const check = page
      .locator('#main')
      .getByRole('button', { name: /^(Check now|Run check|Run a check|Start|Check \d)/ })
      .first()
    if ((await check.count()) > 0) {
      await check.click()
      await page.waitForTimeout(800)
      const notice = page.getByTestId('demo-notice')
      if (!(await notice.isVisible())) problems.push('Check now: no demo notice')
      await shot(page, 'demo-blocked-notice')
      await page.keyboard.press('Escape')
    } else problems.push('Check screen: no start button found')

    // The help drawer and Ctrl+K.
    await openHash(page, '#/overview?drawer=help&help.id=summary')
    await settle(page)
    await shot(page, 'demo-help-drawer')
    await openHash(page, '#/overview')
    await settle(page)
    await page.keyboard.press('Control+k')
    await page.waitForTimeout(500)
    await page.keyboard.type('fixes')
    await page.waitForTimeout(500)
    await shot(page, 'demo-ctrl-k')
    await page.keyboard.press('Escape')

    // The whole tour, for console errors anywhere.
    await crawl(page, {
      quick: process.env.CITEFOX_DEMO_QUICK === '1',
      onStep: (name) => console.log(`[check] tour ${name}`),
      onCrash: (name) => problems.push(`the app crashed after: ${name}`)
    })

    // The sample reports and their gallery.
    for (const sample of SAMPLES) {
      await page.goto(`${site.origin}${SITE_PREFIX}samples/${sample.slug}/`)
      await page.waitForSelector('#main', { timeout: 30_000 })
      await page.waitForTimeout(800)
      const title = await page.title()
      if (!title.startsWith(`Sample ${sample.title}`))
        problems.push(`${sample.slug}: title "${title}"`)
      if (!(await page.locator('.cf-sample-bar').isVisible()))
        problems.push(`${sample.slug}: no pill`)
      const text = await page.locator('#main').innerText()
      if (text.length < 1500) problems.push(`${sample.slug}: only ${text.length} characters`)
      await shot(page, `sample-${sample.slug}`)
      // The gallery's thumbnail (npm run demo:check -- --thumbs copies it to media/samples).
      mkdirSync(join(SHOTS, 'thumbs'), { recursive: true })
      await page.evaluate(() => document.querySelector('.cf-sample-bar')?.remove())
      await capture(page, join(SHOTS, 'thumbs', `${sample.slug}.jpg`), 'jpeg')
    }
    await page.goto(`${site.origin}${SITE_PREFIX}samples/`)
    await page.waitForTimeout(500)
    await shot(page, 'samples-gallery')
    await page.goto(`${site.origin}${SITE_PREFIX}`)
    await page.waitForTimeout(500)
    if ((await page.locator('a[href="demo/"]').count()) === 0) problems.push('Home: no demo link')
    await shot(page, 'home')
  } finally {
    await app.close()
    await site.close()
  }
  // Pages without network show no site icons; nothing else may log an error.
  // Only the demo and the sample reports are checked here (the home page has its own test).
  const real = errors.filter(
    (line) =>
      /\/citefox\/(demo|samples)\//.test(line) && !/favicon|ERR_INTERNET_DISCONNECTED/i.test(line)
  )
  if (real.length > 0) problems.push(...real.map((line) => `console: ${line}`))
  expect(problems).toEqual([])
}, 1_200_000)
