import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { resolve } from 'node:path'

async function openHarness(browser: Browser, width: number, screen = ''): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 })
  const query = screen ? `?screen=${screen}` : ''
  await page.goto(`http://127.0.0.1:4179/src/m3/shellHarness.html${query}`, {
    waitUntil: 'networkidle'
  })
  return page
}

function openRunning(browser: Browser, width: number): Promise<Page> {
  return openHarness(browser, width)
}

test('the running label fits inside the shell at 1280 and 1024', async () => {
  const server = await createServer({
    configFile: false,
    root: resolve('src/renderer'),
    plugins: [react()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    server: { host: '127.0.0.1', port: 4179, strictPort: true }
  })
  await server.listen()
  const browser = await chromium.launch({ headless: true })
  try {
    for (const width of [1280, 1024]) {
      const page = await openRunning(browser, width)
      const label = page.getByText(/Market being checked now/)
      await expect(label).toBeVisible()
      await label.scrollIntoViewIfNeeded()
      const fit = await label.evaluate((element) => {
        const box = element.getBoundingClientRect()
        return {
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight
        }
      })
      expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth)
      expect(fit.left).toBeGreaterThanOrEqual(0)
      expect(fit.right).toBeLessThanOrEqual(fit.viewportWidth)
      expect(fit.top).toBeGreaterThanOrEqual(0)
      expect(fit.bottom).toBeLessThanOrEqual(fit.viewportHeight)

      const padding = await page.locator('#main').evaluate((element) => {
        const style = getComputedStyle(element)
        const screen = element.querySelector('.m3-screen')?.getBoundingClientRect()
        return {
          left: Number.parseFloat(style.paddingLeft),
          right: Number.parseFloat(style.paddingRight),
          screenLeft: screen?.left ?? 0,
          screenRight: screen?.right ?? window.innerWidth
        }
      })
      expect(padding.left).toBeGreaterThan(0)
      expect(padding.right).toBeGreaterThan(0)
      expect(padding.screenLeft).toBeGreaterThan(0)
      expect(width - padding.screenRight).toBeGreaterThan(0)

      const table = page.locator('.m3-run-table')
      const last = table.locator('[data-row="9"]')
      await last.scrollIntoViewIfNeeded()
      const rows = await last.evaluate((element) => {
        const box = element.getBoundingClientRect()
        const scroller = element.closest('.m3-run-table')
        if (!(scroller instanceof HTMLElement)) {
          return {
            scrollHeight: 1,
            clientHeight: 0,
            maxHeight: 'none',
            top: -1,
            bottom: 0,
            left: -1,
            right: 0,
            tableTop: 0,
            tableBottom: 0,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight
          }
        }
        const style = getComputedStyle(scroller)
        const tableBox = scroller.getBoundingClientRect()
        return {
          scrollHeight: scroller.scrollHeight,
          clientHeight: scroller.clientHeight,
          maxHeight: style.maxHeight,
          top: box.top,
          bottom: box.bottom,
          left: box.left,
          right: box.right,
          tableTop: tableBox.top,
          tableBottom: tableBox.bottom,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight
        }
      })
      expect(rows.scrollHeight).toBeLessThanOrEqual(rows.clientHeight)
      expect(rows.maxHeight).toBe('none')
      expect(rows.top).toBeGreaterThanOrEqual(0)
      // Scrolling lands on whole pixels, so a row can end a fraction past the edge.
      expect(rows.bottom).toBeLessThanOrEqual(rows.viewportHeight + 1)
      expect(rows.left).toBeGreaterThanOrEqual(0)
      expect(rows.right).toBeLessThanOrEqual(rows.viewportWidth)
      expect(rows.top).toBeGreaterThanOrEqual(rows.tableTop)
      expect(rows.bottom).toBeLessThanOrEqual(rows.tableBottom + 1)
      await page.close()
    }
  } finally {
    await browser.close()
    await server.close()
  }
})

