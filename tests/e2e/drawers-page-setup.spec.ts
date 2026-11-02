import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { drawerShots } from './drawer-helpers'
import { launchCiteFox } from './launch'
import { openAllPages } from './nav-helpers'
import { openHash, openTwoMarketApp } from './screens-app'

/**
 * Wave 3 (A1): the page setup panels are drawers on the URL. Prompts tab
 * (Add my own, Edit question, Rephrase, Prompt settings), Buyer profile (Edit
 * buyer profile, Profile settings), Content gaps settings, and Prompt detail
 * (Edit question, Check now). A link opens each, Esc / ✕ / Back close it, old
 * `?panel=` and `?filter=` links still open it, and a form with changes asks
 * before it closes (Esc and Back).
 */

async function launchMock(): Promise<{ app: ElectronApplication; page: Page; dir: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-a1-drawers-'))
  const viewport = { width: 1280, height: 900 }
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

function hash(page: Page): Promise<string> {
  return page.evaluate(() => window.location.hash)
}

async function back(page: Page): Promise<void> {
  await page.evaluate(() => window.history.back())
}

/** The drawer's frame takes most of the window: it is a drawer, not a side panel. */
async function expectWideDrawer(page: Page, dialog: Locator): Promise<void> {
  const box = await dialog.boundingBox()
  const width = page.viewportSize()?.width ?? 0
  expect(box?.width ?? 0).toBeGreaterThan(width * 0.6)
}

test('Prompts tab, Buyer profile and Content gaps drawers live on the URL', async () => {
  test.setTimeout(300_000)
  const { app, page, dir } = await launchMock()
  try {
    const prompts = '#/pages/alerts/prompts'
    await openHash(page, prompts)
    const grid = page.getByRole('grid', { name: 'Buyer questions' })
    await expect(grid.locator('.ui-lg-row').first()).toBeVisible()

    await test.step('Prompt settings: a link opens it, Esc closes it and the URL loses it', async () => {
      await openHash(page, `${prompts}?drawer=pt-settings`)
      const settings = page.getByRole('dialog', { name: 'Question settings' })
      await expect(settings).toBeVisible()
      await expectWideDrawer(page, settings)
      await expect(settings.getByLabel('Buyer questions to write')).toBeVisible()
      await drawerShots(page, 'a1-prompt-settings')
      await page.keyboard.press('Escape')
      await expect(settings).toHaveCount(0)
      await expect.poll(() => hash(page)).not.toContain('drawer=')
    })

    let editHash = ''
    await test.step('Edit question: opens from the row menu, Back closes it', async () => {
      await grid.getByRole('button', { name: 'Actions for question 1', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Edit wording' }).click()
      const editor = page.getByRole('dialog', { name: 'Edit question' })
      await expect(editor).toBeVisible()
      await expect.poll(() => hash(page)).toMatch(/drawer=pt-edit&pt\.edit=/)
      editHash = await hash(page)
      await expect(editor.getByText('Question, as a buyer would type it')).toBeVisible()
      await drawerShots(page, 'a1-prompt-edit')
      await back(page)
      await expect(editor).toHaveCount(0)
      await expect.poll(() => hash(page)).not.toContain('drawer=')
    })

    await test.step('unsaved wording: Esc and Back ask first; Discard closes', async () => {
      await openHash(page, editHash)
      const editor = page.getByRole('dialog', { name: 'Edit question' })
      await expect(editor).toBeVisible()
      const field = editor.getByRole('textbox')
      await field.fill(`${await field.inputValue()} on a Saturday`)
      await page.keyboard.press('Escape')
      const ask = page.getByRole('alertdialog', { name: 'Discard changes?' })
      await expect(ask).toBeVisible()
      await ask.getByRole('button', { name: 'Keep editing' }).click()
      await expect(editor).toBeVisible()
      await back(page)
      await expect(ask).toBeVisible()
      await expect(editor).toBeVisible()
      await expect.poll(() => hash(page)).toContain('drawer=pt-edit')
      await ask.getByRole('button', { name: 'Discard' }).click()
      await expect(editor).toHaveCount(0)
      await expect.poll(() => hash(page)).not.toContain('drawer=')
    })

    await test.step('Add my own and Rephrase open as drawers and close on ✕', async () => {
      await page.getByRole('button', { name: 'Add my own' }).click()
      const add = page.getByRole('dialog', { name: 'Add my own question' })
      await expect(add).toBeVisible()
      await expect.poll(() => hash(page)).toContain('drawer=pt-add')
      await add.getByRole('button', { name: 'Close Add my own question' }).click()
      await expect(add).toHaveCount(0)

      await grid.getByRole('button', { name: 'Actions for question 1', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Rephrase like a buyer' }).click()
      const rephrase = page.getByRole('dialog', { name: /^Rephrase question/ })
      await expect(rephrase).toBeVisible()
      await expect.poll(() => hash(page)).toMatch(/drawer=pt-rephrase&pt\.rephrase=/)
      await drawerShots(page, 'a1-prompt-rephrase')
      await rephrase.getByRole('button', { name: /^Close Rephrase question/ }).click()
      await expect(rephrase).toHaveCount(0)
      await expect.poll(() => hash(page)).not.toContain('drawer=')
    })

    await test.step('an old ?filter=settings link opens the drawer', async () => {
      await openHash(page, `${prompts}?filter=settings`)
      await expect(page.getByRole('dialog', { name: 'Question settings' })).toBeVisible()
      await expect.poll(() => hash(page)).toBe(`${prompts}?drawer=pt-settings`)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
    })

    await test.step('Buyer profile: Edit buyer profile and Profile settings', async () => {
      await openHash(page, '#/pages/alerts/audience?drawer=au-edit')
      const edit = page.getByRole('dialog', { name: 'Edit buyer profile' })
      await expect(edit).toBeVisible()
      await expectWideDrawer(page, edit)
      await expect(edit.getByLabel('Who they are')).toBeVisible()
      await drawerShots(page, 'a1-profile-edit')
      await page.keyboard.press('Escape')
      await expect(edit).toHaveCount(0)
      await expect.poll(() => hash(page)).toBe('#/pages/alerts/audience')

      await page.getByRole('button', { name: 'Profile settings' }).first().click()
      const settings = page.getByRole('dialog', { name: 'Profile settings' })
      await expect(settings).toBeVisible()
      await expect.poll(() => hash(page)).toContain('drawer=au-settings')
      await drawerShots(page, 'a1-profile-settings')
      await back(page)
      await expect(settings).toHaveCount(0)
      await expect.poll(() => hash(page)).toBe('#/pages/alerts/audience')
    })

    await test.step('Content gaps: an old ?panel=settings link, ✕, and filters on the URL', async () => {
      await openHash(page, '#/pages/alerts/gaps?panel=settings')
      const settings = page.getByRole('dialog', { name: 'Content gaps settings' })
      await expect(settings).toBeVisible()
      await expect.poll(() => hash(page)).toBe('#/pages/alerts/gaps?drawer=gp-settings')
      await expect(settings.getByRole('button', { name: 'Write content gaps again' })).toBeVisible()
      await drawerShots(page, 'a1-gaps-settings')
      await settings.getByRole('button', { name: 'Close Content gaps settings' }).click()
      await expect(settings).toHaveCount(0)
      await expect.poll(() => hash(page)).toBe('#/pages/alerts/gaps')

      await page
        .getByRole('group', { name: 'Filter by coverage' })
        .getByRole('button', { name: /^Strong/ })
        .click()
      await expect.poll(() => hash(page)).toBe('#/pages/alerts/gaps?gf.cov=strong')
      await expect(page.getByText(/^Showing \d+ of 10 questions$/)).toBeVisible()
      await back(page)
      await expect.poll(() => hash(page)).toBe('#/pages/alerts/gaps')
      await expect(page.getByText(/^Showing \d+ of 10 questions$/)).toHaveCount(0)
    })
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('Prompt detail: Edit question and Check now are drawers on the URL', async () => {
  test.setTimeout(180_000)
  const { page, close } = await openTwoMarketApp('a1-prompt-detail')
  try {
    const here = '#/pages/page-1/prompt/prompt-1'
    await openHash(page, here)
    const screen = page.getByTestId('prompt-detail')
    await expect(screen.getByRole('heading', { level: 1 })).toBeVisible()

    await test.step('a link opens Edit question; changed wording asks before Esc closes', async () => {
      await openHash(page, `${here}?drawer=pd-edit`)
      const editor = page.getByRole('dialog', { name: 'Edit question' })
      await expect(editor).toBeVisible()
      await expectWideDrawer(page, editor)
      await expect(editor.getByRole('region', { name: 'Wording rules' })).toBeVisible()
      await drawerShots(page, 'a1-prompt-detail-edit')
      const field = editor.getByRole('textbox')
      await field.fill(`${await field.inputValue()} today`)
      await page.keyboard.press('Escape')
      const ask = page.getByRole('alertdialog', { name: 'Discard changes?' })
      await ask.getByRole('button', { name: 'Discard' }).click()
      await expect(editor).toHaveCount(0)
      await expect.poll(() => hash(page)).toBe(here)
    })

    await test.step('Check now opens from More; Back closes it', async () => {
      await screen.getByRole('button', { name: 'More fix actions' }).click()
      await page.getByRole('menuitem', { name: 'Check now' }).click()
      const recheck = page.getByRole('dialog', { name: 'Check this question now' })
      await expect(recheck).toBeVisible()
      await expect.poll(() => hash(page)).toBe(`${here}?drawer=pd-recheck`)
      await drawerShots(page, 'a1-prompt-detail-recheck')
      await back(page)
      await expect(recheck).toHaveCount(0)
      await expect.poll(() => hash(page)).toBe(here)
    })
  } finally {
    await close()
  }
})
