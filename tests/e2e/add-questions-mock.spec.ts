import { expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { launchCiteFox } from './launch'
import { openHash } from './screens-app'

/**
 * Add questions on the TextBolt mock catalog (W3I-G). The mock shell's project
 * ids live only in the renderer, so the drawer must read its pages and topics
 * from the mock too, not from the real main process ("That project was not
 * found"). Typing a question, checking it and adding it all stay in the mock.
 * (Screens behind the drawer that still read main are outside this check.)
 */
test('Add questions works on the mock catalog: pages load, a typed question is added', async () => {
  test.setTimeout(120_000)
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-aq-mock-'))
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
  try {
    await expect(page.getByRole('heading', { level: 1, name: 'Summary' })).toBeVisible()
    await openHash(page, '#/overview?drawer=add-questions')
    const dialog = page.getByRole('dialog', { name: 'Add questions' })
    await expect(dialog).toBeVisible()
    // The pages load from the mock: a page is picked and there is no error.
    await expect(dialog.getByTestId('aq-target')).not.toHaveValue('')
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await expect(dialog).not.toContainText('That project was not found')

    const box = dialog.getByRole('textbox', { name: 'Question 1', exact: true })
    await box.fill('What is the best text alert service for a small clinic?')
    const add = dialog.getByTestId('aq-add-later')
    await expect(add).toBeEnabled()
    await add.click()
    await expect(page.getByText('1 question added')).toBeVisible()
    await expect(dialog).toHaveCount(0)
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
