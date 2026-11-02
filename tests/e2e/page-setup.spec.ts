import AxeBuilder from '@axe-core/playwright'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { openAllPages } from './nav-helpers'

async function launchMock(
  viewport: { width: number; height: number } = { width: 1280, height: 820 }
): Promise<{ app: ElectronApplication; page: Page; dir: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-setup-'))
  const seeded = await launchCiteFox({ userDataDir: dir, viewport })
  try {
    await seeded.page.evaluate(() => {
      localStorage.setItem('citefox.client', 'mock')
      localStorage.setItem('citefox.mock.catalog', 'textbolt')
      localStorage.setItem('citefox.mock.pace', '0')
    })
  } finally {
    await seeded.app.close()
  }
  const { app, page } = await launchCiteFox({ userDataDir: dir, viewport })
  await openAllPages(page)
  return { app, page, dir }
}

async function closeApp(app: ElectronApplication, dir: string): Promise<void> {
  await app.close()
  await rm(dir, { recursive: true, force: true })
}

async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .setLegacyMode()
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(results.violations).toEqual([])
}

/**
 * The Content gaps KPI tiles (ui KpiStrip): four equal-height tiles, in one
 * row when the main column has room (1280), never wider than the column; the
 * prompt numbers line up with the big number.
 */
async function expectGapTiles(page: Page, oneRow: boolean): Promise<void> {
  const tiles = page.locator('.gp-tiles > .ui-kpi')
  await expect(tiles).toHaveCount(4)
  const boxes = await tiles.evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect()
      const row = node.parentElement?.getBoundingClientRect()
      return {
        top: Math.round(box.top),
        left: Math.round(box.left),
        right: Math.round(box.right),
        height: box.height,
        rowRight: Math.round(row?.right ?? 0)
      }
    })
  )
  if (oneRow) expect(new Set(boxes.map((box) => box.top)).size).toBe(1)
  for (const box of boxes) expect(box.right).toBeLessThanOrEqual(box.rowRight)
  const firstRow = boxes.filter((box) => box.top === boxes[0]?.top)
  const heights = firstRow.map((box) => box.height)
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1)
  const align = await page
    .locator('.gp-tiles .gp-tile-ids')
    .first()
    .evaluate((element) => {
      const tile = element.closest('.gp-tile')
      const number = tile?.querySelector('.ui-kpi-value .drill-num')
      if (!number) return null
      return {
        idsLeft: element.getBoundingClientRect().left,
        numberLeft: number.getBoundingClientRect().left,
        textAlign: getComputedStyle(element).textAlign
      }
    })
  expect(align).not.toBeNull()
  expect(['left', 'start']).toContain(align?.textAlign)
  expect(Math.abs((align?.idsLeft ?? 0) - (align?.numberLeft ?? 0))).toBeLessThanOrEqual(1)
}

/** The sponsor card closes the screen, after the content, and never covers the KPI tiles. */
async function expectSponsorClearOfTiles(page: Page): Promise<void> {
  const placed = await page.evaluate(() => {
    const sponsor = document.querySelector('#main .sponsor-card')
    const tiles = [...document.querySelectorAll('.gp-tiles > .ui-kpi')]
    if (!sponsor || tiles.length === 0) return null
    const sponsorBox = sponsor.getBoundingClientRect()
    const tileBoxes = tiles.map((tile) => tile.getBoundingClientRect())
    const hits = tileBoxes.some(
      (tile) =>
        sponsorBox.width > 0 &&
        tile.width > 0 &&
        sponsorBox.left < tile.right &&
        sponsorBox.right > tile.left &&
        sponsorBox.top < tile.bottom &&
        sponsorBox.bottom > tile.top
    )
    return {
      position: getComputedStyle(sponsor).position,
      hits,
      below: sponsorBox.top >= Math.max(...tileBoxes.map((tile) => tile.bottom)) - 1
    }
  })
  expect(placed).not.toBeNull()
  expect(['static', 'relative']).toContain(placed?.position)
  expect(placed?.hits).toBe(false)
  expect(placed?.below).toBe(true)
}

async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((next) => {
    window.location.hash = next
  }, hash)
}

