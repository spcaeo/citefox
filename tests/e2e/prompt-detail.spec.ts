import { expect, test } from '@playwright/test'
import { expectMainAccessible, openHash, openTwoMarketApp, shot } from './screens-app'

const PROMPTS = [
  'How do I alert the crew without a developer?',
  'Which plan covers scheduled texts?'
] as const
const UK_PROMPT = 'How do I alert the crew in the UK without a developer?'

test('prompt detail opens from the grid and the drawer on real IPC', async () => {
  test.setTimeout(180_000)
  const { page, close } = await openTwoMarketApp('prompt-detail')
  try {
    await page.locator('#main').getByRole('link', { name: 'Alerts', exact: true }).first().click()
    const grid = page.getByRole('grid', { name: /Buyer questions from the/ })
    await expect(grid).toBeVisible()
    // A click on the row (not on a link inside it) opens the prompt.
    await grid.getByTitle(PROMPTS[0], { exact: true }).click()

    const screen = page.getByTestId('prompt-detail')
    await expect(screen.getByRole('heading', { level: 1, name: PROMPTS[0] })).toBeVisible()
    await expect(screen.getByText('Buyer question 1 · from the title, meta and H1')).toBeVisible()
    await expect(screen.getByRole('region', { name: 'Status' })).toContainText('Right page')
    await expect(
      screen.getByRole('button', { name: 'Position 2: go to the sources' })
    ).toBeVisible()
    const aio = screen.getByRole('region', { name: /^AI Overview · / })
    await expect(aio.getByText(/You can text employees without a developer/)).toBeVisible()
    await expectMainAccessible(page)
    await page.evaluate(() => document.querySelector('#main')?.scrollTo(0, 0))
    await shot(page, 'prompt-detail', true)

    const tabs = screen.getByRole('tablist', { name: 'Question sections' })
    await tabs.getByRole('tab', { name: /^Sources/ }).click()
    const sources = screen.getByRole('grid', { name: 'Sources in the order Google listed them' })
    const sourceRows = sources.locator('[role="row"][data-row]')
    await expect(sourceRows).toHaveCount(3)
    await expect(sourceRows.nth(1)).toContainText('This page')
    await expect(sourceRows.nth(0)).toContainText('Competitor')
    // The chips over the table count the sources by who they are: simpletexting.com and
    // twilio.com are both saved competitors.
    const summary = screen.getByRole('list', { name: 'In these sources' })
    await expect(summary).toContainText('Your site: 1 page')
    await expect(summary).toContainText('Competitors: 2')
    await expectMainAccessible(page)

    await tabs.getByRole('tab', { name: /^Markets/ }).click()
    const markets = screen.getByRole('region', { name: 'This question in other markets' })
    await expect(markets.getByRole('button', { name: '🇬🇧 UK · EN', exact: true })).toBeVisible()
    await expect(markets.getByText(UK_PROMPT)).toBeVisible()
    // Cells: Market, Status, Position, Question in this market, Actions.
    const ukRow = markets.getByRole('row', { name: /🇬🇧 UK · EN/ })
    await expect(ukRow.getByRole('gridcell').nth(1)).toHaveText('Not cited')

    await tabs.getByRole('tab', { name: /^Over time/ }).click()
    const timeline = screen.getByRole('region', { name: 'This question over time' })
    await expect(timeline.locator('[role="row"][data-row]')).toHaveCount(2)
    await expect(timeline.getByText('Baseline')).toBeVisible()

    await tabs.getByRole('tab', { name: /^Raw data/ }).click()
    const raw = screen.getByRole('region', { name: 'Raw data' })
    await raw.getByText('Google search JSON').click()
    await expect(raw.locator('.pd2-json').first()).toContainText('search_metadata')
    await expect(raw).not.toContainText('fixture-serpapi-secret')
    await expect(raw.getByText(/2 searches used/)).toBeVisible()

    await expect(page.getByText(/Error invoking remote method/)).toHaveCount(0)
    await expectMainAccessible(page)

    await screen.getByRole('button', { name: 'Copy fix brief' }).click()
    await expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible()
    await screen.getByRole('button', { name: 'More fix actions' }).click()
    await page.getByRole('menuitem', { name: /Show the brief/ }).click()
    await expect(screen.locator('#pd-brief')).toContainText(`Question: ${PROMPTS[0]}`)

    await screen.getByRole('link', { name: 'Next question' }).click()
    await expect(screen.getByRole('heading', { level: 1, name: PROMPTS[1] })).toBeVisible()
    await expect(screen.getByRole('link', { name: 'Previous question' })).toBeVisible()
    await expect(screen.getByRole('button', { name: 'Next question' })).toBeDisabled()
    await expect(screen.getByRole('region', { name: 'Status' })).toContainText('Your other page')

    await screen.getByRole('link', { name: 'Previous question' }).click()
    await screen.getByRole('combobox', { name: 'Market' }).selectOption({ label: '🇬🇧 UK · EN' })
    await expect(screen.getByRole('heading', { level: 1, name: UK_PROMPT })).toBeVisible()
    await expect(screen.getByRole('region', { name: 'Status' })).toContainText('Not cited')
    await expect(screen.getByText('As Google showed it, 🇬🇧 UK · EN')).toBeVisible()
    await shot(page, 'prompt-detail-uk')

    await screen.getByRole('link', { name: 'Results' }).first().click()
    const results = page.locator('#m3-results-top')
    await expect(results.getByRole('heading', { name: 'What this report covers' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Market' })).toHaveValue('mkt-uk')
    await page.getByRole('combobox', { name: 'Market' }).selectOption('mkt-us')
    // The funnel lives in the Breakdown tab of Results.
    await page
      .getByRole('tablist', { name: 'Results sections' })
      .getByRole('tab', { name: /^Breakdown/ })
      .click()
    await page
      .locator('#page-tabpanel')
      .getByRole('button', { name: /Questions checked/ })
      .first()
      .click()
    const drawer = page.getByRole('dialog')
    // The drill list opens in the shared Drawer: min(max(880, 80vw), 1280, 100vw − 48) (Docs/DRAWER.md).
    const viewport = await page.evaluate(() => window.innerWidth)
    const expected = Math.min(Math.max(880, viewport * 0.8), 1280, viewport - 48)
    expect(Math.abs(((await drawer.boundingBox())?.width ?? 0) - expected)).toBeLessThan(2)
    await drawer.getByRole('link', { name: /^Open question 1:/ }).click()
    await expect(screen.getByRole('heading', { level: 1, name: PROMPTS[0] })).toBeVisible()

    await openHash(page, '#/pages/page-1/prompt/no-such-prompt')
    await expect(screen.getByText(/has no result in this market yet/)).toBeVisible()
  } finally {
    await close()
  }
})

test('a prompt is reworded on its page and its earlier checks stay with the old wording', async () => {
  test.setTimeout(180_000)
  const NEW = 'How do I text the whole crew about a Saturday shift change without a developer?'
  const { page, close } = await openTwoMarketApp('prompt-edit')
  try {
    await openHash(page, '#/pages/page-1/prompt/prompt-1')
    const screen = page.getByTestId('prompt-detail')
    await expect(screen.getByRole('heading', { level: 1, name: PROMPTS[0] })).toBeVisible()
    await screen.getByRole('button', { name: 'Edit question' }).click()
    await expect(page).toHaveURL(/#\/pages\/page-1\/prompt\/prompt-1\?(.*&)?drawer=pd-edit/)
    const editor = page.getByRole('dialog', { name: 'Edit question' })
    await expect(editor.getByText(/^Uses \d+ searche?s? in US · EN/)).toBeVisible()
    const field = editor.getByRole('textbox')
    await expect(field).toHaveValue(PROMPTS[0])
    await field.fill('Which TextBolt plan alerts the whole crew on Saturdays?')
    await expect(editor.getByRole('alert')).toContainText('brand name')
    await expect(editor.getByRole('button', { name: 'Save only' })).toBeDisabled()
    await field.fill(NEW)
    await expect(editor.getByRole('alert')).toHaveCount(0)
    await shot(page, 'prompt-detail-edit')
    // Save only: this test never spends a search.
    await editor.getByRole('button', { name: 'Save only' }).click()

    // A new version: the page moves to the new prompt, which no full check has asked yet.
    await expect(screen.getByRole('heading', { level: 1, name: NEW })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // Anchored: the new prompt id is a UUID and may itself start with "1".
    await expect(page).not.toHaveURL(/prompt\/prompt-1$/)
    await expect(
      screen.getByText(/This wording is newer than the last full check in/)
    ).toBeVisible()
    const tabs = screen.getByRole('tablist', { name: 'Question sections' })
    await tabs.getByRole('tab', { name: /^Over time/ }).click()
    const timeline = screen.getByRole('region', { name: 'This question over time' })
    // The note sits above the grid, outside its region.
    await expect(screen.getByRole('note').filter({ hasText: /Wording changed on/ })).toBeVisible()
    await expect(timeline.getByText('Earlier wording').first()).toBeVisible()
    await expect(page.getByText(/Error invoking remote method/)).toHaveCount(0)
    await expectMainAccessible(page)

    // The old prompt keeps its wording; edits go to the current wording. An old
    // `?panel=edit` link still opens the drawer.
    await openHash(page, '#/pages/page-1/prompt/prompt-1?panel=edit')
    await expect(page).toHaveURL(/prompt\/prompt-1\?drawer=pd-edit$/)
    await expect(screen.getByRole('heading', { level: 1, name: PROMPTS[0] })).toBeVisible()
    const old = page.getByRole('dialog')
    await expect(old.getByText(/This is an older version of the question/)).toBeVisible()
    await old.getByRole('link', { name: 'Open the current wording' }).click()
    await expect(screen.getByRole('heading', { level: 1, name: NEW })).toBeVisible()
    await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue(NEW)
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  } finally {
    await close()
  }
})
