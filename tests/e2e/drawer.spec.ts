import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { animationsDone, drawerShots } from './drawer-helpers'
import { launchCiteFox } from './launch'
import { openAdd, openNewTopic } from './nav-helpers'
import { openHash, openTwoMarketApp } from './screens-app'

/**
 * The shared drawer (Docs/DRAWER.md) on the TextBolt mock catalog: every
 * drawer is on the URL, so a link opens it, Back closes it, Forward and a
 * copied link reopen it. Esc, the unsaved-changes guard, focus return,
 * stacking and the breadcrumbs are checked on the real shell.
 */

async function launchShell(): Promise<{ app: ElectronApplication; page: Page; dir: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-drawer-'))
  const seeded = await launchCiteFox({ userDataDir: dir })
  try {
    await seeded.page.evaluate(() => {
      localStorage.setItem('citefox.client', 'mock')
      localStorage.setItem('citefox.mock.catalog', 'textbolt')
      localStorage.setItem('citefox.mock.pace', '0')
    })
  } finally {
    await seeded.app.close()
  }
  const { app, page } = await launchCiteFox({ userDataDir: dir })
  return { app, page, dir }
}

function hash(page: Page): Promise<string> {
  return page.evaluate(() => window.location.hash)
}

function heading(page: Page, name: string | RegExp): Locator {
  return page.getByRole('heading', { level: 1, name })
}

/** The drawer's breadcrumb, crumb by crumb. */
async function crumbs(dialog: Locator): Promise<string[]> {
  const items = dialog.getByRole('navigation', { name: 'Drawer breadcrumb' }).getByRole('listitem')
  return (await items.allTextContents()).map((text) => text.replace('›', '').trim())
}