test('the prompts list grid keeps headers, domains, and +N more inside the shell at 1280 and 1024', async () => {
  const server = await createServer({
    configFile: false,
    root: resolve('src/renderer'),
    plugins: [react()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    server: { host: '127.0.0.1', port: 4179, strictPort: true }
  })
  await server.listen()
  const browser = await chromium.launch({ headless: true })
  try {
    for (const width of [1280, 1024]) {
      const page = await openHarness(browser, width, 'results')
      const grid = page.locator('#m3-prompts .ui-lg-scroll')
      await grid.scrollIntoViewIfNeeded()
      await expect(grid.locator('.ui-lg-row').first()).toBeVisible()

      // No sideways scroll in the grid or the page.
      const fit = await grid.evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth
      }))
      expect(fit.scrollWidth, `grid at ${width}`).toBeLessThanOrEqual(fit.clientWidth)

      // Header labels are never clipped, and every row uses the header's tracks.
      const layout = await grid.evaluate((scroller) => {
        const head = scroller.querySelector('.ui-lg-head')
        const headTracks = head ? getComputedStyle(head).gridTemplateColumns : ''
        const rows = [...scroller.querySelectorAll('.ui-lg-row')]
        const style = head ? getComputedStyle(head) : null
        return {
          headTracks,
          padL: style ? Number.parseFloat(style.paddingLeft) : 0,
          padR: style ? Number.parseFloat(style.paddingRight) : 0,
          gap: style ? Number.parseFloat(style.columnGap) : 0,
          // A column's resize edge hangs past its header cell, so measure the label.
          clipped: [...(head?.querySelectorAll('[role="columnheader"]') ?? [])]
            .filter((cell) => {
              const label = cell.querySelector('.ui-lg-sort') ?? cell
              const overflow = label.scrollWidth > label.clientWidth + 1
              const past =
                label.getBoundingClientRect().right > cell.getBoundingClientRect().right + 1
              return overflow || past
            })
            .map((cell) => (cell.textContent ?? '').trim()),
          mismatched: rows
            .map((row) => getComputedStyle(row).gridTemplateColumns)
            .filter((value) => value !== headTracks).length,
          rows: rows.length
        }
      })
      expect(layout.headTracks).not.toBe('')
      expect(layout.rows).toBeGreaterThan(0)
      expect(layout.clipped).toEqual([])
      expect(layout.mismatched).toBe(0)
      expect(layout.padL).toBeGreaterThanOrEqual(8)
      expect(layout.padR).toBeGreaterThanOrEqual(8)
      expect(layout.gap).toBeGreaterThanOrEqual(8)

      // Short cells (number, stage, position, change) show their whole text; the
      // prompt and the cited domains ellipsize by design and stay on one line.
      const cells = await grid.evaluate((scroller) => {
        const problems: string[] = []
        let more = 0
        for (const row of scroller.querySelectorAll('.ui-lg-row')) {
          const rowBox = row.getBoundingClientRect()
          for (const cell of row.querySelectorAll<HTMLElement>('[role="gridcell"]')) {
            const box = cell.getBoundingClientRect()
            if (box.top < rowBox.top - 0.5 || box.bottom > rowBox.bottom + 0.5) {
              problems.push(`cell outside row: ${(cell.textContent ?? '').slice(0, 30)}`)
            }
            const prompt = cell.querySelector('.m3-pg-text')
            const instances = cell.querySelector('.m3-instances')
            if (instances) {
              // "+N more" is a taller button centred on the same line, so compare middles.
              const tops = new Set(
                [...instances.querySelectorAll('.m3-instance-line, .m3-instances-more')].map(
                  (node) => {
                    const box = node.getBoundingClientRect()
                    return Math.round((box.top + box.bottom) / 2)
                  }
                )
              )
              if (tops.size > 1) problems.push(`domains on ${tops.size} lines`)
              const extra = instances.querySelector('.m3-instances-more')
              if (extra) {
                more += 1
                const extraBox = extra.getBoundingClientRect()
                if (extraBox.right > box.right + 0.5 || extraBox.width === 0) {
                  problems.push(`+N more outside its cell: ${extra.textContent ?? ''}`)
                }
              }
              continue
            }
            if (prompt) {
              if (prompt.getBoundingClientRect().height > 24) problems.push('prompt wraps')
              continue
            }
            if (cell.scrollWidth > cell.clientWidth + 1) {
              problems.push(`clipped: ${(cell.textContent ?? '').trim()}`)
            }
          }
        }
        return { problems, more }
      })
      expect(cells.problems).toEqual([])
      expect(cells.more).toBeGreaterThan(0)

      const frame = await page.evaluate(() => {
        const main = document.querySelector('#main')
        const side = document.querySelector('.side')?.getBoundingClientRect()
        const block = document.querySelector('#m3-prompts')?.getBoundingClientRect()
        return {
          docScroll: document.documentElement.scrollWidth,
          docClient: document.documentElement.clientWidth,
          mainScroll: main instanceof HTMLElement ? main.scrollWidth : 0,
          mainClient: main instanceof HTMLElement ? main.clientWidth : 0,
          sideRight: side?.right ?? 0,
          blockLeft: block?.left ?? 0
        }
      })
      expect(frame.docScroll).toBeLessThanOrEqual(frame.docClient)
      expect(frame.mainScroll).toBeLessThanOrEqual(frame.mainClient)
      expect(frame.blockLeft).toBeGreaterThanOrEqual(frame.sideRight - 0.5)
      await page.close()
    }
  } finally {
    await browser.close()
    await server.close()
  }
})
