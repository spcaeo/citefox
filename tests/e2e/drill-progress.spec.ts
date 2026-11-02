import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { launchCiteFox } from './launch'
import { installRawMarkdown } from './raw-hook'
import { openHash } from './screens-app'
import { expectDrawerRows } from './drill-helpers'
import { openAllPages } from './nav-helpers'

const PAGE = 'page-1'

async function openSeeded(): Promise<{ page: Page; close: () => Promise<void> }> {
  installRawMarkdown()
  const { seedProgressProject } = await import('./progress-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-drill-progress-'))
  await seedProgressProject(dir)
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1280, height: 900 }
  })
  await openAllPages(page)
  return {
    page,
    close: async () => {
      await app.close()
      await rm(dir, { recursive: true, force: true })
    }
  }
}

/** The count a drill control shows (its `data-nfr-figure`). */
async function figure(panel: Locator, control: Locator): Promise<number> {
  const id = await control.getAttribute('data-nfr-drill')
  expect(id).not.toBeNull()
  const text = await panel.locator(`[data-nfr-figure="${id}"]`).first().textContent()
  return Number((text ?? '').trim())
}

/** Opens a drill control, checks the drawer lists exactly its count, and returns the drawer. */
async function openAndCount(page: Page, panel: Locator, control: Locator): Promise<Locator> {
  const count = await figure(panel, control)
  await control.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expectDrawerRows(dialog, count)
  return dialog
}

async function close(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test('Progress drills list exactly the clicked count and open Prompt detail at that check', async () => {
  test.setTimeout(180_000)
  const { page, close: quit } = await openSeeded()
  try {
    await openHash(page, `#/pages/${PAGE}/progress`)
    const panel = page.locator('#page-tabpanel')
    await expect(
      panel.getByRole('heading', { name: 'How often overviews cite this page' })
    ).toBeVisible()

    // Selected point: page cited in that check; rows open Prompt detail pinned to it.
    const cited = panel.getByRole('button', { name: /^Page cited in \d+ of .* shown on / })
    const dialog = await openAndCount(page, panel, cited)
    const links = dialog.getByRole('link', { name: /^Open question/ })
    expect(await links.count()).toBeGreaterThan(0)
    await expect(links.first()).toHaveAttribute('href', /\/prompt\/[^?]+\?market=[^&]+&run=/)
    await close(page)
    await expect(cited).toBeFocused()

    // Coverage: prompts checked in that check, keyboard-activated.
    const checked = panel.getByRole('button', { name: /questions? checked, show them$/ }).first()
    const checkedCount = await figure(panel, checked)
    await checked.focus()
    await page.keyboard.press('Enter')
    await expectDrawerRows(page.getByRole('dialog'), checkedCount)
    await close(page)

    // Table view: every count drills from its own check.
    await panel.getByRole('button', { name: 'Table', exact: true }).click()
    const table = panel.getByRole('grid', { name: /Share of AI Overviews/ })
    const counts = table.locator('button[data-nfr-drill]')
    const total = await counts.count()
    expect(total).toBeGreaterThan(3)
    for (let index = 0; index < total; index += 1) {
      await openAndCount(page, panel, counts.nth(index))
      await close(page)
    }
    await panel.getByRole('button', { name: 'Chart', exact: true }).click()

    // Fix card (Fixes tab): the comparison count, and result links pinned to the follow-up check.
    const sections = panel.getByRole('tablist', { name: 'Progress sections' })
    await sections.getByRole('tab', { name: /^Fixes/ }).click()
    const fix1 = panel.getByRole('article', { name: /^Fix 1 · / })
    await expect(fix1).toHaveAttribute('id', 'fix-1')
    const others = fix1.getByRole('button', { name: /of the \d+ questions? you didn’t target/ })
    if ((await others.count()) > 0) {
      await openAndCount(page, panel, others.first())
      await close(page)
    }
    const result = fix1.getByRole('link', { name: /open the follow-up result$/ }).first()
    await expect(result).toHaveAttribute('href', /\/prompt\/[^?]+\?market=[^&]+&run=/)

    // Prompt history (Prompts tab): each result opens that check; a fix mark jumps to the card.
    await sections.getByRole('tab', { name: /^Questions/ }).click()
    const history = panel
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Each question across checks' }) })
    await expect(
      history.getByRole('link', { name: / on .*, open that result$/ }).first()
    ).toHaveAttribute('href', /&run=/)
    await history
      .getByRole('button', { name: /Fix 1 · Targeted, go to the fix/ })
      .first()
      .click()
    await expect(fix1).toBeFocused()
    await expect(page.getByText(/Error invoking remote method/)).toHaveCount(0)
  } finally {
    await quit()
  }
})
