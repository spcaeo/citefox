import { expect, test, type Locator } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import {
  copied,
  expectNothingPrivate,
  hashOf,
  launchHelpFill,
  pick,
  shots
} from './helpfill-helpers'
import { openHash } from './screens-app'

/**
 * ✦ Match pages in Add questions (HelpFill.dc.html panel 7, "Page to be cited")
 * on the real handlers and sqlite: the two-market TextBolt seed with its topic
 * and a tracked /pricing/ page. Describe it runs the `questions.matchPages`
 * assist through the `claude` stand-in (its recorded fixture) and sets each
 * row's page, which can still be changed; a row with no fitting page keeps its
 * page. Use your own ChatGPT lists the rows and the tracked pages and reads
 * `question,page` back; a page that is not tracked is flagged, never set. The
 * queue is paused and nothing is saved. Screenshots at 1440 × 900 and
 * 1134 × 770 in both themes go to test-results/e2e/helpfill-match-*.png.
 */

const PRICING = 'https://textbolt.com/pricing/'
const ALERTS = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'
const QUESTIONS = [
  'How much does it cost to text a whole crew from email every month?',
  'How do I set up text alerts for my business without a developer?',
  'Can church volunteers reply to a group text sent from the office?'
]

test('Add questions ✦ Match pages: Describe it and Use your own ChatGPT', async () => {
  test.setTimeout(300_000)
  let topicId = ''
  const { app, page, dir, shimLog } = await launchHelpFill('helpfill-match', async (db) => {
    // These modules open sqlite, which loads only at run time.
    const { SEED } = await import('./screens-seed')
    const { insertPage } = await import('../../src/main/storage/pages')
    const { projectDatabaseRelativePath } = await import('../../src/main/storage/slug')
    const { seedTextboltTopic } = await import('../../src/main/topics/fixture-seed')
    insertPage(db, {
      id: 'page-pricing',
      projectId: SEED.projectId,
      url: PRICING,
      title: 'Pricing',
      label: 'Pricing',
      folder: null,
      status: 'tracked',
      setupStep: null,
      intervalDays: 14,
      samples: 1,
      promptCount: 2,
      defaultMarketId: SEED.us,
      pinned: false,
      score: null,
      promptSetVersion: null
    })
    topicId = seedTextboltTopic(db, {
      id: SEED.projectId,
      name: 'TextBolt',
      slug: 'textbolt',
      domain: 'textbolt.com',
      dbPath: projectDatabaseRelativePath('textbolt'),
      clientName: null,
      status: 'active'
    }).topicId
  })
  const add = page.getByRole('dialog', { name: 'Add questions' })
  const panel = add.getByTestId('aq-match')
  const helper = panel.getByTestId('aq-match-hf')
  const pageOf = (n: number): Locator => add.getByLabel(`Page to be cited for question ${n}`)
  try {
    await test.step('the button sits next to Set page for all and opens the panel', async () => {
      await openHash(page, `#/topics?drawer=add-questions&topic=${topicId}`)
      await expect(add).toBeVisible()
      for (const [index, text] of QUESTIONS.entries()) {
        await add.getByLabel(`Question ${index + 1}`, { exact: true }).fill(text)
      }
      const button = add.getByTestId('aq-match-pages')
      await expect(button).toHaveText('Match pages')
      await button.click()
      await expect(panel).toBeVisible()
      await expect.poll(() => hashOf(page)).toContain('match=1')
      await expect(button).toHaveAttribute('aria-expanded', 'true')
      await expect(helper.getByRole('radio', { name: /Describe it/u })).toBeChecked()
    })

    await test.step('Describe it: Claude picks a tracked page per row; they can still change', async () => {
      await helper.getByRole('button', { name: 'Match 3 questions' }).click()
      const result = panel.getByTestId('aq-match-result')
      await expect(result).toContainText('Set the page on 2 rows. You can still change each one.')
      await expect(result).toContainText('1 has no tracked page that fits and keeps its page.')
      expect(readFileSync(shimLog, 'utf8')).toContain('questions.matchPages')
      await expect(pageOf(1)).toHaveValue(PRICING)
      await expect(pageOf(2)).toHaveValue(ALERTS)
      await expect(pageOf(3)).toHaveValue('')
      await shots(page, add, 'match-describe', result)
      await pageOf(1).selectOption(ALERTS)
      await expect(pageOf(1)).toHaveValue(ALERTS)
    })

    await test.step('Use your own ChatGPT: the rows and the tracked pages in the prompt', async () => {
      await pick(helper.getByRole('radio', { name: /Use your own ChatGPT/u }))
      await expect.poll(() => hashOf(page)).toContain('mhelp=chatbot')
      const prompt = helper.getByTestId('hf-prompt')
      await expect(prompt).toContainText('question,page')
      await expect(prompt).toContainText('/pricing/')
      await expect(prompt).toContainText(QUESTIONS[2] ?? '')
      expectNothingPrivate((await prompt.textContent()) ?? '')
      await helper.getByTestId('hf-copy-prompt').click()
      expect((await copied(page)).at(-1)).toContain('question,page')
      await shots(page, add, 'match-chatbot', prompt)
    })

    await test.step('paste the answer: a tracked page is set, one you do not track is flagged', async () => {
      await helper
        .getByLabel('Paste its answer below')
        .fill(
          [
            'question,page',
            `"${QUESTIONS[0]}",/pricing/`,
            `"${QUESTIONS[2]}",/church-texting/`
          ].join('\n')
        )
      await helper.getByRole('button', { name: 'Read the answer' }).click()
      const result = panel.getByTestId('aq-match-result')
      await expect(result).toContainText('Set the page on 1 row.')
      await expect(result.getByRole('list', { name: 'Pages you don’t track' })).toContainText(
        '/church-texting/'
      )
      await expect(pageOf(1)).toHaveValue(PRICING)
      await expect(pageOf(3)).toHaveValue('')
      await shots(page, add, 'match-read', result)
    })

    await test.step('Back returns to Describe it; Close drops the panel from the URL', async () => {
      await page.goBack()
      await expect.poll(() => hashOf(page)).not.toContain('mhelp=chatbot')
      await expect(helper.getByRole('radio', { name: /Describe it/u })).toBeChecked()
      await panel.getByRole('button', { name: 'Close' }).click()
      await expect(panel).toHaveCount(0)
      await expect.poll(() => hashOf(page)).not.toContain('match=1')
      // Nothing was saved: the rows still wait for the footer's button.
      await expect(add.getByLabel('Question 1', { exact: true })).toHaveValue(QUESTIONS[0] ?? '')
    })
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
