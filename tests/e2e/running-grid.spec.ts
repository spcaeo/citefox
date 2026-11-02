import { expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { gridReports } from './grid-structure'
import { launchCiteFox } from './launch'
import { installRawMarkdown } from './raw-hook'

/**
 * The owner's Checking screen in the built app: four markets, ten long
 * prompts, part-way through the first market. The shared `.ghead/.grow` grid
 * template once beat the run table's own columns, so "#" took most of the row
 * and each prompt wrapped one word per line.
 */
test('the Checking table keeps # narrow and the prompt column widest at 1280 and 1024', async () => {
  test.setTimeout(120_000)
  installRawMarkdown()
  const { RUNNING_SEED, runningJob, seedRunningProject, stubRunningJob } =
    await import('./running-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-running-grid-'))
  seedRunningProject(dir)
  const { app, page } = await launchCiteFox({ userDataDir: dir })
  try {
    await stubRunningJob(app, runningJob())
    await page.evaluate((id) => {
      window.location.hash = `#/pages/${encodeURIComponent(id)}/running`
    }, RUNNING_SEED.pageId)
    const table = page.getByRole('grid', { name: 'Questions in the market being checked' })
    await expect(table.locator('[data-row="9"]')).toBeAttached()

    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 1024, height: 700 }
    ]) {
      await page.setViewportSize(viewport)
      await expect(table.getByRole('columnheader', { name: 'Question' })).toBeVisible()
      const [report] = await gridReports(page, '.m3-run-table')
      expect(report?.headers.map((header) => header.label)).toEqual([
        '#',
        'Question',
        'Google search',
        'AI Overview',
        'Analysis'
      ])
      const widths = report?.headers.map((header) => header.width) ?? []
      expect(widths[0], `# column at ${viewport.width}`).toBeLessThanOrEqual(48)
      expect(Math.max(...widths), `widest column at ${viewport.width}`).toBe(widths[1])
      expect(report?.misaligned).toEqual([])
      expect(report?.crushed).toEqual([])
      expect(report?.rows).toBe(10)

      // Each prompt shows several words per line, never one word per line.
      const perLine = await table.locator('[role="row"][data-row] .m3-clamp').evaluateAll((cells) =>
        cells.map((cell) => {
          const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
          const tops: number[] = []
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = node.textContent ?? ''
            const pattern = /\S+/g
            for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
              const range = document.createRange()
              range.setStart(node, match.index)
              range.setEnd(node, match.index + match[0].length)
              const rect = range.getBoundingClientRect()
              if (rect.width > 0) tops.push(Math.round(rect.top))
            }
          }
          const first = tops[0]
          return tops.filter((top) => top === first).length
        })
      )
      expect(perLine).toHaveLength(10)
      for (const words of perLine) expect(words).toBeGreaterThanOrEqual(3)
      await page.screenshot({ path: await e2eArtifact(`running-grid-${viewport.width}.png`) })
    }
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
