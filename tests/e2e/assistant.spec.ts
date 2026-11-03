import { expect, test, type Locator, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifactsDir } from './artifacts'
import { animationsDone } from './drawer-helpers'
import { launchCiteFox } from './launch'
import { openAllPages } from './nav-helpers'
import { installRawMarkdown } from './raw-hook'
import { writeClaudeStandIn } from './claude-stand-in'

/**
 * Ask CiteFox, the context-aware assistant, through real IPC. The two-market
 * TextBolt seed holds four stored prompt checks; the `claude` stand-in answers
 * every assistant prompt from src/main/assistant/fixtures (no live calls).
 * The drawer opens from the top bar and Ctrl J, reads the screen it opens on,
 * suggests questions for that screen, opens from a KPI's ✦ with the question
 * asked, and changes nothing until an action card is confirmed.
 */

const ROOT = process.cwd()
const SHIM = path.join(ROOT, 'tests/e2e/claude-shim.mjs')
const FIXTURE_DIR = path.join(ROOT, 'src/main/providers/fixtures/textbolt')
const SHOTS = path.join(e2eArtifactsDir(), 'screenshots', 'assistant')
const NEW_QUESTION = 'How can I text my whole crew when a job changes without an app?'

test('Ask CiteFox knows the screen, suggests for it, and asks before it changes anything', async () => {
  test.setTimeout(180_000)
  installRawMarkdown()
  const { seedTwoMarketProject } = await import('./screens-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-assistant-'))
  await seedTwoMarketProject(dir)
  const bin = path.join(dir, 'bin')
  await mkdir(bin, { recursive: true })
  await writeClaudeStandIn(path.join(bin, 'claude'), SHIM)
  const shimLog = path.join(dir, 'claude-shim.log')
  await mkdir(SHOTS, { recursive: true })

  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1440, height: 900 },
    env: {
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      CITEFOX_FIXTURE_DIR: FIXTURE_DIR,
      CITEFOX_SHIM_LOG: shimLog
    }
  })
  await page.emulateMedia({ colorScheme: 'light' })

  const dialog = page.getByRole('dialog', { name: 'Ask CiteFox' })
  const askButton = page.getByRole('banner').getByRole('button', {
    name: 'Ask CiteFox',
    exact: true
  })
  let overviewSuggestions: string[] = []

  try {
    await openAllPages(page)

    await test.step('the top bar opens it on Summary, reading Summary; Back closes it', async () => {
      await openHash(page, '#/overview')
      await expect(page.getByRole('heading', { level: 1, name: 'Summary' })).toBeVisible()
      await askButton.click()
      await expect(dialog).toBeVisible()
      await expect(page).toHaveURL(/drawer=ask/)
      await expect(askButton).toHaveAttribute('aria-expanded', 'true')
      await expect(dialog.getByRole('textbox', { name: 'Your question' })).toBeFocused()
      await expect(lookingAt(dialog)).toContainText('Summary')
      const crumbs = dialog.getByRole('navigation', { name: 'Drawer breadcrumb' })
      await expect(crumbs).toContainText('TextBolt')
      await expect(crumbs).not.toContainText('Ask CiteFox')
      overviewSuggestions = await suggestionTexts(dialog)
      expect(overviewSuggestions).toContain('What should I fix first this week?')
      expect(overviewSuggestions.length).toBeGreaterThanOrEqual(3)
      expect(overviewSuggestions.length).toBeLessThanOrEqual(5)
      await expect(
        dialog.getByText(
          'Answers come from your stored checks. It never searches Google or changes anything without asking.'
        )
      ).toBeVisible()
      await animationsDone(page)
      await page.screenshot({ path: path.join(SHOTS, 'ask-overview-light.png') })

      await page.goBack()
      await expect(dialog).toHaveCount(0)
      await expect(page).not.toHaveURL(/drawer=ask/)
      await expect(page.getByRole('heading', { level: 1, name: 'Summary' })).toBeVisible()
    })

    await test.step('Ctrl J opens it on a page, with that page in context and other suggestions', async () => {
      await openHash(page, '#/pages/page-1/results')
      await expect(page.locator('#main')).toContainText('Visibility score')
      await page.locator('#main').focus()
      await page.keyboard.press('Control+j')
      await expect(dialog).toBeVisible()
      await expect(page).toHaveURL(/drawer=ask/)
      await expect(lookingAt(dialog)).toContainText('Results')
      await expect(lookingAt(dialog)).toContainText(/Page: [^·]*alerts/i)
      // The page chip uses the breadcrumb's words for the page (its title, not its short label).
      const pageCrumb = (
        (await page
          .getByRole('banner')
          .getByRole('navigation', { name: 'Breadcrumb' })
          .locator('li')
          .nth(1)
          .textContent()) ?? ''
      ).trim()
      expect(pageCrumb.length).toBeGreaterThan(0)
      await expect(lookingAt(dialog).getByText(`Page: ${pageCrumb}`, { exact: true })).toBeVisible()
      const pageSuggestions = await suggestionTexts(dialog)
      expect(pageSuggestions).toContain('What should I change on this page first?')
      expect(pageSuggestions).not.toEqual(overviewSuggestions)
      // The same keys put it away again.
      await page.keyboard.press('Control+j')
      await expect(dialog).toHaveCount(0)
    })

    await test.step('a KPI ✦ opens it with the question asked, and flags a number not in the data', async () => {
      await openHash(page, '#/pages/page-1/prompt/prompt-1')
      const sparkle = page.getByRole('button', { name: 'Ask CiteFox about Status', exact: true })
      // The KPI ✦ takes no room until its tile is hovered or focused: hover the tile.
      await page.locator('.ui-kpi').filter({ has: sparkle }).hover()
      await sparkle.click()
      // The tile's value is in its questions: "Explain this number: Status (Cited)", "Why is status Cited?".
      await expect(page.getByRole('menuitem', { name: /^Why is status \S.*\?$/ })).toBeVisible()
      const pick = page.getByRole('menuitem', { name: /^Explain this number: Status \(.+\)$/ })
      const question = ((await pick.textContent()) ?? '').trim()
      await pick.click()
      await expect(dialog).toBeVisible()
      await expect(page).toHaveURL(/drawer=ask/)
      await expect(lookingAt(dialog)).toContainText('Question:')
      await expect(dialog.getByText(question, { exact: true })).toBeVisible()
      const answer = lastAnswer(dialog)
      await expect(answer).toContainText('simpletexting.com', { timeout: 60_000 })
      // Claude's reply said "37" twice; the number is not in the packet, so it is cut and flagged.
      await expect(answer).not.toContainText('37')
      await expect(answer.getByTestId('asst-flagged')).toBeVisible()
      await expect(answer.getByRole('heading', { name: 'From your saved data' })).toBeVisible()
      // A "check again" card prices itself with Check now's model: a range, and what is left when known.
      const checkCard = answer.getByRole('article', { name: /^Suggested action: Check / })
      await expect(checkCard.getByTestId('asst-action-cost')).toHaveText(
        /^Uses (about \d[\d,–]* search(es)?|no searches)( · (only )?[\d,]+ left this month)?$/
      )
      // One retry asked Claude to drop the number; the second reply is shown with it cut.
      expect(
        shimLines(shimLog).filter((line) => line === 'template-assistant_explain')
      ).toHaveLength(2)
      await animationsDone(page)
      await page.screenshot({ path: path.join(SHOTS, 'ask-kpi-answer-light.png') })
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
    })

    await test.step('an action card changes nothing until it is confirmed', async () => {
      await openHash(page, '#/pages/page-1/prompts')
      const main = page.locator('#main')
      await expect(main).toContainText('How do I alert the crew')
      await expect(main.getByText(NEW_QUESTION)).toHaveCount(0)
      await askButton.click()
      await expect(dialog).toBeVisible()
      // A clean chat for this screen.
      const newChat = dialog.getByRole('button', { name: 'New chat' })
      if (await newChat.isVisible()) await newChat.click()
      await dialog
        .getByTestId('asst-suggested')
        .getByRole('button', { name: 'Suggest 5 questions buyers ask that I am missing' })
        .click()
      const answer = lastAnswer(dialog)
      const card = answer.getByRole('article', { name: /^Suggested action:/ })
      await expect(card).toBeVisible({ timeout: 60_000 })
      await expect(card).toContainText('needs your OK')
      await expect(answer.getByText(NEW_QUESTION).first()).toBeVisible()
      // Shown, not saved: the prompts list behind the drawer has not changed.
      await expect(main.getByText(NEW_QUESTION)).toHaveCount(0)
      await animationsDone(page)
      await page.screenshot({ path: path.join(SHOTS, 'ask-action-light.png') })

      await card.getByRole('button', { name: 'Add 3 questions' }).click()
      await expect(card.getByRole('status')).toContainText('Added 3 questions')
      await expect.poll(() => main.getByText(NEW_QUESTION).count()).toBeGreaterThan(0)

      await page.emulateMedia({ colorScheme: 'dark' })
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
      await animationsDone(page)
      await page.screenshot({ path: path.join(SHOTS, 'ask-action-dark.png') })
    })

    await test.step('dark: the drawer on Summary', async () => {
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await openHash(page, '#/overview')
      await expect(page.getByRole('heading', { level: 1, name: 'Summary' })).toBeVisible()
      await askButton.click()
      await expect(dialog).toBeVisible()
      // The chat lasts the session; the confirmed card stays done and cannot run twice.
      await expect(lookingAt(dialog)).toContainText('Summary')
      const card = lastAnswer(dialog).getByRole('article', { name: /^Suggested action:/ })
      await expect(card.getByRole('status')).toContainText('Added 3 questions')
      await expect(card.getByRole('button', { name: 'Add 3 questions' })).toHaveCount(0)
      await animationsDone(page)
      await page.screenshot({ path: path.join(SHOTS, 'ask-overview-dark.png') })
      await page.emulateMedia({ colorScheme: 'light' })
    })
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})

async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((next) => {
    window.location.hash = next
  }, hash)
}

function lookingAt(dialog: Locator): Locator {
  return dialog.getByTestId('asst-looking-at')
}

function lastAnswer(dialog: Locator): Locator {
  return dialog.getByRole('region', { name: 'Answer from CiteFox AI' }).last()
}

async function suggestionTexts(dialog: Locator): Promise<string[]> {
  const buttons = dialog.getByTestId('asst-suggested').getByRole('button')
  await expect(buttons.first()).toBeVisible()
  return (await buttons.allTextContents()).map((text) => text.trim())
}

function shimLines(file: string): string[] {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
}