test('drawers live on the URL: links, Back, Forward, Esc, guard, stacking and crumbs', async () => {
  test.setTimeout(240_000)
  const { app, page, dir } = await launchShell()
  try {
    await expect(heading(page, 'Summary')).toBeVisible()
    // The project opens on Summary with no hash; give it its own entry.
    const start = '#/overview'
    await openHash(page, start)
    await expect.poll(() => hash(page)).toBe(start)
    const addQuestions = page.getByRole('dialog', { name: 'Add questions' })
    const newTopic = page.getByRole('dialog', { name: 'New topic' })

    await test.step('a link opens the drawer over its screen; closing lands on that screen', async () => {
      await openHash(page, '#/questions?drawer=add-questions')
      await expect(addQuestions).toBeVisible()
      await expect(heading(page, 'Questions')).toBeVisible()
      expect(await crumbs(addQuestions)).toEqual(['TextBolt', 'Questions'])
      await expect(
        addQuestions.getByRole('textbox', { name: 'Question 1', exact: true })
      ).toBeFocused()
      await addQuestions.getByRole('button', { name: 'Close Add questions' }).click()
      await expect(addQuestions).toHaveCount(0)
      await expect.poll(() => hash(page)).toBe('#/questions')
      await page.goBack()
      await expect.poll(() => hash(page)).toBe(start)
    })

    await test.step('+ Add opens it; Back closes it and Forward reopens it', async () => {
      await openAdd(page, 'Questions')
      await expect(addQuestions).toBeVisible()
      await expect.poll(() => hash(page)).toBe(`${start}?drawer=add-questions`)
      await drawerShots(page, 'add-questions')
      await page.goBack()
      await expect(addQuestions).toHaveCount(0)
      await expect.poll(() => hash(page)).toBe(start)
      await page.goForward()
      await expect(addQuestions).toBeVisible()
    })

    await test.step('Esc closes it and leaves no dead Back step', async () => {
      await page.keyboard.press('Escape')
      await expect(addQuestions).toHaveCount(0)
      await expect.poll(() => hash(page)).toBe(start)
      // Topics, then Summary, then the drawer: after Esc, Back goes to Topics.
      await openHash(page, '#/topics')
      await expect(heading(page, 'Topics')).toBeVisible()
      await openHash(page, start)
      await expect(heading(page, 'Summary')).toBeVisible()
      await openAdd(page, 'Questions')
      await expect(addQuestions).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(addQuestions).toHaveCount(0)
      await page.goBack()
      await expect.poll(() => hash(page)).toBe('#/topics')
      await page.goForward()
      await expect.poll(() => hash(page)).toBe(start)
    })

    await test.step('unsaved questions: Esc and Back ask first', async () => {
      await openAdd(page, 'Questions')
      const field = addQuestions.getByRole('textbox', { name: 'Question 1', exact: true })
      await field.fill('best sms api for clinics')
      await page.keyboard.press('Escape')
      const discard = page.getByRole('alertdialog', { name: 'Discard your questions?' })
      await expect(discard).toBeVisible()
      await drawerShots(page, 'discard-guard')
      await discard.getByRole('button', { name: 'Keep editing' }).click()
      await expect(discard).toHaveCount(0)
      await expect(field).toHaveValue('best sms api for clinics')

      await page.goBack()
      await expect(discard).toBeVisible()
      await expect(addQuestions).toBeVisible()
      await expect.poll(() => hash(page)).toBe(`${start}?drawer=add-questions`)
      await discard.getByRole('button', { name: 'Discard' }).click()
      await expect(addQuestions).toHaveCount(0)
      await expect.poll(() => hash(page)).toBe(start)
    })

    await test.step('New topic stacks over Add questions, narrower, with the trail grown', async () => {
      await openAdd(page, 'Questions')
      await addQuestions.getByRole('button', { name: 'New topic' }).click()
      await expect(newTopic).toBeVisible()
      await expect(newTopic).toHaveAttribute('data-drawer-depth', '1')
      await expect.poll(() => hash(page)).toBe(`${start}?drawer=add-questions&drawer=new-topic`)
      expect(await crumbs(newTopic)).toEqual(['TextBolt', 'Summary', 'Add questions'])
      await animationsDone(page)
      const under = await addQuestions.boundingBox()
      const over = await newTopic.boundingBox()
      expect(under && over && Math.round(under.width - over.width)).toBe(48)
      await drawerShots(page, 'stacked')

      // The lower drawer's crumb closes the one over it.
      await newTopic
        .getByRole('navigation', { name: 'Drawer breadcrumb' })
        .getByRole('link', { name: 'Add questions' })
        .click()
      await expect(newTopic).toHaveCount(0)
      await expect(addQuestions).toBeVisible()
      await expect.poll(() => hash(page)).toBe(`${start}?drawer=add-questions`)
    })

    await test.step("the screen's crumb closes every drawer; the project crumb navigates", async () => {
      await addQuestions
        .getByRole('navigation', { name: 'Drawer breadcrumb' })
        .getByRole('link', { name: 'Summary' })
        .click()
      await expect(addQuestions).toHaveCount(0)
      await expect.poll(() => hash(page)).toBe(start)

      await openHash(page, '#/questions?drawer=add-questions')
      await expect(addQuestions).toBeVisible()
      await addQuestions
        .getByRole('navigation', { name: 'Drawer breadcrumb' })
        .getByRole('link', { name: 'TextBolt' })
        .click()
      await expect(addQuestions).toHaveCount(0)
      await expect(heading(page, 'Summary')).toBeVisible()
    })

    await test.step('New topic on its own', async () => {
      await openNewTopic(page)
      await expect(newTopic).toBeVisible()
      await expect(newTopic).toHaveAttribute('data-drawer-depth', '0')
      await drawerShots(page, 'new-topic')
      await page.keyboard.press('Escape')
      await expect(newTopic).toHaveCount(0)
    })
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('a drill number opens on the URL; Esc returns focus; a copied link reopens the list', async () => {
  test.setTimeout(180_000)
  const { page, close } = await openTwoMarketApp('drawer-drill')
  try {
    await openHash(page, '#/pages/page-1/results')
    await page
      .getByRole('tablist', { name: 'Results sections' })
      .getByRole('tab', { name: /^Breakdown/ })
      .click()
    const number = page
      .locator('#page-tabpanel')
      .getByRole('button', { name: /Questions checked/ })
      .first()
    const id = (await number.getAttribute('data-nfr-drill')) ?? ''
    expect(id).not.toBe('')
    const screen = await hash(page)
    await number.click()
    const drill = page.getByRole('dialog')
    await expect(drill).toHaveAttribute('data-drill', id)
    const link = await hash(page)
    expect(link).toContain(`drawer=drill&drill=${encodeURIComponent(id)}`)
    await expect(drill.locator('.ui-drawer-close')).toBeFocused()
    const trail = await crumbs(drill)
    expect(trail.at(-1)).toBe('Results')
    await drawerShots(page, 'drill')

    // A tile filters the list and is a step on the URL.
    const tiles = drill.getByRole('group', { name: 'Filter this list' })
    if ((await tiles.count()) > 0) {
      await tiles.getByRole('button').nth(1).click()
      await expect.poll(() => hash(page)).toContain('drill.f=')
      await page.goBack()
      await expect.poll(() => hash(page)).toBe(link)
    }

    await page.keyboard.press('Escape')
    await expect(drill).toHaveCount(0)
    await expect.poll(() => hash(page)).toBe(screen)
    await expect(number).toBeFocused()

    // A copied link (a new entry) reopens the same list; Back closes it.
    await openHash(page, link)
    await expect(page.getByRole('dialog')).toHaveAttribute('data-drill', id)
    await page.goBack()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect.poll(() => hash(page)).toBe(screen)
  } finally {
    await close()
  }
})
