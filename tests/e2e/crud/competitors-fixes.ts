import { expect, test, type Locator, type Page } from '@playwright/test'
import { drawerShots } from '../drawer-helpers'
import { expectDrawerRows } from '../drill-helpers'
import { openHash, openTwoMarketApp } from '../screens-app'

/** CRUD e2e: Competitors and Fixes (items 3, 4). Registered by tests/e2e/crud.spec.ts. */

/** The toast that says `text`, with its Undo pressed; waits for "Undone." */
async function undoToast(page: Page, text: string | RegExp): Promise<void> {
  const toast = page.getByRole('status').filter({ hasText: text })
  await expect(toast).toBeVisible()
  await toast.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Undone.' })).toBeVisible()
}

/** Clicks a drill number, checks the drawer lists exactly that many rows, closes it. */
async function checkDrill(page: Page, number: Locator, title: RegExp): Promise<void> {
  const count = Number(((await number.textContent()) ?? '').replace(/[^\d]/g, ''))
  await number.click()
  const drawer = page.getByRole('dialog', { name: title })
  await expect(drawer).toBeVisible()
  await expectDrawerRows(drawer, count)
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
}

async function rowMenu(page: Page, grid: Locator, row: string, item: string): Promise<void> {
  await grid.getByRole('button', { name: `Actions for ${row}` }).click()
  await page.getByRole('menuitem', { name: item }).click()
}

