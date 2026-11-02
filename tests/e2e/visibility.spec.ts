import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { e2eArtifact } from './artifacts'

async function openHarness(browser: Browser, screen: string): Promise<Page> {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1
  })
  await page.goto(`http://127.0.0.1:4181/src/visibility/harness.html?screen=${screen}`, {
    waitUntil: 'networkidle'
  })
  return page
}

async function shootFull(page: Page, path: string): Promise<void> {
  const height = await page.evaluate(() => {
    const nodes: Array<HTMLElement | null> = [
      document.documentElement,
      document.body,
      document.getElementById('root'),
      document.querySelector('.app'),
      document.querySelector('.main')
    ]
    for (const el of nodes) {
      if (!el) continue
      el.style.height = 'auto'
      el.style.maxHeight = 'none'
      el.style.overflow = 'visible'
    }
    const main = document.querySelector('.main')
    return Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      main?.scrollHeight ?? 0
    )
  })
  await page.setViewportSize({ width: 1280, height: Math.max(900, height) })
  await page.screenshot({ path, fullPage: true })
}

async function shootFrom(page: Page, heading: string, path: string): Promise<void> {
  const box = await page.evaluate((name) => {
    const el = [...document.querySelectorAll('h2, p')].find((node) =>
      (node.textContent ?? '').includes(name)
    )
    if (!el) return null
    const top = el.getBoundingClientRect().top + window.scrollY
    const bottom = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
    return {
      x: 0,
      y: Math.max(0, top),
      width: 1280,
      height: Math.max(1, bottom - top - 1)
    }
  }, heading)
  if (!box) throw new Error(`missing ${heading}`)
  await page.screenshot({ path, clip: box })
}

test('visibility harness shows fixture layouts and the production empty state', async () => {
  const server = await createServer({
    configFile: false,
    root: resolve('src/renderer'),
    plugins: [react()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    server: { host: '127.0.0.1', port: 4181, strictPort: true }
  })
  await server.listen()
  const browser = await chromium.launch({ headless: true })
  try {
    const citations = await openHarness(browser, 'citations')
    await expect(citations.getByRole('heading', { name: 'Citations (links)' })).toBeVisible()
    await expect(citations.getByRole('heading', { name: 'Who gets cited' })).toBeVisible()
    await citations.getByRole('button', { name: '5 links' }).click()
    await expect(
      citations.getByRole('heading', { name: 'Citations to textbolt.com · 5 links' })
    ).toBeVisible()
    await citations.screenshot({
      path: await e2eArtifact('citations-drawer.png'),
      fullPage: false
    })
    await citations.locator('.ui-drawer-foot').getByRole('button', { name: 'Close' }).click()
    await shootFull(citations, await e2eArtifact('citations.png'))
    await shootFrom(citations, 'Cited instead of you', await e2eArtifact('citations-lower.png'))
    await citations.close()

    const scores = await openHarness(browser, 'scores')
    await expect(
      scores.getByRole('heading', { name: /What changed since the last check/ })
    ).toBeVisible()
    await scores
      .locator('section')
      .filter({ has: scores.getByRole('heading', { name: /What changed since the last check/ }) })
      .screenshot({ path: await e2eArtifact('scores-changed.png') })
    await expect(
      scores.getByRole('heading', { name: 'How often overviews cite this page' })
    ).toBeVisible()
    await expect(
      scores.getByRole('img', { name: /Share of AI Overviews that cite this page/ })
    ).toBeVisible()
    await scores
      .getByRole('button', { name: /38%, Page cited in 3 of 8 AI Overviews shown/ })
      .click()
    await expect(scores.getByRole('heading', { name: /3 questions/ })).toBeVisible()
    await scores.screenshot({ path: await e2eArtifact('scores-drawer.png'), fullPage: false })
    await scores.locator('.ui-drawer-foot').getByRole('button', { name: 'Close' }).click()
    await shootFull(scores, await e2eArtifact('scores-chart.png'))
    // v2 Progress: fixes sit on their own tab.
    const sections = scores.getByRole('tablist', { name: 'Progress sections' })
    await sections.getByRole('tab', { name: /^Fixes/ }).click()
    await expect(scores.getByRole('heading', { name: 'Fixes and what happened' })).toBeVisible()
    await shootFrom(scores, 'Fixes and what happened', await e2eArtifact('scores-lower.png'))
    await sections.getByRole('tab', { name: 'Overview' }).click()
    await scores.getByRole('button', { name: 'Table', exact: true }).click()
    await expect(scores.getByRole('columnheader', { name: 'In trend line' })).toBeVisible()
    await shootFull(scores, await e2eArtifact('scores-table.png'))
    await scores.close()

    const empty = await openHarness(browser, 'empty')
    await expect(empty.getByText('No check in this market yet.').first()).toBeVisible()
    await expect(empty.getByRole('heading', { name: 'Citations (links)' })).toHaveCount(0)
    await expect(empty.getByText('Added 5 FAQs')).toHaveCount(0)
    await expect(empty.getByText('Gained a citation')).toHaveCount(0)
    await shootFull(empty, await e2eArtifact('scores-empty.png'))
    await shootFull(empty, await e2eArtifact('production-empty.png'))
    await empty.screenshot({
      path: await e2eArtifact('citations-production.png'),
      clip: { x: 220, y: 0, width: 1060, height: 280 }
    })
    const scoresTop = await empty.evaluate(() => {
      const el = [...document.querySelectorAll('h2')].find((node) =>
        (node.textContent ?? '').includes('What changed')
      )
      return el ? Math.max(0, el.getBoundingClientRect().top) : 200
    })
    const scoresHeight = await empty.evaluate(() => document.documentElement.scrollHeight)
    await empty.screenshot({
      path: await e2eArtifact('scores-production.png'),
      clip: {
        x: 0,
        y: scoresTop,
        width: 1280,
        height: Math.max(400, scoresHeight - scoresTop - 1)
      }
    })
    await empty.close()
  } finally {
    await browser.close()
    await server.close()
  }
})
