import { expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { JinaMode } from '../../src/shared/domain'
import type { CiteFoxApi, SaveProfileRequest } from '../../src/shared/ipc'
import { launchCiteFox } from './launch'

/**
 * "Already onboarded" starts for specs about other screens, so they never walk the
 * setup wizard (tests/e2e/setup-walk.ts walks it for the specs about onboarding).
 * Both end where a person lands right after onboarding: the TextBolt project with no
 * pages yet, a working SerpApi key, Claude checked, and "How do you want to start?".
 */

/** The SerpApi key both seeds hold (the mock's sample key; 250 searches a month). */
export const ONBOARDED_SERP_KEY = 'citefox-sample-serpapi-b1f4'

export interface OnboardedMock {
  app: ElectronApplication
  page: Page
  dir: string
}

/**
 * The mock build, onboarded (`citefox.mock.onboarded`): a first launch sets the
 * client flags, the second opens on "How do you want to start?". `storage` adds more
 * localStorage flags, such as `citefox.mock.pace` or `citefox.mock.scenario`.
 */
export async function launchOnboardedMock(
  prefix: string,
  options: {
    viewport?: { width: number; height: number }
    storage?: Record<string, string>
  } = {}
): Promise<OnboardedMock> {
  const dir = await mkdtemp(path.join(os.tmpdir(), `citefox-${prefix}-`))
  const viewport = options.viewport ?? { width: 1280, height: 820 }
  const storage = {
    'citefox.client': 'mock',
    'citefox.mock.pace': '0',
    'citefox.mock.onboarded': '1',
    ...options.storage
  }
  const seeded = await launchCiteFox({ userDataDir: dir, viewport })
  try {
    await expect(
      seeded.page.getByRole('heading', { level: 1, name: /See whether Google/ })
    ).toBeVisible()
    await seeded.page.evaluate((entries) => {
      for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value)
    }, storage)
  } finally {
    await seeded.app.close()
  }
  const { app, page } = await launchCiteFox({ userDataDir: dir, viewport })
  // Where Finish leaves a person (afterOnboardingHash in the renderer).
  await expect(page.getByRole('button', { name: /^Switch project/ })).toBeVisible()
  await page.evaluate(() => {
    window.location.hash = '#/start/choose'
  })
  await expect(
    page.getByRole('heading', { level: 1, name: 'How do you want to start?' })
  ).toBeVisible()
  return { app, page, dir }
}

export interface BridgeOnboarding {
  profile?: Partial<SaveProfileRequest>
  serpKey?: string
  /** The SerpApi key's monthly budget. */
  cap?: number | null
  /** Jina Reader mode, as the old Jina step chose it. */
  jinaMode?: JinaMode
}

/**
 * The production shell, onboarded through the real handlers (the preload bridge) with
 * no wizard: the profile, the SerpApi key (stored in the test keychain and tested, so
 * `fetch` must answer serpapi.com/account), the Claude Code checkup (the shim on PATH),
 * then `onboarding:finish`. The window reloads onto "How do you want to start?".
 */
export async function onboardThroughBridge(
  page: Page,
  options: BridgeOnboarding = {}
): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: /See whether Google/ })).toBeVisible()
  const profile: SaveProfileRequest = {
    userName: 'Rakesh',
    projectName: 'TextBolt',
    domain: 'textbolt.com',
    includeSubdomains: true,
    brandNames: ['TextBolt'],
    competitors: [],
    country: 'US',
    language: 'en',
    location: null,
    device: 'desktop',
    ...options.profile
  }
  const result = await page.evaluate(
    async ({ profile, serpKey, cap, jinaMode }) => {
      const api = (window as unknown as { citefox: CiteFoxApi }).citefox
      await api['onboarding:saveProfile'](profile)
      const key = await api['keys:add']({
        provider: 'serpapi',
        name: 'SerpApi',
        secret: serpKey,
        cap,
        projectIds: []
      })
      const tested = await api['keys:test']({ id: key.id })
      const checkup = await api['claudeCode:runCheckup']({ binaryPath: null })
      if (jinaMode !== null) await api['settings:update']({ jinaMode })
      const state = await api['onboarding:finish']()
      return { key: tested.key.state, checkup: checkup.ready, finished: state.finished }
    },
    {
      profile,
      serpKey: options.serpKey ?? ONBOARDED_SERP_KEY,
      cap: options.cap === undefined ? 250 : options.cap,
      jinaMode: options.jinaMode ?? null
    }
  )
  expect(result).toEqual({ key: 'ok', checkup: true, finished: true })
  await page.reload()
  // Where Finish leaves a person (afterOnboardingHash in the renderer).
  await expect(page.getByRole('button', { name: /^Switch project/ })).toBeVisible()
  await page.evaluate(() => {
    window.location.hash = '#/start/choose'
  })
  await expect(
    page.getByRole('heading', { level: 1, name: 'How do you want to start?' })
  ).toBeVisible()
}
