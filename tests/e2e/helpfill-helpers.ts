import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SqliteDatabase } from '../../src/main/storage/database'
import { e2eArtifact } from './artifacts'
import { animationsDone } from './drawer-helpers'
import { launchCiteFox } from './launch'
import { openAllPages } from './nav-helpers'
import { installRawMarkdown } from './raw-hook'
import { writeClaudeStandIn } from './claude-stand-in'

/**
 * Shared set-up for the ✦ Help me fill this specs that run on the two-market
 * TextBolt seed: the `claude` stand-in on PATH (recorded fixtures), the fake
 * site reads and DNS (`CITEFOX_E2E_TOPICS=1`), and `shell.openExternal` and the
 * clipboard stubbed, so nothing leaves the app.
 */

const ROOT = process.cwd()
const SHIM = path.join(ROOT, 'tests/e2e/claude-shim.mjs')
const FIXTURE_DIR = path.join(ROOT, 'src/main/providers/fixtures/textbolt')
export const WIDE = { width: 1440, height: 900 }
export const NARROW = { width: 1134, height: 770 }

export interface HelpFillApp {
  app: ElectronApplication
  page: Page
  dir: string
  shimLog: string
}

/** Seeds TextBolt, lets `extra` change its project file, then starts the app. */
export async function launchHelpFill(
  prefix: string,
  extra: (projectDb: SqliteDatabase) => Promise<void>
): Promise<HelpFillApp> {
  installRawMarkdown()
  const { seedTwoMarketProject } = await import('./screens-seed')
  const { openAppStorage } = await import('../../src/main/storage/app-storage')
  const { openProjectDatabase, closeProjectDatabase } =
    await import('../../src/main/storage/project-files')
  const dir = await mkdtemp(path.join(os.tmpdir(), `citefox-${prefix}-`))
  await seedTwoMarketProject(dir)
  const storage = openAppStorage(dir)
  const projectDb = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  try {
    await extra(projectDb)
  } finally {
    closeProjectDatabase(projectDb)
    storage.close()
  }
  const bin = path.join(dir, 'bin')
  await mkdir(bin, { recursive: true })
  await writeClaudeStandIn(path.join(bin, 'claude'), SHIM)
  const shimLog = path.join(dir, 'claude-shim.log')
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: WIDE,
    env: {
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      CITEFOX_FIXTURE_DIR: FIXTURE_DIR,
      CITEFOX_SHIM_LOG: shimLog,
      CITEFOX_E2E_TOPICS: '1'
    }
  })
  await openAllPages(page)
  await stubOutside(app, page)
  return { app, page, dir, shimLog }
}

/** `shell.openExternal` and the clipboard only record what they were given. */
async function stubOutside(app: ElectronApplication, page: Page): Promise<void> {
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { __opened?: string[] }).__opened = opened
    shell.openExternal = (async (url: string) => {
      opened.push(url)
    }) as typeof shell.openExternal
  })
  await page.evaluate(() => {
    const copied: string[] = []
    ;(window as unknown as { __copied: string[] }).__copied = copied
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          copied.push(text)
        }
      }
    })
  })
}

export async function opened(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => [...((globalThis as { __opened?: string[] }).__opened ?? [])])
}

export async function copied(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(window as unknown as { __copied: string[] }).__copied])
}

/**
 * Both sizes and both themes, with no sideways scroll in the window, the box
 * (a drawer or the screen) or anything inside it. Saves helpfill-<name>-*.png.
 */
export async function shots(page: Page, box: Locator, name: string, focus: Locator): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    for (const size of [WIDE, NARROW]) {
      await page.setViewportSize(size)
      await animationsDone(page)
      await focus.evaluate((node) => node.scrollIntoView({ block: 'center' }))
      await page.waitForTimeout(200)
      const overflow = await box.evaluate((node) => {
        const body = node.querySelector('.ui-drawer-body') ?? node
        const root = document.scrollingElement ?? document.documentElement
        const inner = [...node.querySelectorAll<HTMLElement>('*')]
          .filter((el) => {
            const x = getComputedStyle(el).overflowX
            return (x === 'auto' || x === 'scroll') && el.scrollWidth - el.clientWidth > 1
          })
          .map((el) => el.className || el.tagName)
        // What sticks out past the box's right edge, to name it when the check fails.
        const style = getComputedStyle(body)
        const edge =
          body.getBoundingClientRect().left +
          body.clientLeft +
          body.clientWidth -
          parseFloat(style.paddingRight)
        const out = [...body.querySelectorAll<HTMLElement>('*')]
          .filter((el) => el.getBoundingClientRect().right > edge + 1)
          .slice(0, 5)
          .map((el) => `${el.tagName}.${String(el.className)}`)
        return {
          page: root.scrollWidth - root.clientWidth,
          body: body.scrollWidth - body.clientWidth,
          inner,
          out
        }
      })
      expect(overflow.page, `${name} ${size.width} ${scheme}: window`).toBeLessThanOrEqual(0)
      expect(
        overflow.body,
        `${name} ${size.width} ${scheme}: box (${overflow.out.join(', ')})`
      ).toBeLessThanOrEqual(0)
      expect(overflow.inner, `${name} ${size.width} ${scheme}: inside the box`).toEqual([])
      await page.screenshot({
        path: await e2eArtifact(`helpfill-${name}-${size.width}-${scheme}.png`)
      })
    }
  }
  await page.emulateMedia({ colorScheme: 'light' })
  await page.setViewportSize(WIDE)
}

/** The radios are visually hidden inside their cards: click the card, as a person does. */
export async function pick(radio: Locator): Promise<void> {
  await radio.locator('xpath=..').click()
  await expect(radio).toBeChecked()
}

export function hashOf(page: Page): Promise<string> {
  return page.evaluate(() => window.location.hash)
}

/** Nothing a prompt carries may be private: no email, home path or key. */
export function expectNothingPrivate(text: string): void {
  expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}|\/Users\/|\/home\/|sk-ant-/iu)
}