export function competitorsFixesCrud(): void {
  test('competitors: add, edit, merge and remove with Undo; numbers drill', async () => {
    test.setTimeout(240_000)
    const { page, close } = await openTwoMarketApp('crud-competitors')
    try {
      await openHash(page, '#/competitors')
      const main = page.locator('#main')
      const grid = main.getByRole('grid', { name: 'Cited sites' })
      await expect(grid.getByText('twilio.com', { exact: true }).first()).toBeVisible()

      // The numbers open exactly what they count. Searches is among the columns a
      // narrow grid drops first (R6), so the drills are read in a wide window.
      await page.setViewportSize({ width: 1680, height: 900 })
      await checkDrill(
        page,
        grid.getByRole('button', { name: /^\d+ links to simpletexting\.com$/ }),
        /Links to simpletexting\.com/
      )
      await checkDrill(
        page,
        grid.getByRole('button', { name: /^\d+ search(es)? citing simpletexting\.com$/ }),
        /Searches citing simpletexting\.com/
      )
      const yours = main.getByRole('button', { name: /of your links in AI Overviews$/ })
      if ((await yours.count()) > 0) await checkDrill(page, yours, /^Links to /)
      await page.setViewportSize({ width: 1280, height: 900 })

      // Add, with the site icon preview, then Undo.
      await main.getByRole('button', { name: 'Add competitor', exact: true }).click()
      const add = page.getByRole('dialog', { name: 'Add competitor' })
      await add
        .getByRole('textbox', { name: 'Domain', exact: true })
        .fill('https://www.clicksend.com/us')
      await expect(
        add.getByText('Matches links on clicksend.com and its subdomains.')
      ).toBeVisible()
      await add.getByLabel('Other domains').fill('clicksend.co.uk')
      await add.getByLabel('Other domains').press('Enter')
      await drawerShots(page, 'crud-competitor-add')
      await add.getByRole('button', { name: 'Add competitor', exact: true }).click()
      await expect(add).toHaveCount(0)
      await undoToast(page, 'Added clicksend.com as a competitor.')

      // The first-visit explainer card floats over the grid's rows: close it.
      const explainer = page.getByTestId('guide-explainer')
      if (await explainer.isVisible()) {
        await explainer.getByRole('button', { name: 'Close', exact: true }).click()
        await expect(explainer).toBeHidden()
      }

      // Edit: a new name shows in the grid.
      await rowMenu(page, grid, 'twilio.com', 'Edit…')
      const edit = page.getByRole('dialog', { name: 'Edit twilio.com' })
      await expect(page).toHaveURL(/drawer=competitor&competitor=s/)
      await edit.getByLabel('Name').fill('Twilio')
      await drawerShots(page, 'crud-competitor-edit')
      await edit.getByRole('button', { name: 'Save changes' }).click()
      await expect(edit).toHaveCount(0)
      await expect(grid.getByText('Twilio', { exact: true })).toBeVisible()

      // Merge simpletexting.com into Twilio, then Undo.
      await rowMenu(page, grid, 'Twilio', 'Merge with…')
      const merge = page.getByRole('dialog', { name: 'Merge Twilio with…' })
      await merge.getByRole('checkbox', { name: /simpletexting\.com/ }).check()
      await expect(page).toHaveURL(/competitor\.ids=s/)
      await drawerShots(page, 'crud-competitor-merge')
      await merge.getByRole('button', { name: 'Merge 2 competitors' }).click()
      await expect(merge).toHaveCount(0)
      await undoToast(page, 'Merged simpletexting.com into Twilio.')
      await expect(grid.getByText('simpletexting.com', { exact: true }).first()).toBeVisible()

      // Remove, then Undo.
      await rowMenu(page, grid, 'Twilio', 'Remove from competitors')
      await undoToast(page, 'Removed Twilio from competitors.')
      await expect(grid.getByText('Twilio', { exact: true })).toBeVisible()
    } finally {
      await close()
    }
  })

  test('gap drawer: cited page, Add to a topic, Log a fix; fixes: log, edit, delete with Undo', async () => {
    test.setTimeout(240_000)
    const { page, close } = await openTwoMarketApp('crud-fixes')
    try {
      await openHash(page, '#/competitors')
      const main = page.locator('#main')
      const grid = main.getByRole('grid', { name: 'Cited sites' })
      const gaps = grid
        .getByRole('button', { name: /(search|searches) cite .+ and not you$/ })
        .first()
      await expect(gaps).toBeVisible()
      await gaps.click()
      const gap = page.getByRole('dialog', { name: /^Where .+ is cited/ })
      // They win first: the searches it is cited for and you are not, with their page.
      await expect(page).toHaveURL(/site=s/)
      const searches = gap.getByRole('grid', { name: /^Searches that cite / })
      await expect(searches.getByRole('columnheader', { name: /Their page/ })).toBeVisible()
      await expect(searches.getByText('Not cited').first()).toBeVisible()
      const topic = gap.getByRole('combobox', { name: 'Add these questions to a topic' })
      // The seed has no topic; the picker makes one (the new-topic drawer is fork B's).
      await expect(topic.locator('option', { hasText: '+ New topic…' })).toHaveCount(1)
      await drawerShots(page, 'crud-gap')

      // Log a fix for the page with the most of these questions.
      await gap.getByRole('button', { name: 'Log a fix', exact: true }).click()
      const log = page.getByRole('dialog', { name: 'Log a fix' })
      await expect(page).toHaveURL(/drawer=fix&fix=new&fix\.page=page-1&fix\.prompts=/)
      await expect(log.getByRole('checkbox').first()).toBeChecked()
      await log.getByLabel('What changed').fill('Added a per-message price table.')
      await expect(log.getByText(/The follow-up uses \d+–\d+ searches/)).toBeVisible()
      await drawerShots(page, 'crud-fix-new')
      await log.getByRole('button', { name: 'Log fix' }).click()
      await expect(log).toHaveCount(0)
      await expect(page.getByRole('status').filter({ hasText: 'Logged Fix 1.' })).toBeVisible()

      await openHash(page, '#/fixes?view=log')
      const fixes = main.getByRole('grid', { name: 'Fixes' })
      await expect(fixes.getByText('Fix 1', { exact: true })).toBeVisible()
      await checkDrill(
        page,
        fixes.getByRole('button', { name: /Fix 1 should help$/ }),
        /Questions Fix 1 should help/
      )

      // View, Edit, Back and Forward.
      await fixes.getByText('Fix 1', { exact: true }).click()
      const view = page.getByRole('dialog', { name: 'Fix 1' })
      const changed = view.getByRole('region', { name: 'What changed' })
      await expect(changed.getByText('Added a per-message price table.')).toBeVisible()
      await drawerShots(page, 'crud-fix-view')
      await view.getByRole('button', { name: 'Edit', exact: true }).click()
      await expect(page).toHaveURL(/fix\.mode=edit/)
      const edit = page.getByRole('dialog', { name: 'Edit Fix 1' })
      await expect(edit).toBeVisible()
      await drawerShots(page, 'crud-fix-edit')
      await page.goBack()
      await expect(page.getByRole('dialog', { name: 'Fix 1' })).toBeVisible()
      await expect(page).not.toHaveURL(/fix\.mode=edit/)
      await page.goForward()
      await expect(edit).toBeVisible()
      await edit.getByLabel('What changed').fill('Added a price table and an FAQ.')
      await edit.getByRole('button', { name: 'Save changes' }).click()
      await expect(changed.getByText('Added a price table and an FAQ.')).toBeVisible()

      // Delete acts at once; Undo puts it back.
      await view.getByRole('button', { name: 'Delete Fix 1' }).click()
      await expect(view).toHaveCount(0)
      await expect(fixes.getByText('Fix 1', { exact: true })).toHaveCount(0)
      await undoToast(page, 'Deleted Fix 1.')
      await expect(fixes.getByText('Fix 1', { exact: true })).toBeVisible()

      // Log a fix from the header opens the drawer empty.
      await main.getByRole('button', { name: 'Log a fix', exact: true }).first().click()
      await expect(page).toHaveURL(/drawer=fix&fix=new/)
      await page.keyboard.press('Escape')
    } finally {
      await close()
    }
  })

  test('overview: each headline number opens exactly the questions it counts', async () => {
    test.setTimeout(180_000)
    const { page, close } = await openTwoMarketApp('crud-overview-drills')
    try {
      await openHash(page, '#/overview')
      const kpis = page.locator('#main').getByRole('region', { name: 'Headline numbers' })
      await expect(kpis).toBeVisible()
      const tiles: [string, RegExp][] = [
        ['AI Overview shows', /AI Overview shows/],
        ['You’re cited', /you’re cited/],
        ['You’re named', /you’re named/]
      ]
      for (const [tile, title] of tiles) {
        const region = kpis.getByRole('region', { name: tile })
        // A count of zero is plain text: there is no list to open.
        const zero = region.locator('.drill-num-zero')
        if ((await zero.count()) > 0) {
          await expect(zero.first()).toHaveText('0')
          await expect(region.getByRole('button', { name: /^\d/ })).toHaveCount(0)
          continue
        }
        // The number's own button (its name starts with the count), not the tile's ✦ Ask CiteFox.
        await checkDrill(page, region.getByRole('button', { name: /^\d/ }).first(), title)
      }
    } finally {
      await close()
    }
  })
}
