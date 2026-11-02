import { expect, test } from '@playwright/test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { go, open, OUT, QUESTION, scrollIntoTop, seed, settle, VIEW } from './helpers'

/**
 * Marketing screenshots for the README and the download site, on the TextBolt demo
 * project (no live calls, no keys, no AI). The product video is video.spec.ts.
 *
 * Not part of the e2e suite (tests/e2e). Run `npm run media:record`, which runs this
 * inside Docker (scripts/media/record-demo.mjs) and then turns the raw output into
 * media/*.png. It refuses to run outside that container, because it opens a visible
 * window.
 *
 * Raw output goes to CITEFOX_MEDIA_OUT: shots/<name>.png at 2× (2880×1800).
 */

test.skip(
  process.env.CITEFOX_MEDIA_DOCKER !== '1',
  'Media recording opens a visible window: run it with npm run media:record (Docker).'
)

test('screenshots', async () => {
  const shots = path.join(OUT, 'shots')
  await mkdir(shots, { recursive: true })
  const dir = await seed()
  const { app, page } = await open(dir)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    ...VIEW,
    deviceScaleFactor: 2,
    mobile: false
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const snap = async (name: string): Promise<void> => {
    await page.mouse.move(VIEW.width - 4, VIEW.height - 4)
    await page.waitForTimeout(700)
    // Straight from CDP: Playwright's own screenshot scales back to its 1× viewport.
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    await writeFile(path.join(shots, `${name}.png`), Buffer.from(data, 'base64'))
  }
  try {
    await go(page, '#/overview', 'Summary')
    await snap('hero')
    await scrollIntoTop(page, page.locator('#main').getByText('Results at a glance').first(), 40)
    await snap('summary')

    await go(page, QUESTION, /send a text message from Outlook/)
    // From the top: the question, its status, the AI Overview and its sources with this page.
    await snap('question')

    await go(page, '#/competitors', 'Competitors')
    await snap('competitors')

    await go(page, '#/fixes', 'Fixes')
    await page.locator('#main').getByText('Improve a page', { exact: true }).first().click()
    await settle(page)
    await snap('fixes')

    await go(page, '#/reports', 'Reports')
    await snap('reports-home')

    await go(page, '#/reports?report=visibility', 'Reports')
    await expect(page.locator('#rv-opp-title')).toBeVisible()
    await scrollIntoTop(page, page.locator('#rv-funnel-title'), 60)
    await snap('report-visibility')
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
