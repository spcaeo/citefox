import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import {
  copied,
  expectNothingPrivate,
  hashOf,
  launchHelpFill,
  opened,
  pick,
  shots
} from './helpfill-helpers'
import { openHash } from './screens-app'

/**
 * ✦ Help me find them on Competitors (HelpFill.dc.html panel 6) on the real
 * handlers and sqlite: the two-market TextBolt seed with one product and no
 * saved competitor. The empty state pairs the green Add competitor with the
 * white helper, which opens the competitors import with the helper on its URL.
 * Describe it runs the web-search competitor finding through the `claude`
 * stand-in (its recorded fixture, fake DNS); Use your own ChatGPT shows the
 * Perplexity tip and reads a pasted table. Both ways land in the import's check,
 * where nothing is added before the button. Screenshots at 1440 × 900 and
 * 1134 × 770 in both themes go to test-results/e2e/helpfill-competitors-*.png.
 */

/** A Perplexity-style answer: a markdown table, a saved one, the own site and a new one. */
const ANSWER = `Based on review sites, these are the companies buyers compare:

| Name | Domain | Competes with |
| --- | --- | --- |
| Textmagic | textmagic.com | Email to SMS |
| EZ Texting | https://www.eztexting.com/ | Email to SMS |
| TextBolt | textbolt.com | |
| Text-Em-All | text-em-all.com | |

Sources: G2, Capterra.`

test('Competitors ✦ Help me find them: the empty state, Describe it and Use your own ChatGPT', async () => {
  test.setTimeout(300_000)
  const { app, page, dir, shimLog } = await launchHelpFill('helpfill-competitors', async (db) => {
    // These modules open sqlite, which loads only at run time.
    const { readProjectProfile, writeProjectProfile } =
      await import('../../src/main/storage/project-profile')
    const { replaceProductCatalog } = await import('../../src/main/storage/products')
    const profile = readProjectProfile(db)
    if (profile === null) throw new Error('The seed has no project profile.')
    writeProjectProfile(db, { ...profile, competitors: [] })
    // The checks ran before any competitor was saved: their links count as other sites.
    db.prepare(
      `UPDATE aio_references SET classification = 'other' WHERE classification = 'competitor'`
    ).run()
    replaceProductCatalog(db, {
      products: [
        {
          id: 'prod-1',
          name: 'Email to SMS',
          job: 'text alerts from email',
          buyer: 'office managers'
        }
      ],
      competitors: []
    })
  })
  const main = page.locator('#main')
  const empty = page.getByTestId('cmp-no-competitors')
  const drawer = page.getByTestId('import-drawer')
  const helper = drawer.getByTestId('import-hf')
  try {
    await test.step('the empty state: green Add competitor and white ✦ Help me find them', async () => {
      await openHash(page, '#/competitors')
      await expect(empty).toBeVisible()
      await expect(empty.getByRole('heading', { name: 'No competitors yet' })).toBeVisible()
      const add = empty.getByRole('button', { name: 'Add competitor' })
      const find = empty.getByRole('button', { name: 'Help me find them' })
      await expect(add).toHaveClass(/ui-btn-primary/u)
      await expect(find).not.toHaveClass(/ui-btn-primary/u)
      // The header keeps its one green button.
      await expect(main.locator('header .ui-btn-primary')).toHaveCount(1)
      // Sorting the sites runs in the background: no console covers the screen (issue 8).
      await expect(page.getByText('Competitors · sort sites')).toHaveCount(0)
      await shots(page, main, 'competitors-empty', empty)
    })

    await test.step('Describe it: the web search finds them; they land in the check', async () => {
      await empty.getByRole('button', { name: 'Help me find them' }).click()
      await expect(drawer).toBeVisible()
      await expect.poll(() => hashOf(page)).toContain('import.help=1')
      await expect(helper.getByRole('radio', { name: /Describe it/u })).toBeChecked()
      await helper
        .getByLabel('Who do you lose deals to?')
        .fill('Cheaper SMS apps for small offices, and developer APIs our buyers try first.')
      await shots(page, drawer, 'competitors-form', helper)
      await helper.getByRole('button', { name: 'Find competitors' }).click()
      const banner = drawer.getByTestId('import-hf-summary')
      await expect(banner).toContainText(/are ready\.$|is ready\.$/u, { timeout: 60_000 })
      expect(readFileSync(shimLog, 'utf8')).toContain('project.productCompetitors')
      const finish = drawer.getByTestId('import-finish')
      await expect(finish).toBeEnabled()
      await expect(finish).toHaveText(/^Add \d+ competitors?$/u)
      await expect(drawer.getByRole('region', { name: 'Preview' })).toContainText('Textmagic')
      await shots(page, drawer, 'competitors-describe', banner)
      await finish.click()
      await expect(drawer).toBeHidden()
    })

    await test.step('Use your own ChatGPT from ⋯: the Perplexity tip, the prompt, Copy and Open', async () => {
      await main.locator('header').getByRole('button', { name: 'More actions' }).click()
      await page.getByRole('menuitem', { name: 'Help me find competitors' }).click()
      await expect(drawer).toBeVisible()
      await pick(helper.getByRole('radio', { name: /Use your own ChatGPT/u }))
      await expect.poll(() => hashOf(page)).toContain('import.help=chatbot')
      await expect(
        helper.getByText('Perplexity is best for competitors: it searches the web.')
      ).toBeVisible()
      const prompt = helper.getByTestId('hf-prompt')
      await expect(prompt).toContainText('name,domain,competes_with')
      await expect(prompt).toContainText('Never list textbolt.com itself.')
      // The ones saved by Describe it are listed, so the chatbot skips them.
      await expect(prompt).toContainText('Textmagic (textmagic.com)')
      expectNothingPrivate((await prompt.textContent()) ?? '')

      await helper.getByTestId('hf-copy-prompt').click()
      expect((await copied(page)).at(-1)).toContain('name,domain,competes_with')
      await pick(helper.getByRole('radio', { name: 'Perplexity', exact: true }))
      await expect.poll(() => hashOf(page)).toContain('import.bot=perplexity')
      await helper.getByRole('button', { name: 'Open Perplexity' }).click()
      await expect
        .poll(async () => (await opened(app)).at(-1) ?? '')
        .toMatch(/^https:\/\/www\.perplexity\.ai\//u)
      await shots(page, drawer, 'competitors-chatbot', prompt)
    })

    await test.step('paste the answer: saved and own site merged or dropped, the rest checked', async () => {
      await helper.getByLabel('Paste its answer below').fill(ANSWER)
      await helper.getByRole('button', { name: 'Read the answer' }).click()
      const banner = drawer.getByTestId('import-hf-summary')
      await expect(banner).toHaveText(
        'Read 4 rows. 1 was close to competitors you track and was merged. 1 named TextBolt and was set aside. 2 are ready.'
      )
      const rows = drawer.getByRole('region', { name: 'Preview' })
      await expect(rows).toContainText('EZ Texting')
      await expect(rows).toContainText('Text-Em-All')
      await expect(rows).not.toContainText('TextBolt')
      await shots(page, drawer, 'competitors-read', banner)
      // Back to Choose clears the helper's banner; nothing was added.
      await page.goBack()
      await expect.poll(() => hashOf(page)).not.toContain('step=check')
    })
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
