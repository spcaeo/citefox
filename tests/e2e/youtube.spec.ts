import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { openCommunitiesApp, type CommunitiesApp } from './communities-app'
import { drawerShots } from './drawer-helpers'
import { expectMainAccessible, openHash, pickDropdown } from './screens-app'
import { e2eArtifactsDir } from './artifacts'

const SHOTS = path.join(e2eArtifactsDir(), 'screenshots', 'communities')

let opened: CommunitiesApp | undefined

test.afterEach(async () => {
  await opened?.close()
  opened = undefined
})

async function shot(page: Page, name: string): Promise<void> {
  await mkdir(SHOTS, { recursive: true })
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
}

async function stubDesktop(app: ElectronApplication, exportPath: string): Promise<void> {
  await app.evaluate(({ dialog, shell }, filePath) => {
    const store = globalThis as unknown as { __citefoxOpened?: string[] }
    store.__citefoxOpened = []
    shell.openExternal = (async (url: string) => {
      store.__citefoxOpened?.push(url)
    }) as typeof shell.openExternal
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath
    })) as unknown as typeof dialog.showSaveDialog
  }, exportPath)
}

test('YouTube opportunities: KPIs, step filter, brief, FoxCue, teleprompter, export, tracking', async () => {
  test.setTimeout(180_000)
  opened = await openCommunitiesApp('youtube')
  const { app, page, dir } = opened
  const exportPath = path.join(dir, 'brief-script.md')
  await stubDesktop(app, exportPath)
  await openHash(page, '#/youtube')
  const main = page.locator('#main')

  await test.step('no sponsor card in the content (the sidebar keeps its own)', async () => {
    await expect(main.getByRole('complementary', { name: 'Sponsored placement' })).toHaveCount(0)
  })

  await test.step('four KPI tiles drill to exactly their prompts', async () => {
    await expect(main.locator('.yt-stats .ui-kpi')).toHaveCount(4)
    await expect(
      main.getByRole('button', { name: '4 overviews shown. Show the answers' })
    ).toBeVisible()
    await expect(
      main.getByRole('button', { name: 'Cite at least one YouTube video: 3. Show the answers' })
    ).toBeVisible()
    await expect(main.getByText(/^75% of 4 overviews shown · 4 questions$/)).toBeVisible()
    await expect(
      main.getByRole('button', { name: 'Cite your video: 0. Show the answers' })
    ).toBeVisible()
    await main.getByRole('button', { name: 'Open video slots: 3. Show the answers' }).click()
    const drawer = page.getByRole('dialog', { name: /Open video slots · 3/ })
    await expect(drawer).toBeVisible()
    // Header row plus one row per answer: the drawer total equals the tile (NFR-14).
    await expect(drawer.getByRole('row')).toHaveCount(4)
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
  })

  await test.step('market filter in the grid toolbar narrows the numbers', async () => {
    // The Market filter is a toolbar dropdown while the row has room; once a market is set
    // (and "Clear filters" joins the row) it may move into Filter ▾ (audit2 #7).
    const region = main.getByRole('region', { name: 'Video opportunities' })
    const pickMarket = async (option: RegExp): Promise<void> => {
      const own = region.getByRole('combobox', { name: 'Market' })
      if (await own.isVisible()) {
        await pickDropdown(own, option)
        return
      }
      await region.getByRole('button', { name: /^Filter/ }).click()
      await page
        .getByRole('menuitemradio', { name: new RegExp(`^Market: .*${option.source}`) })
        .click()
      await page.keyboard.press('Escape')
    }
    await pickMarket(/UK · EN/)
    await expect(
      main.getByRole('button', { name: '2 overviews shown. Show the answers' })
    ).toBeVisible()
    await expect(page).toHaveURL(/#\/youtube\?market=/)
    await pickMarket(/All markets/)
    await expect(
      main.getByRole('button', { name: '4 overviews shown. Show the answers' })
    ).toBeVisible()
  })

  await expectMainAccessible(page)
  await shot(page, 'youtube-overview')

  await test.step('ideas rank by evidence and filter by step', async () => {
    const grid = main.getByRole('grid', { name: 'Video opportunities' })
    const rows = grid.locator('[data-row]')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText(/2\s*questions/)
    const steps = main.getByRole('group', { name: 'Step' })
    for (const label of ['Idea', 'Brief', 'Sent', 'Published', 'Tracking']) {
      await expect(steps.getByRole('button', { name: new RegExp(`^${label}`) })).toBeVisible()
    }
    await steps.getByRole('button', { name: /^Tracking/ }).click()
    await expect(main.getByRole('heading', { name: /No ideas match/ })).toBeVisible()
    await shot(page, 'youtube-step-filter')
    await main.getByRole('button', { name: /^Show all/ }).click()
    await expect(rows).toHaveCount(2)
  })

  const steps = main.getByRole('navigation', { name: 'Steps' })

  await test.step('the top idea opens in a drawer with its id in the URL; Back closes it', async () => {
    const grid = main.getByRole('grid', { name: 'Video opportunities' })
    await grid.locator('[data-row]').first().locator('.yt-row-link').click()
    const panel = page.getByRole('dialog', { name: /./ })
    await expect(panel.getByText('From question to video')).toBeVisible()
    await expect(page).toHaveURL(/#\/youtube\?idea=/)
    // The drawer title is an h2, never h1-sized; the screen keeps one h1.
    await expect(main.locator('h1')).toHaveCount(1)
    // An idea with no brief opens on its question, step 1 of 6, with the stepper on the left.
    await expect(panel.getByText('Step 1 of 6')).toBeVisible()
    await expect(steps.getByRole('button')).toHaveCount(6)
    await drawerShots(page, 'youtube-idea')
    await page.goBack()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.goForward()
    await expect(panel.getByText('From question to video')).toBeVisible()
  })

  await test.step('write the brief; claims not on the page are flagged', async () => {
    await page.getByRole('button', { name: /^Next: Brief/ }).click()
    await expect(page).toHaveURL(/idea\.step=brief/)
    await main.getByRole('button', { name: 'Write the brief' }).click()
    await expect(main.getByText('Alert your crew by text without a developer').first()).toBeVisible(
      {
        timeout: 30_000
      }
    )
    await expect(main.locator('.yt-sources li.yt-flag')).toHaveCount(2)
    await expect(main.getByText('Not on the page yet', { exact: true })).toHaveCount(2)
    await expect(main.getByText('Brief ready').first()).toBeVisible()
    await main.locator('#yt-step-brief').scrollIntoViewIfNeeded()
    await shot(page, 'youtube-brief')
  })

  await expectMainAccessible(page)

  await test.step('Send to FoxCue only marks the idea sent', async () => {
    await steps.getByRole('button', { name: /Make/ }).click()
    await main.getByRole('link', { name: 'Send to FoxCue' }).click()
    await expect(main.getByText(/Marked sent/)).toBeVisible()
    await expect(
      main.getByRole('grid', { name: 'Video opportunities' }).locator('[data-row]').first()
    ).toContainText('Sent to FoxCue')
    const fetched = await opened?.fetched()
    expect((fetched ?? []).filter((url) => url.includes('foxcue.com'))).toEqual([])
  })

  await test.step('teleprompter steps through the script', async () => {
    await main.getByRole('button', { name: 'Open the teleprompter' }).click()
    const prompter = page.getByRole('dialog', { name: /Teleprompter · line 1 of 5/ })
    await expect(prompter).toBeVisible()
    await prompter.getByRole('button', { name: 'Next line' }).click()
    await expect(page.getByRole('heading', { name: 'Teleprompter · line 2 of 5' })).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('heading', { name: 'Teleprompter · line 3 of 5' })).toBeVisible()
    await shot(page, 'youtube-teleprompter')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: /Teleprompter/ })).toHaveCount(0)
  })

  await test.step('export the script through the save dialog', async () => {
    // Files are in the Download files menu (the download icon).
    await main.getByRole('button', { name: 'Download files' }).click()
    await page.getByRole('menuitem', { name: 'Script (.md)' }).click()
    await expect(main.getByText('Saved brief-script.md')).toBeVisible()
    const text = await readFile(exportPath, 'utf8')
    expect(text).toContain('# Alert your crew by text without a developer')
  })

  await test.step('checklist ticks persist after a reload', async () => {
    await steps.getByRole('button', { name: /Publish/ }).click()
    await main.getByLabel("The title uses the buyer's own wording").check()
    await expect(main.getByText('1 of 7 done')).toBeVisible()
    await main.getByLabel('Captions are uploaded').check()
    await expect(main.getByText('2 of 7 done')).toBeVisible()
    // The open idea is in the URL, so it opens again after a reload.
    const hash = await page.evaluate(() => window.location.hash)
    expect(hash).toMatch(/^#\/youtube\?idea=/)
    await page.reload()
    await openHash(page, hash)
    await expect(main.getByText('2 of 7 done')).toBeVisible()
    await expect(main.getByLabel('Captions are uploaded')).toBeChecked()
  })

  await test.step('publish and track the video', async () => {
    await steps.getByRole('button', { name: /Track/ }).click()
    await main.getByRole('button', { name: 'Start tracking' }).click()
    await expect(main.getByText("Paste the video's YouTube URL first.")).toBeVisible()
    await main.getByLabel('YouTube URL').fill('https://youtu.be/Emai1ToSMS2?t=5')
    await main.getByRole('button', { name: 'Start tracking' }).click()
    await expect(
      main.getByRole('grid', { name: 'Video opportunities' }).locator('[data-row]').first()
    ).toContainText('Tracking')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page).toHaveURL(/#\/youtube$/)
    await main.getByRole('tab', { name: /^Your videos/ }).click()
    await expect(page).toHaveURL(/#\/youtube\?tab=yours$/)
    const yours = main.getByRole('grid', { name: 'Your tracked videos' })
    // UrlText shows the address without https://; its tooltip, Copy and Open keep the full URL.
    await expect(
      yours.locator('.ui-url-value[title="https://youtube.com/watch?v=Emai1ToSMS2"]')
    ).toHaveText('youtube.com/watch?v=Emai1ToSMS2')
    await expect(
      yours.getByRole('button', {
        name: '2 of 2 answers: Overviews citing your video. Show them',
        exact: true
      })
    ).toBeVisible()
    await expect(main.getByText(/can't tell you the video caused a change/)).toBeVisible()
    await expect(
      main.getByRole('button', { name: 'Cite your video: 2. Show the answers' })
    ).toBeVisible()
    await yours.scrollIntoViewIfNeeded()
    await shot(page, 'youtube-tracking')
  })

  await expectMainAccessible(page)
})
