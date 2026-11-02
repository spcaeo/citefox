import { expect, test } from '@playwright/test'
import Database from 'better-sqlite3'
import { existsSync, readFileSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifactsDir } from './artifacts'
import { animationsDone } from './drawer-helpers'
import { launchCiteFox } from './launch'

/**
 * Ask CiteFox with no project open: the top bar and Ctrl J still open it, it
 * suggests setup questions, and an answer comes from the app's stored data
 * and the shipped help (the `claude` stand-in replies with
 * src/main/assistant/fixtures/assistant_help.json; no live calls, no searches).
 */

const ROOT = process.cwd()
const SHIM = path.join(ROOT, 'tests/e2e/claude-shim.mjs')
const FIXTURE_DIR = path.join(ROOT, 'src/main/providers/fixtures/textbolt')
const SHOTS = path.join(e2eArtifactsDir(), 'screenshots', 'assistant')

test('Ask CiteFox answers app and setup questions with no project open', async () => {
  test.setTimeout(150_000)
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-ask-noproject-'))
  const bin = path.join(dir, 'bin')
  await mkdir(bin, { recursive: true })
  const claude = path.join(bin, 'claude')
  await writeFile(claude, `#!/bin/sh\nexec node ${JSON.stringify(SHIM)} "$@"\n`)
  await chmod(claude, 0o755)
  const shimLog = path.join(dir, 'claude-shim.log')
  await mkdir(SHOTS, { recursive: true })
  const env = {
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    CITEFOX_FIXTURE_DIR: FIXTURE_DIR,
    CITEFOX_SHIM_LOG: shimLog
  }

  // First run creates the app data; mark onboarding done so the shell opens with no project,
  // and forget the first run's Claude checkup so Ask runs a fresh one against the stand-in.
  const first = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1440, height: 900 },
    env
  })
  try {
    await expect(
      first.page.getByRole('heading', { level: 1, name: /See whether Google/ })
    ).toBeVisible()
  } finally {
    await first.app.close()
  }
  const db = new Database(path.join(dir, 'app.sqlite'))
  db.prepare('UPDATE app_state SET onboarding_finished = 1 WHERE id = 1').run()
  db.prepare('DELETE FROM claude_checkups').run()
  db.close()

  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1440, height: 900 },
    env
  })
  await page.emulateMedia({ colorScheme: 'light' })
  const dialog = page.getByRole('dialog', { name: 'Ask CiteFox' })
  try {
    await expect(page.getByRole('heading', { level: 1, name: 'Summary' })).toBeVisible()

    const askButton = page.getByRole('banner').getByRole('button', {
      name: 'Ask CiteFox',
      exact: true
    })
    await askButton.click()
    await expect(dialog).toBeVisible()
    await expect(page).toHaveURL(/drawer=ask/)
    await expect(dialog.getByTestId('asst-empty')).toContainText('No project is open.')
    const suggested = dialog.getByTestId('asst-suggested')
    await expect(
      suggested.getByRole('button', { name: 'How do I start tracking my site?' })
    ).toBeVisible()
    await animationsDone(page)
    await page.screenshot({ path: path.join(SHOTS, 'ask-no-project-light.png') })

    await suggested.getByRole('button', { name: 'How do I start tracking my site?' }).click()
    const answer = dialog.getByRole('region', { name: 'Answer from CiteFox AI' }).last()
    await expect(answer).toContainText('nothing here runs a search', { timeout: 60_000 })
    // App answers have no action cards and name no stored checks.
    await expect(answer.getByRole('article')).toHaveCount(0)
    await expect(answer).toContainText('Based on what this screen shows')
    expect(shimLines(shimLog)).toContain('template-assistant_help')
    await animationsDone(page)
    await page.screenshot({ path: path.join(SHOTS, 'ask-no-project-answer-light.png') })

    // Ctrl J puts it away and brings it back with the chat kept.
    await page.keyboard.press('Control+j')
    await expect(dialog).toHaveCount(0)
    await page.locator('#main').focus()
    await page.keyboard.press('Control+j')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('region', { name: 'Answer from CiteFox AI' })).toHaveCount(1)
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})

function shimLines(file: string): string[] {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
}