test('page read, buyer profile, prompts, and coverage', async () => {
  const { app, page, dir } = await launchMock()
  try {
    await openHash(page, '#/pages/alerts/read')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Check what CiteFox read' })
    ).toBeVisible()
    await expect(page.getByRole('region', { name: 'Read status' })).toContainText('Page read')
    await expect(page.getByRole('heading', { name: 'FAQs found (9)' })).toBeVisible()
    await expect(page.getByText('7c21…e9')).toBeVisible()
    await expectAccessible(page)
    await page.screenshot({ path: await e2eArtifact('pageread-1280x820.png') })

    await openHash(page, '#/pages/bulk/read')
    await expect(page.getByText('CiteFox could not read this page.')).toBeVisible()
    await expect(
      page.getByText('Try reading it again, or supply the page as a file.')
    ).toBeVisible()
    await expectAccessible(page)
    await page.screenshot({ path: await e2eArtifact('pageread-failed-1280x820.png') })

    await openHash(page, '#/pages/alerts/audience')
    // No heading repeats the tab name; the rail panel names the version.
    await expect(page.getByRole('heading', { name: 'Buyer profile', exact: true })).toHaveCount(0)
    await expect(page.getByRole('grid', { name: 'Buyer profile points' })).toBeVisible()
    const provenance = page.getByRole('region', { name: 'This version', exact: true })
    await expect(provenance).toContainText('Template: CiteFox default')
    await expect(provenance).not.toContainText('buyer_profile')
    await expect(provenance.getByTitle('buyer-profile · 4c2e…a1')).toBeVisible()
    await expectAccessible(page)
    await page.screenshot({ path: await e2eArtifact('audience-1280x820.png') })
    await page.screenshot({ path: await e2eArtifact('provenance-after.png') })
    await page.getByRole('button', { name: 'Profile settings' }).click()
    const settings = page.getByRole('dialog', { name: 'Profile settings' })
    await expect(settings.getByRole('button', { name: 'Regenerate' })).toBeVisible()
    await expectAccessible(page)
    await page.screenshot({ path: await e2eArtifact('audience-settings-1280x820.png') })
    await settings.getByRole('button', { name: 'Close Profile settings' }).click()
    await expect(settings).toHaveCount(0)

    // A page with no stored profile offers to write it, never a manual "do this first".
    await openHash(page, '#/pages/bulk/audience')
    await expect(page.getByText('No buyer profile on this page')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Write the buyer profile' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Generate buyer profile' })).toHaveCount(0)
    await expectAccessible(page)
    await page.screenshot({ path: await e2eArtifact('audience-empty-1280x820.png') })

    await openHash(page, '#/pages/alerts/prompts')
    // The review screen (owner feedback 5): one list grid, context panels, settings aside.
    await expect(page.getByRole('heading', { name: 'Buyer questions', exact: true })).toHaveCount(0)
    const grid = page.getByRole('grid', { name: 'Buyer questions' })
    await expect(grid.locator('.ui-lg-row')).toHaveCount(10)
    const context = page.getByRole('region', { name: 'About these questions' })
    await expect(context).toContainText('Written for')
    await expect(context).toContainText('v2')
    await expect(context).toContainText('Template: CiteFox default')
    await expect(context).not.toContainText('buyer-prompts ·')
    await expect(context.getByTitle('buyer-prompts · e81a…b2')).toBeVisible()
    await expect(page.getByText('Save prompt count')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Generate questions' })).toHaveCount(0)
    await expect(page.getByLabel('Template')).toHaveCount(0)
    await expectAccessible(page)
    await page.screenshot({ path: await e2eArtifact('prompts-1280x820.png') })

    await grid.getByRole('button', { name: /^Actions for question 1$/ }).click()
    await page.getByRole('menuitem', { name: 'Edit wording' }).click()
    await expect(page).toHaveURL(/drawer=pt-edit&pt\.edit=/)
    const editor = page.getByRole('dialog', { name: 'Edit question' })
    const field = editor.getByRole('textbox')
    const original = await field.inputValue()
    expect(original.length).toBeGreaterThan(40)
    await field.fill(`${original} and one more line for the Saturday crew`)
    await editor.getByRole('button', { name: 'Save wording' }).click()
    await expect(editor).toHaveCount(0)
    await expect(page.getByText('Unsaved changes.')).toBeVisible()
    await expectAccessible(page)

    await page.getByRole('button', { name: 'Question settings' }).click()
    const promptSettings = page.getByRole('dialog', { name: 'Question settings' })
    await promptSettings.getByLabel('Buyer questions to write').fill('1001')
    await promptSettings.getByRole('button', { name: 'Save count' }).click()
    await expect(promptSettings.getByRole('alert')).toHaveText(
      'Enter a whole number from 1 to 1,000.'
    )
    await expectAccessible(page)
    await page.screenshot({ path: await e2eArtifact('prompts-invalid-1280x820.png') })
    // The count was never saved: closing asks first.
    await promptSettings.getByRole('button', { name: 'Close Question settings' }).click()
    await page
      .getByRole('alertdialog', { name: 'Discard changes?' })
      .getByRole('button', { name: 'Discard' })
      .click()
    await expect(promptSettings).toHaveCount(0)

    // A tracked page with no prompt set offers Add my own and Prompt settings, no dead end.
    await openHash(page, '#/pages/bulk/prompts')
    await expect(
      page.getByText('No questions in this set. Add your own or write them again.')
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Question settings' })).toBeVisible()
    await expect(page.getByText('No questions yet.')).toHaveCount(0)
    await expectAccessible(page)
    await page.screenshot({ path: await e2eArtifact('prompts-empty-1280x820.png') })

    await openHash(page, '#/pages/alerts/gaps')
    const matrix = page.getByRole('grid', { name: 'Coverage matrix' })
    await expect(matrix).toBeVisible()
    // Old v1 controls are gone: no template select or build button on the surface.
    await expect(page.getByRole('button', { name: 'Build coverage matrix' })).toHaveCount(0)
    await expect(page.getByLabel('Template')).toHaveCount(0)
    const work = page.locator('.gp-work')
    await expect(work).toContainText(/5–6\s*new FAQs/)
    await expect(work).toContainText('and edits to 8 sections')
    const type = await page
      .locator('.gp-tiles .ui-kpi-value')
      .first()
      .evaluate((element) => {
        const number = element.querySelector('.drill-num')
        const unit = element.querySelector('.ui-kpi-suffix')
        if (!number || !unit) return null
        const numberBox = number.getBoundingClientRect()
        const unitBox = unit.getBoundingClientRect()
        return {
          numberSize: getComputedStyle(number).fontSize,
          numberFamily: getComputedStyle(number).fontFamily,
          sameLine:
            unitBox.top < numberBox.bottom &&
            unitBox.bottom > numberBox.top &&
            unitBox.left > numberBox.left
        }
      })
    expect(type).not.toBeNull()
    expect(type?.numberSize).toBe('22px')
    expect(type?.numberFamily.toLowerCase()).not.toContain('mono')
    expect(type?.sameLine).toBe(true)
    const tiles = page.locator('.gp-tiles')
    await tiles.scrollIntoViewIfNeeded()
    await expectGapTiles(page, true)
    await expectSponsorClearOfTiles(page)
    await tiles.screenshot({ path: await e2eArtifact('after-gaps-tiles-1280.png') })
    await expect(page.getByRole('list', { name: 'Coverage counts' })).toBeAttached()
    await expect(
      page.getByRole('group', { name: /Strong 5, Partial 4, Weak 1, None 0/ })
    ).toBeVisible()
    await matrix.focus()
    await page.keyboard.press('ArrowDown')
    await expect(matrix.locator('[data-line="0"]')).toBeFocused()
    await page
      .getByRole('group', { name: 'Filter by coverage' })
      .getByRole('button', { name: /^Strong/ })
      .click()
    await expect(page.getByText('Showing 5 of 10 questions')).toBeVisible()
    await expectAccessible(page)
    await page.screenshot({ path: await e2eArtifact('gaps-1280x820.png') })

    // Settings live in a drawer, off the main surface; the template is an expert option.
    await page.getByRole('button', { name: 'Content gaps settings' }).click()
    const gapsSettings = page.getByRole('dialog', { name: 'Content gaps settings' })
    const expert = gapsSettings.getByRole('button', { name: /Expert options/ })
    if ((await expert.getAttribute('aria-expanded')) !== 'true') await expert.click()
    await expect(gapsSettings.getByLabel('Template')).toBeVisible()
    const gapsProvenance = gapsSettings.locator('.gp-tag')
    await expect(gapsProvenance).toContainText('Template: CiteFox default (edited)')
    await expect(gapsProvenance).not.toContainText('gap_matrix')
    await expect(gapsProvenance.getByTitle('coverage · 71d0…c3')).toBeVisible()
    await expectAccessible(page)
    await page.screenshot({ path: await e2eArtifact('gaps-settings-1280x820.png') })
    await page.keyboard.press('Escape')

    // One by one and page-wide fixes are tabs with their own address.
    await page.getByRole('tab', { name: /^One by one/ }).click()
    // The coverage filter picked above stays on the URL (`gf.cov`).
    await expect(page).toHaveURL(
      /#\/pages\/alerts\/gaps\?(market=us&)?filter=view%3Aone&gf\.cov=strong$/
    )
    await expect(page.locator('.ps-acc-btn').first()).toBeVisible()
    await page.screenshot({ path: await e2eArtifact('gaps-one-by-one-1280x820.png') })
    await page.getByRole('tab', { name: /^Page-wide fixes/ }).click()
    await expect(page.getByRole('region', { name: 'Page-wide fixes' })).toBeVisible()

    // A tracked page without content gaps yet never shows a manual build button.
    await openHash(page, '#/pages/bulk/gaps')
    await expect(page.getByText('Content gaps are not written yet')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Build coverage matrix' })).toHaveCount(0)
    await expectAccessible(page)
    await page.screenshot({ path: await e2eArtifact('gaps-empty-1280x820.png') })
  } finally {
    await closeApp(app, dir)
  }
})

test('coverage matrix at 1024 by 700', async () => {
  const { app, page, dir } = await launchMock({ width: 1024, height: 700 })
  try {
    await openHash(page, '#/pages/alerts/gaps')
    await expect(page.getByRole('grid', { name: 'Coverage matrix' })).toBeVisible()
    const narrowTiles = page.locator('.gp-tiles')
    await narrowTiles.scrollIntoViewIfNeeded()
    await expectGapTiles(page, false)
    await expectSponsorClearOfTiles(page)
    await narrowTiles.screenshot({ path: await e2eArtifact('after-gaps-tiles-1024.png') })
    await expectAccessible(page)
    await page.screenshot({ path: await e2eArtifact('gaps-1024x700.png') })
  } finally {
    await closeApp(app, dir)
  }
})
