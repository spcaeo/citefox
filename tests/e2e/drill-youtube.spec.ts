import { expect, test, type Locator, type Page } from '@playwright/test'
import { openCommunitiesApp, type CommunitiesApp } from './communities-app'
import { expectMainAccessible, openHash } from './screens-app'

/**
 * YouTube drill-downs (REPORT-SPEC "Interaction model", NFR-14) on the real
 * IPC handlers: every number opens the shared drawer, its total equals the
 * number clicked, rows open Prompt detail, and the keyboard works. No network:
 * the Communities seed answers everything from recorded fixtures.
 */
let opened: CommunitiesApp | undefined

test.afterEach(async () => {
  await opened?.close()
  opened = undefined
})

/** Clicks a drill control and checks the drawer lists exactly its number of rows. */
async function expectDrawerTotal(page: Page, control: Locator): Promise<number> {
  const figure = control.locator('[data-nfr-figure]').first()
  const total = Number((await figure.textContent())?.trim())
  expect(Number.isFinite(total)).toBe(true)
  await control.click()
  const drawer = page.getByRole('dialog')
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole('heading', { level: 2 })).toContainText(
    new RegExp(`· ${total} (answer|answers|channel|channels)$`)
  )
  // The header row plus one row per item; an empty drawer draws no grid.
  await expect(drawer.getByRole('row')).toHaveCount(total === 0 ? 0 : total + 1)
  return total
}

async function closeDrawer(page: Page, opener: Locator): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(opener).toBeFocused()
}

test('YouTube: every number opens a drawer whose total equals it', async () => {
  test.setTimeout(180_000)
  opened = await openCommunitiesApp('drill-youtube')
  const { page } = opened
  await openHash(page, '#/youtube')
  const main = page.locator('#main')
  await expect(main.getByRole('heading', { name: 'Videos in AI Overviews' })).toBeVisible()

  await test.step('KPI tiles', async () => {
    for (const name of [
      /^\d+ overviews shown\. Show the answers$/,
      /^Cite at least one YouTube video: \d+\. Show the answers$/,
      /^Open video slots: \d+\. Show the answers$/
    ]) {
      const tile = main.getByRole('button', { name })
      await expectDrawerTotal(page, tile)
      await closeDrawer(page, tile)
    }
  })

  await test.step('keyboard: Enter opens, Escape closes, focus returns', async () => {
    const tile = main.getByRole('button', { name: /^Open video slots: \d+\. Show the answers$/ })
    await tile.focus()
    await page.keyboard.press('Enter')
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()
    await expect(drawer.locator('.ui-drawer-close')).toBeFocused()
    await expectMainAccessible(page)
    await closeDrawer(page, tile)
  })

  await test.step('ideas: evidence and market tags drill; labels link', async () => {
    const table = main.getByRole('grid', { name: 'Video opportunities' })
    const first = table.locator('[data-row]').first()
    const evidence = first.getByRole('button', { name: /questions? shows? a video\. Show them$/ })
    const total = await expectDrawerTotal(page, evidence)
    await closeDrawer(page, evidence)
    let perMarket = 0
    const tags = first.getByRole('button', { name: /overviews show a video\. Show them$/ })
    for (let index = 0; index < (await tags.count()); index += 1) {
      const tag = tags.nth(index)
      await tag.click()
      const rows = (await page.getByRole('dialog').getByRole('row').count()) - 1
      perMarket += rows
      await closeDrawer(page, tag)
    }
    expect(perMarket).toBe(total)
    await expect(first.getByRole('link').first()).toHaveAttribute(
      'href',
      /^#\/pages\/[^/]+\/results$/
    )
    await expect(
      first.getByRole('link', { name: /^Open question \d+ in Question detail$/ }).first()
    ).toHaveAttribute('href', /^#\/pages\/[^/]+\/prompt\/[^/?]+$/)
  })

  await test.step('the status pill opens its idea in the drawer', async () => {
    const table = main.getByRole('grid', { name: 'Video opportunities' })
    const second = table.locator('[data-row]').nth(1)
    const pill = second.getByRole('button', { name: /: open the flow for / })
    await pill.click()
    await expect(pill).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page).toHaveURL(/#\/youtube\?idea=/)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(pill).toHaveAttribute('aria-pressed', 'false')
  })

  await test.step('a drawer row opens Prompt detail in its market', async () => {
    const tile = main.getByRole('button', { name: /^\d+ overviews shown\. Show the answers$/ })
    await tile.click()
    const link = page.getByRole('dialog').getByRole('row').nth(1).getByRole('link').first()
    await expect(link).toHaveAttribute('href', /^#\/pages\/[^/]+\/prompt\/[^/?]+\?market=/)
    await link.click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => window.location.hash)).toMatch(/\/prompt\//)
  })
})

test('YouTube: Your videos before and now drill after tracking starts', async () => {
  test.setTimeout(180_000)
  opened = await openCommunitiesApp('drill-youtube-track')
  const { page } = opened
  await openHash(page, '#/youtube')
  const main = page.locator('#main')
  const first = main
    .getByRole('grid', { name: 'Video opportunities' })
    .locator('[data-row]')
    .first()
  await first.locator('.yt-row-link').click()
  await main
    .getByRole('navigation', { name: 'Steps' })
    .getByRole('button', { name: /Track/ })
    .click()
  await main.getByLabel('YouTube URL').fill('https://youtu.be/Emai1ToSMS2?t=5')
  await main.getByRole('button', { name: 'Start tracking' }).click()
  await expect(first).toContainText('Tracking')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await main.getByRole('tab', { name: /^Your videos/ }).click()
  const yours = main.getByRole('grid', { name: 'Your tracked videos' })
  // UrlText shows the address without https://; its tooltip, Copy and Open keep the full URL.
  await expect(
    yours.locator('.ui-url-value[title="https://youtube.com/watch?v=Emai1ToSMS2"]')
  ).toHaveText('youtube.com/watch?v=Emai1ToSMS2')
  for (const name of [
    /answers: Overviews citing your video before\. Show them$/,
    /answers: Overviews citing your video\. Show them$/,
    /open questions\. Show them$/
  ]) {
    const control = yours.getByRole('button', { name }).first()
    if ((await yours.getByRole('button', { name }).count()) === 0) {
      // A count of zero has nothing to open: plain text, not a button.
      await expect(yours.locator('.drill-num-zero').first()).toHaveText('0')
      continue
    }
    await expectDrawerTotal(page, control)
    await closeDrawer(page, control)
  }
  await expect(
    yours.getByRole('link', { name: /^Open question \d+ in Question detail$/ }).first()
  ).toHaveAttribute('href', /\/prompt\//)
})
