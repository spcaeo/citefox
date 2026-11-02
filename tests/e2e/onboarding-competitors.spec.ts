import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'

/**
 * Docs/FEEDBACK.md row 3 and batch 2 row 5, onboarding v2: "✦ Read my website" on
 * textbolt.com (mock build) applies its answer into the sections as ticked AI rows.
 * Competitors are the web search's rivals; the carrier gateways that shut down go to
 * "They switch from" and WIN-911 to "Used with", never to the competitor list.
 * Saves `onboarding-v2-competitors.png`.
 */

interface SavedRow {
  name: string
  url: string | null
  kept: boolean
  origin: string
}

interface SavedDraft {
  setup?: { lists: Record<string, SavedRow[]> }
}

async function openOnboarding(): Promise<{ app: ElectronApplication; page: Page; dir: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-competitors-'))
  // Tall enough that the whole suggestion card fits above the sticky footer.
  const viewport = { width: 1280, height: 1800 }
  const seeded = await launchCiteFox({ userDataDir: dir, viewport })
  try {
    await expect(
      seeded.page.getByRole('heading', { level: 1, name: /See whether Google/ })
    ).toBeVisible()
    await seeded.page.evaluate(() => localStorage.setItem('citefox.client', 'mock'))
  } finally {
    await seeded.app.close()
  }
  const { app, page } = await launchCiteFox({ userDataDir: dir, viewport })
  await expect(page.getByRole('heading', { level: 1, name: /See whether Google/ })).toBeVisible()
  return { app, page, dir }
}

test('the website read keeps carriers and integrations out of competitors', async () => {
  const { app, page, dir } = await openOnboarding()
  try {
    await page.getByRole('button', { name: 'Get started' }).click()
    await page.getByLabel(/Your website/).fill('textbolt.com')
    await page.getByLabel(/Where are your buyers/).selectOption('US')
    await page.getByLabel(/^Language/).selectOption('en')
    await page.getByLabel(/Your name/).fill('Rakesh')
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.locator('#main').getByText('Claude Code is ready.')).toBeVisible()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Read my website' }).click()
    await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('#/setup/brand')

    const lists = async (): Promise<Record<string, SavedRow[]>> => {
      const text = await page.evaluate(
        () => localStorage.getItem('citefox.mock.onboardingDraft') ?? '{}'
      )
      return (JSON.parse(text) as SavedDraft).setup?.lists ?? {}
    }
    await expect.poll(async () => (await lists()).competitors?.length ?? 0).toBeGreaterThan(0)
    const saved = await lists()
    const names = (list: string): string[] => (saved[list] ?? []).map((row) => row.name)
    expect(names('competitors')).toEqual(
      expect.arrayContaining(['TXTImpact', 'Notifyre', 'Textmagic', 'ClickSend'])
    )
    expect((saved.competitors ?? []).every((row) => row.kept && row.origin === 'ai')).toBe(true)
    expect(names('switchingFrom')).toEqual([
      'AT&T email-to-text',
      'Verizon vText',
      'T-Mobile email-to-text'
    ])
    expect(names('integrations')).toEqual(['WIN-911'])
    const hosts = (saved.competitors ?? []).map((row) => row.url ?? '')
    expect(
      hosts.filter((host) => /att\.com|verizon\.com|t-mobile\.com|win911\.com/.test(host))
    ).toEqual([])
    expect(names('products')).toEqual(['Email-to-SMS gateway', 'Alarm and SCADA alerting'])

    await page.getByRole('button', { name: /continue/i }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect
      .poll(() => page.evaluate(() => window.location.hash))
      .toContain('#/setup/competitors')
    await expect(page.locator('#main')).toContainText('Textmagic')
    const rivals = page.getByTestId('section-competitors')
    await expect(rivals).toContainText('Textmagic')
    await expect(rivals).not.toContainText('WIN-911')
    await expect(rivals).not.toContainText('AT&T')
    // They show on their own lines instead, marked as not rivals.
    await expect(page.locator('#main')).toContainText('Used with (not rivals): WIN-911')
    await expect(page.locator('#main')).toContainText(
      'They switch from (not rivals): AT&T email-to-text'
    )
    await page.screenshot({
      path: await e2eArtifact('onboarding-v2-competitors.png'),
      fullPage: true
    })
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
