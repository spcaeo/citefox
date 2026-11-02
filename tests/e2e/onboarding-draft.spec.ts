import { expect, test, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { launchCiteFox } from './launch'

/**
 * Docs/FEEDBACK.md batch 2 row 4, onboarding v2: restarting mid-setup keeps the step
 * (`setupView`) and everything typed or confirmed (`setup`). The first test uses the real
 * engine (the draft file in the data folder, kept by main's draft parser); the second uses
 * the mock so the ChatGPT answer can fill the lists.
 */

const viewport = { width: 1280, height: 1400 }

function draftText(dir: string): string {
  const file = path.join(dir, 'onboarding-draft.json')
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}

async function welcome(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: /See whether Google/ })).toBeVisible()
}

test('a restart mid-setup reopens the same step with the typed fields', async () => {
  // Three app launches; a loaded Docker host needs more than the default minute.
  test.setTimeout(150_000)
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-draft-'))
  try {
    const first = await launchCiteFox({ userDataDir: dir, viewport })
    try {
      await welcome(first.page)
      await first.page.getByRole('button', { name: 'Get started' }).click()
      await first.page.getByLabel(/Your website/).fill('textbolt.com')
      await first.page.getByLabel(/Your name/).fill('Rakesh')
      await first.page.getByLabel(/Where are your buyers/).selectOption('US')
      await expect.poll(() => draftText(dir)).toContain('"country":"US"')
      expect(draftText(dir)).toContain('"setupView":"site"')
    } finally {
      await first.app.close()
    }

    const second = await launchCiteFox({ userDataDir: dir, viewport })
    try {
      const { page } = second
      await expect(
        page.getByRole('heading', { level: 1, name: 'Which website should AI answers cite?' })
      ).toBeVisible()
      await expect(page.getByLabel(/Your website/)).toHaveValue('textbolt.com')
      await expect(page.getByLabel(/Your name/)).toHaveValue('Rakesh')
      await expect(page.getByLabel(/Where are your buyers/)).toHaveValue('US')
      // A later step comes back too.
      await page.getByLabel(/^Language/).selectOption('en')
      await page.getByRole('button', { name: 'Continue' }).click()
      await expect(
        page.getByRole('heading', { level: 1, name: 'Let your AI do the reading and writing' })
      ).toBeVisible()
      await expect.poll(() => draftText(dir)).toContain('"setupView":"claude"')
    } finally {
      await second.app.close()
    }

    const third = await launchCiteFox({ userDataDir: dir, viewport })
    try {
      await expect(
        third.page.getByRole('heading', {
          level: 1,
          name: 'Let your AI do the reading and writing'
        })
      ).toBeVisible()
      await expect
        .poll(() => third.page.evaluate(() => window.location.hash))
        .toBe('#/setup/claude')
    } finally {
      await third.app.close()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('rows filled from a ChatGPT answer survive a restart', async () => {
  // Three app launches; a loaded Docker host needs more than the default minute.
  test.setTimeout(150_000)
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-draft-fill-'))
  try {
    const seeded = await launchCiteFox({ userDataDir: dir, viewport })
    try {
      await welcome(seeded.page)
      await seeded.page.evaluate(() => localStorage.setItem('citefox.client', 'mock'))
    } finally {
      await seeded.app.close()
    }

    const first = await launchCiteFox({ userDataDir: dir, viewport })
    try {
      const { page } = first
      await welcome(page)
      await page.getByRole('button', { name: 'Get started' }).click()
      await page.getByLabel(/Your website/).fill('textbolt.com')
      await page.getByLabel(/Where are your buyers/).selectOption('US')
      await page.getByLabel(/^Language/).selectOption('en')
      await page.getByRole('button', { name: 'Continue' }).click()
      await page.getByRole('button', { name: 'Skip and use your own ChatGPT instead' }).click()
      await page.getByRole('button', { name: 'Get the prompt' }).click()
      await page.getByLabel('Paste its answer below').fill('### PRODUCTS\nname,url,job')
      await page.getByRole('button', { name: 'Read the answer' }).click()
      await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('#/setup/brand')
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem('citefox.mock.onboardingDraft') ?? ''))
        .toContain('Email-to-SMS gateway')
    } finally {
      await first.app.close()
    }

    const second = await launchCiteFox({ userDataDir: dir, viewport })
    try {
      const { page } = second
      await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('#/setup/brand')
      await expect(page.locator('#main')).toContainText('Email-to-SMS gateway')
    } finally {
      await second.app.close()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
