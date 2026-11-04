import { expect, test, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { drawerShots } from './drawer-helpers'
import { launchCiteFox } from './launch'
import { installRawMarkdown } from './raw-hook'
import { expectMainAccessible, openHash, shot } from './screens-app'
import { openAllPages } from './nav-helpers'

const PAGE = 'page-1'

async function openSeeded(): Promise<{ page: Page; close: () => Promise<void> }> {
  installRawMarkdown()
  const { seedProgressProject } = await import('./progress-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-progress-'))
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

async function top(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelector('#main')?.scrollTo(0, 0))
}

/** A 1280×900 shot with the named heading scrolled to the top of the main pane. */
async function shotAt(page: Page, name: string, heading: RegExp): Promise<void> {
  await page
    .getByRole('heading', { name: heading })
    .first()
    .evaluate((node) => {
      const main = document.querySelector('#main')
      if (!main) return
      const offset = node.getBoundingClientRect().top - main.getBoundingClientRect().top
      main.scrollTo(0, main.scrollTop + offset - 16)
    })
  await shot(page, name)
}

test('Progress logs a fix, shows its verdict and markers on real IPC', async () => {
  test.setTimeout(180_000)
  const { page, close } = await openSeeded()
  try {
    await openHash(page, `#/pages/${PAGE}/progress`)
    const panel = page.locator('#page-tabpanel')
    await expect(
      panel.getByRole('heading', {
        name: /^What changed since the last check \(Oct 5(, [\d:]+\s?[AP]M)? → Oct 19(, [\d:]+\s?[AP]M)?\)$/
      })
    ).toBeVisible()
    await expect(panel.getByText(/doesn’t claim one caused the other/)).toBeVisible()

    // FR-14.3: Fix 1 is a marker; the Oct 12 follow-up is a hollow point out of the trend line.
    const chart = panel.getByRole('img', { name: /Share of AI Overviews that cite this page/ })
    await expect(chart).toHaveAttribute(
      'aria-label',
      /Fix 1 · Oct 8(, \d{1,2}:\d{2}\s?[AP]M)? logged/
    )
    // The partial follow-up is the one hollow point (filled with the surface token by CSS).
    expect(await chart.locator('.ui-chart-dot-hollow').count()).toBe(1)
    // Fix 1 is a numbered marker on the baseline; a click opens it in its drawer, in place.
    const marker = panel.getByRole('button', { name: /Your fix: Fix 1 · / })
    await expect(marker).toHaveText('1')
    await marker.click()
    await expect(page).toHaveURL(/drawer=fix&fix=/)
    await expect(page).toHaveURL(/progress/)
    await expect(page.getByRole('dialog', { name: 'Fix 1' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page).not.toHaveURL(/drawer=fix/)
    await panel.getByRole('button', { name: 'Table', exact: true }).click()
    await expect(panel.getByRole('gridcell', { name: 'No, partial check' }).first()).toBeVisible()
    await expect(panel.getByRole('gridcell', { name: /Fix 1 · Added a pricing FAQ/ })).toBeVisible()
    await panel.getByRole('button', { name: 'Chart', exact: true }).click()

    // FR-14.7 (Fixes tab): verdict from the before and after checks, and the comparison line.
    const sections = panel.getByRole('tablist', { name: 'Progress sections' })
    await sections.getByRole('tab', { name: /^Fixes/ }).click()
    await expect(panel.getByRole('grid', { name: 'Logged fixes' })).toBeVisible()
    const fix1 = panel.getByRole('article', { name: /^Fix 1 · / })
    await expect(fix1.locator('.fx-verdict')).toHaveText('Worked')
    await expect(fix1.getByRole('strong')).toHaveText('pricing')
    await expect(
      fix1.getByText(/checked Oct 12(, \d{1,2}:\d{2}\s?[AP]M)?, 4 days later \(follow-up\)/)
    ).toBeVisible()
    await expect(fix1.getByRole('gridcell', { name: /Other own page/ })).toBeVisible()
    await expect(fix1.getByRole('gridcell', { name: /Page cited/ })).toBeVisible()
    await expect(fix1.getByText(/1 of the 2 questions you didn’t target also moved/)).toBeVisible()
    await shotAt(page, 'progress-verdict', /Fixes and what happened/)
    await sections.getByRole('tab', { name: 'Overview' }).click()
    await top(page)
    await shot(page, 'progress-changed')
    await shotAt(page, 'progress-chart', /How often overviews cite this page/)
    await sections.getByRole('tab', { name: /^Fixes/ }).click()

    // FR-14.5, FR-14.10: log a fix that goes live tomorrow in the fix drawer, with its
    // kind, its cost and the recrawl reminder.
    await panel.getByRole('button', { name: 'Log a fix' }).click()
    await expect(page).toHaveURL(/drawer=fix&fix=new&fix\.page=page-1/)
    const form = page.getByRole('dialog', { name: 'Log a fix' })
    await form.getByLabel('What changed').fill('Add a Saturday scheduling FAQ.')
    await form.getByRole('checkbox', { name: /alert the crew without a developer/ }).check()
    await form.getByLabel('Kind of change').selectOption('rewrite')
    const tomorrow = await page.evaluate(() => {
      const date = new Date(Date.now() + 86_400_000)
      const pad = (value: number): string => String(value).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    })
    await form.getByLabel('Goes live on').fill(tomorrow)
    await expect(
      form.getByText(/The follow-up uses 2–4 searches \(1 question × 2 markets\)\./)
    ).toBeVisible()
    await expect(form.getByText(/requesting indexing in Google Search Console/)).toBeVisible()
    await expect(form.getByRole('option', { name: /^3 days after it goes live \(/ })).toBeAttached()
    await form.getByRole('button', { name: 'Log fix' }).click()
    await expect(form).toHaveCount(0)
    await expect(panel.getByText(/^Saved Fix 2 · follow-up check /)).toBeVisible()
    const fix2 = panel.getByRole('article', { name: /^Fix 2 · / })
    await expect(fix2.locator('.fx-verdict')).toHaveText('Waiting for the follow-up')
    await expect(fix2.getByRole('button', { name: 'Run follow-up now' })).toBeVisible()
    await sections.getByRole('tab', { name: 'Overview' }).click()
    await expect(chart).toHaveAttribute('aria-label', /Fix 2 · .* planned/)

    // FR-14.8 (Prompts tab): Targeted and Planned marks in Each prompt across checks.
    await sections.getByRole('tab', { name: /^Questions/ }).click()
    const grid = panel
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Each question across checks' }) })
    await expect(grid.getByText('Fix 1 · Targeted')).toBeVisible()
    await expect(grid.getByText('Fix 2 · Planned')).toBeVisible()
    await expect(page.getByText(/Error invoking remote method/)).toHaveCount(0)
    await expectMainAccessible(page)
    await shotAt(page, 'progress-prompt-marks', /Each question across checks/)
    await sections.getByRole('tab', { name: /^Fixes/ }).click()
    await shotAt(page, 'progress-fixes', /Fixes and what happened/)

    // An old "Plan as Fix N" link (`plan=1`) opens the fix drawer prefilled.
    await openHash(page, `#/pages/${PAGE}/results`)
    await expect(page.getByRole('tab', { name: 'Results' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await openHash(
      page,
      `#/pages/${PAGE}/progress?plan=1&prompts=prompt-3&text=${encodeURIComponent('1. Add a reply-by-email FAQ')}`
    )
    const planned = page.getByRole('dialog', { name: 'Log a fix' })
    await expect(planned.getByLabel('What changed')).toHaveValue('1. Add a reply-by-email FAQ')
    await expect(
      planned.getByRole('checkbox', { name: /reply to an alert by email/ })
    ).toBeChecked()
    // The old keys are gone; the drawer keeps the draft on its own URL over Progress › Fixes.
    await expect(page).toHaveURL(
      new RegExp(`#/pages/${PAGE}/progress\\?view=fixes&drawer=fix&fix=new&fix\\.page=${PAGE}`)
    )
    expect(await page.evaluate(() => window.location.hash)).not.toContain('plan=1')
  } finally {
    await close()
  }
})

test('History lists checks, content changes, fixes and notes on real IPC', async () => {
  test.setTimeout(180_000)
  const { page, close } = await openSeeded()
  try {
    await openHash(page, `#/pages/${PAGE}/history`)
    const panel = page.locator('#page-tabpanel')
    const grid = panel.getByRole('grid', { name: 'Page history' })
    await expect(grid).toBeVisible()
    await expect(grid.getByText('Manual check').first()).toBeVisible()
    await expectMainAccessible(page)
    await top(page)
    await shot(page, 'history-grid')
    await panel.getByRole('tab', { name: /^Timeline/ }).click()
    const timeline = panel.locator('ol.hist-timeline')
    await expect(timeline.getByText('Manual check').first()).toBeVisible()
    await expect(timeline.getByText(/Follow-up check for Fix 1/)).toBeVisible()
    await expect(timeline.getByText('Rewrote the intro and added two FAQs.')).toBeVisible()
    await expect(timeline.getByText(/Fix 1 · Added a/)).toBeVisible()
    await expect(timeline.getByText('Question set v1 saved')).toBeVisible()
    await expectMainAccessible(page)
    await top(page)
    await shot(page, 'history-timeline')

    // FR-15.1 Compare content: a readable diff of the Oct 5 and Oct 15 reads.
    await panel
      .getByRole('button', { name: /Compare content/ })
      .first()
      .click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/2 FAQs added/)).toBeVisible()
    await expect(dialog.getByText('Schedule them for Saturday morning.')).toBeVisible()
    await expect(dialog.getByText('Q: Can staff reply to an alert?')).toBeVisible()
    await shot(page, 'history-compare')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    // FR-15.3: add, edit and delete a note with a date. Add a note is a drawer on the URL.
    const addNote = panel.getByRole('button', { name: 'Add note' })
    await addNote.click()
    const aside = page.getByRole('dialog', { name: 'Add a note' })
    await expect(aside).toBeVisible()
    await expect(page).toHaveURL(/drawer=hist-note/)
    // Back closes it; Escape closes it; unsaved text asks first.
    await page.goBack()
    await expect(aside).toHaveCount(0)
    await addNote.click()
    await page.keyboard.press('Escape')
    await expect(aside).toHaveCount(0)
    await expect(page).not.toHaveURL(/hist-note/)
    await addNote.click()
    await aside.getByRole('textbox', { name: 'Note' }).fill('Half a thought')
    await page.keyboard.press('Escape')
    const ask = page.getByRole('alertdialog', { name: 'Discard changes?' })
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: 'Keep editing' }).click()
    await expect(aside).toBeVisible()
    await page.goBack()
    // Back with unsaved text puts the drawer back and asks too.
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: 'Discard' }).click()
    await expect(aside).toHaveCount(0)

    await addNote.click()
    await aside.getByLabel('Date').fill('2026-10-18')
    await aside
      .getByRole('textbox', { name: 'Note' })
      .fill('Asked Search Console to recrawl the page.')
    await shot(page, 'history-add-note')
    await drawerShots(page, 'history-add-note')
    await aside.getByRole('button', { name: 'Save note' }).click()
    await expect(aside).toHaveCount(0)
    await expect(timeline.getByText('Asked Search Console to recrawl the page.')).toBeVisible()
    await panel
      .getByRole('group', { name: 'Show events' })
      .getByRole('button', { name: /^Notes/ })
      .click()
    await expect(panel.getByText(/2 events of /)).toBeVisible()
    await timeline.getByRole('button', { name: /^Edit note from Oct 18/ }).click()
    const editor = timeline.getByRole('textbox', { name: 'Note' })
    await editor.fill('Asked Search Console to recrawl the page (Oct 18).')
    await timeline.getByRole('button', { name: /^Save/ }).click()
    await expect(editor).toHaveCount(0)
    await expect(
      timeline.getByText('Asked Search Console to recrawl the page (Oct 18).')
    ).toBeVisible()
    await timeline.getByRole('button', { name: /^Delete note from Oct 18/ }).click()
    await page
      .getByRole('alertdialog', { name: 'Delete this note?' })
      .getByRole('button', { name: 'Delete note', exact: true })
      .click()
    await expect(timeline.getByText('Rewrote the intro and added two FAQs.')).toBeVisible()
    await expect(panel.getByText('Asked Search Console to recrawl the page (Oct 18).')).toHaveCount(
      0
    )

    await panel
      .getByRole('group', { name: 'Show events' })
      .getByRole('button', { name: /^All/ })
      .click()
    await panel.getByRole('tab', { name: /^Events/ }).click()
    await expect(panel.getByRole('columnheader', { name: /Score/ })).toBeVisible()
    await expect(grid.getByText('Manual check').first()).toBeVisible()
    await expect(page.getByText(/Error invoking remote method/)).toHaveCount(0)
    await grid
      .locator('[data-row]')
      .filter({ hasText: 'Manual check' })
      .first()
      .locator('.hist-cell-title')
      .click()
    const event = page.getByTestId('hist-event-drawer')
    await expect(event).toBeVisible()
    await expect(page).toHaveURL(/drawer=hist-event&he\.id=/)
    const eventLink = await page.evaluate(() => window.location.hash)
    await expect(event.getByTestId('hist-nearby')).toBeVisible()
    await shot(page, 'history-event-panel')
    await drawerShots(page, 'history-event')
    await page.keyboard.press('Escape')
    await expect(event).toHaveCount(0)
    await expect(page).not.toHaveURL(/hist-event/)
    // A copied link opens the event again; Back closes it.
    await page.evaluate((hash) => {
      window.location.hash = hash
    }, eventLink)
    await expect(event).toBeVisible()
    await page.goBack()
    await expect(event).toHaveCount(0)
    await expectMainAccessible(page)
    await top(page)
    await shot(page, 'history-table')
  } finally {
    await close()
  }
})
