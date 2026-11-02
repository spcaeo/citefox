import { expect, test } from '@playwright/test'
import Database from 'better-sqlite3'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import {
  Audit,
  EMPTY,
  SEEDED,
  focusInside,
  focusRingVisible,
  focusedName,
  freshDir,
  relaunch,
  settle
} from './a11y-helpers'
import { chooseRowAction } from './row-menu'
import { openHash, openTwoMarketApp } from './screens-app'
import { leaveFirstRun, openStartChoice } from './first-run-helpers'
import { expectTopicLanding, MOCK_LANDING_TOPIC, walkSetup } from './setup-walk'

/**
 * M8 accessibility pass: every built screen, drawer and dialog through axe
 * (WCAG 2.2 AA), then the main flows from the keyboard alone.
 */

test('onboarding steps and mock-only dialogs pass axe', async () => {
  test.setTimeout(180_000)
  const audit = new Audit('onboarding')
  const dir = await freshDir('a11y-onboarding')
  const { app, page } = await relaunch(dir, async (first) => {
    await expect(first.getByRole('heading', { level: 1, name: /See whether Google/ })).toBeVisible()
    await first.evaluate(() => {
      localStorage.setItem('citefox.client', 'mock')
      localStorage.setItem('citefox.mock.pace', '0')
    })
  })
  try {
    // Every onboarding v2 screen, walked as a person does (tests/e2e/setup-walk.ts).
    await walkSetup(page, {
      serpKey: 'citefox-sample-serpapi-b1f4',
      onStep: async (step) => {
        if (step === 'welcome') {
          await audit.check(page, 'onboarding-main')
          return
        }
        if (step === 'site') {
          // Enter in a field submits; with a bad website the field explains why.
          const domain = page.getByLabel(/Your website/)
          await domain.fill('not a site')
          await domain.press('Enter')
          await expect(page.getByRole('alert').first()).toBeVisible()
          await audit.check(page, 'onboarding-site-errors')
          await domain.fill('textbolt.com')
        }
        await audit.check(page, `onboarding-${step}`)
      }
    })
    // Finish opens the topic setup made; "How do you want to start?" stays on its URL.
    await expectTopicLanding(page, MOCK_LANDING_TOPIC)
    await openStartChoice(page)
    await audit.check(page, 'start-choose')
    await leaveFirstRun(page)
    await openHash(page, '#/playground')
    await expect(page.getByRole('heading', { level: 1, name: 'Playground' })).toBeVisible()
    await page
      .getByLabel('URL')
      .fill('https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/')
    await page
      .getByRole('grid', { name: 'Choose a template' })
      .getByRole('row', { name: /Buyer questions/ })
      .click()
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    await expect(page.getByRole('heading', { name: '10 questions' })).toBeVisible()
    await audit.check(page, 'playground-result')
    const saveButton = page.getByRole('button', { name: 'Save to project' })
    await saveButton.click()
    const save = page.getByRole('dialog', { name: 'Save to project' })
    await expect(save).toBeVisible()
    await audit.check(page, 'dialog-playground-save')
    await page.keyboard.press('Escape')
    await expect(save).toHaveCount(0)
    await expect(saveButton).toBeFocused()

    await openHash(page, '#/settings?tab=email')
    const screen = page.locator('.stg-page')
    await expect(screen.getByRole('tab', { name: 'Email', exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await screen.getByRole('button', { name: /Other SMTP/ }).click()
    await screen.getByLabel('SMTP host').fill('smtp.example.com')
    await screen.getByLabel('From address').fill('reports@example.com')
    await screen.getByLabel('Username').fill('reports@example.com')
    await screen.getByLabel('Password', { exact: true }).fill('placeholder-not-a-secret')
    await screen.getByRole('button', { name: 'Save account' }).click()
    await chooseRowAction(page, screen, 'reports@example.com', 'Remove SMTP account')
    const remove = page.getByRole('alertdialog', { name: 'Remove this sending account?' })
    await expect(remove).toBeVisible()
    await audit.check(page, 'dialog-remove-account')
    await page.keyboard.press('Escape')
    await expect(remove).toHaveCount(0)
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
  await audit.finish()
})

test('first-run screens with no project pass axe and say what to do next', async () => {
  test.setTimeout(240_000)
  const audit = new Audit('empty')
  const dir = await freshDir('a11y-empty')
  const { app, page } = await relaunch(dir, async () => {
    const db = new Database(path.join(dir, 'app.sqlite'))
    try {
      db.prepare('UPDATE app_state SET onboarding_finished = 1 WHERE id = 1').run()
    } finally {
      db.close()
    }
  })
  try {
    for (const entry of EMPTY) {
      await openHash(page, entry.hash)
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
      await settle(page)
      if (entry.next) {
        await expect(
          page.locator('#main').getByRole('link', { name: entry.next }).first(),
          `${entry.screen} links to its next step`
        ).toBeVisible()
      }
      await audit.check(page, entry.screen)
    }
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
  await audit.finish()
})

test('seeded screens, drawers and dialogs pass axe', async () => {
  test.setTimeout(600_000)
  const audit = new Audit('seeded')
  const { page, close } = await openTwoMarketApp('a11y')
  try {
    for (const entry of SEEDED) {
      await openHash(page, entry.hash)
      await expect(
        page.getByRole('heading', { level: 1, name: entry.heading }).first()
      ).toBeVisible()
      await settle(page)
      await audit.check(page, entry.screen)
    }

    await openHash(page, '#/pages')
    const switcher = page.getByRole('button', { name: /^Switch project/ })
    await switcher.click()
    await expect(page.getByRole('group', { name: 'Projects' })).toBeVisible()
    // The open menu covers the sidebar links under it (a click outside closes it first).
    await audit.check(page, 'switcher-open', '.side-scroll')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('group', { name: 'Projects' })).toHaveCount(0)

    await page.locator('.status-pill').click()
    const popover = page.getByRole('dialog', { name: 'Credits and connections' })
    await expect(popover).toBeVisible()
    // The open popover covers the screen header's ⋯ under it (a click outside closes it first).
    await audit.check(page, 'status-popover', '#main .ui-head-more')
    await page.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)

    await openHash(page, '#/pages/page-1/results')
    await settle(page)
    await page
      .getByRole('tablist', { name: 'Results sections' })
      .getByRole('tab', { name: /^Breakdown/ })
      .click()
    await page
      .locator('#page-tabpanel')
      .getByRole('button', { name: /Questions checked/ })
      .first()
      .click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await audit.check(page, 'drill-drawer')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await openHash(page, '#/pages/page-1/progress')
    await settle(page)
    await page.locator('button[data-nfr-drill^="market:"]').first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await audit.check(page, 'count-drawer')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await openHash(page, '#/reports?tab=emails')
    const reports = page.locator('.rpt')
    await expect(reports.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible()
    await reports.getByRole('button', { name: 'New schedule' }).first().click()
    const form = reports.locator('[data-drawer="schedule"]')
    await form.getByLabel('Name').fill('A11y report')
    await form.getByLabel('Project', { exact: true }).selectOption({ label: 'TextBolt' })
    await form.getByLabel('Recipients').fill('reports@example.com')
    await form.getByRole('button', { name: 'Add', exact: true }).click()
    await audit.check(page, 'schedule-form')
    await form.getByRole('button', { name: 'Save schedule' }).click()
    await reports.getByRole('button', { name: 'Actions for A11y report' }).focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('End')
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeFocused()
    await page.keyboard.press('Enter')
    const deleteSchedule = page.getByRole('alertdialog', { name: 'Delete this schedule?' })
    await expect(deleteSchedule).toBeVisible()
    await audit.check(page, 'confirm-delete-schedule')
    await page.keyboard.press('Escape')
    await expect(deleteSchedule).toHaveCount(0)

    await openHash(page, '#/templates')
    await expect(page.getByRole('heading', { level: 1, name: 'Templates' })).toBeVisible()
    await settle(page)
    await page.getByRole('tab', { name: /^App templates/ }).click()
    await page.getByRole('button', { name: 'New template' }).click()
    const editor = page.getByRole('region', { name: 'Template editor' })
    await editor.getByLabel('Name').fill('A11y notes')
    await editor.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(editor.getByLabel('Name')).toHaveValue('A11y notes')
    await editor.getByRole('button', { name: 'Template actions' }).click()
    await editor.getByRole('menuitem', { name: 'Delete' }).click()
    const deleteTemplate = page.getByRole('alertdialog', { name: 'Delete this template?' })
    await expect(deleteTemplate).toBeVisible()
    await audit.check(page, 'confirm-delete-template')
    await page.keyboard.press('Escape')
    await expect(deleteTemplate).toHaveCount(0)
  } finally {
    await close()
  }
  await audit.finish()
})

test('main flows work from the keyboard alone', async () => {
  test.setTimeout(240_000)
  const { page, close } = await openTwoMarketApp('a11y-keys')
  try {
    // Skip link first, and it moves focus to the main landmark.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Tab')
    expect(await focusedName(page)).toBe('Skip to main content')
    await page.keyboard.press('Enter')
    await expect(page.locator('#main')).toBeFocused()

    // Every Tab stop in the All pages screen shows a focus ring, and Shift+Tab walks back.
    const forward: string[] = []
    for (let step = 0; step < 14; step += 1) {
      await page.keyboard.press('Tab')
      if (!(await focusInside(page, '#main'))) break
      const ring = await focusRingVisible(page)
      expect(ring.ok, `focus ring on ${ring.name}`).toBe(true)
      forward.push(await focusedName(page))
    }
    expect(forward.length).toBeGreaterThan(3)
    await page.keyboard.press('Shift+Tab')
    expect(await focusedName(page)).toBe(forward[forward.length - 2])

    // Project switcher: Enter opens with focus in the search box, Escape returns to the button.
    const switcher = page.getByRole('button', { name: /^Switch project/ })
    await switcher.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('searchbox', { name: 'Find project' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('group', { name: 'Projects' })).toHaveCount(0)
    await expect(switcher).toBeFocused()

    // Open the page from the grid with Enter.
    await page.locator('#main').getByRole('link', { name: 'Alerts', exact: true }).first().focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { level: 1, name: /Text alerts/ })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Results', exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    )

    // Results tabs: Enter on a tab opens it; the funnel is in Breakdown.
    const breakdown = page
      .getByRole('tablist', { name: 'Results sections' })
      .getByRole('tab', { name: /^Breakdown/ })
    await breakdown.focus()
    await page.keyboard.press('Enter')
    await expect(breakdown).toHaveAttribute('aria-selected', 'true')

    // Drill drawer: Space opens, focus moves in, Tab and Shift+Tab stay in, Escape restores focus.
    const drill = page
      .locator('#page-tabpanel')
      .getByRole('button', { name: /Questions checked/ })
      .first()
    await drill.focus()
    await page.keyboard.press('Space')
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()
    expect(await focusInside(page, '[role="dialog"]')).toBe(true)
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press('Tab')
      expect(await focusInside(page, '[role="dialog"]')).toBe(true)
    }
    for (let step = 0; step < 4; step += 1) {
      await page.keyboard.press('Shift+Tab')
      expect(await focusInside(page, '[role="dialog"]')).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
    await expect(drill).toBeFocused()

    // Prompt grid: back on the Prompts tab, Enter on a prompt's row opens its detail.
    const prompts = page
      .getByRole('tablist', { name: 'Results sections' })
      .getByRole('tab', { name: /^Questions/ })
    await prompts.focus()
    await page.keyboard.press('Enter')
    const grid = page.getByRole('grid', { name: /Buyer questions from the/ })
    await grid
      .locator('.ui-lg-row', {
        has: page.getByTitle('How do I alert the crew without a developer?')
      })
      .focus()
    await page.keyboard.press('Enter')
    await expect(
      page.getByRole('heading', { level: 1, name: 'How do I alert the crew without a developer?' })
    ).toBeVisible()

    // Count drawer on Progress: Enter opens it, Escape closes it and focus returns.
    await openHash(page, '#/pages/page-1/progress')
    await settle(page)
    const count = page.locator('button[data-nfr-drill^="market:"]').first()
    await count.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(await focusInside(page, '[role="dialog"]')).toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(count).toBeFocused()

    // Status popover from the capsule: Enter opens, Escape closes back to the capsule.
    const capsule = page.locator('.status-pill')
    await capsule.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Credits and connections' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Credits and connections' })).toHaveCount(0)
    await expect(capsule).toBeFocused()

    // Template delete confirmation: Escape cancels and keeps the template.
    await openHash(page, '#/templates')
    await settle(page)
    await page.getByRole('tab', { name: /^App templates/ }).click()
    await page.getByRole('button', { name: 'New template' }).click()
    const editor = page.getByRole('region', { name: 'Template editor' })
    await editor.getByLabel('Name').fill('Keyboard notes')
    await editor.getByRole('button', { name: 'Create', exact: true }).click()
    // Delete sits under the editor's ⋯: open it from the keyboard, pick Delete.
    const remove = editor.getByRole('button', { name: 'Template actions' })
    await remove.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menuitem', { name: 'Set as default' })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeFocused()
    await page.keyboard.press('Enter')
    const confirm = page.getByRole('alertdialog', { name: 'Delete this template?' })
    await expect(confirm).toBeVisible()
    expect(await focusInside(page, '[role="alertdialog"]')).toBe(true)
    await page.keyboard.press('Escape')
    await expect(confirm).toHaveCount(0)
    await expect(remove).toBeFocused()
    await expect(editor.getByLabel('Name')).toHaveValue('Keyboard notes')
  } finally {
    await close()
  }
})
