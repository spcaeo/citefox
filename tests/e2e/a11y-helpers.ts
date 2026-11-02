import AxeBuilder from '@axe-core/playwright'
import { expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'

/**
 * Shared by a11y.spec.ts and layout.spec.ts. Axe runs with the WCAG 2.2 AA
 * rule set; serious and critical violations fail. `CITEFOX_A11Y_DISCOVER=1`
 * adds best-practice rules and needs-review results to the written report
 * without failing on them.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const DISCOVER = process.env.CITEFOX_A11Y_DISCOVER === '1'
const BLOCKING = new Set(['serious', 'critical'])
export const VIEWPORT = { width: 1280, height: 900 }

interface Finding {
  screen: string
  id: string
  impact: string
  help: string
  targets: string[]
}

export class Audit {
  readonly findings: Finding[] = []

  constructor(private readonly name: string) {}

  /** `exclude`: a part of the page to leave out, such as links an open menu covers. */
  async check(page: Page, screen: string, exclude?: string): Promise<void> {
    // A card still fading in (the page explainer's rise) reads as low contrast
    // mid-fade, so let every finite animation end first. Endless ones (spinners,
    // pulses) never finish and are skipped.
    await page.evaluate(async () => {
      const finite = document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
      await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)))
    })
    const builder = new AxeBuilder({ page })
      .setLegacyMode()
      .withTags(DISCOVER ? [...TAGS, 'best-practice'] : TAGS)
    if (exclude) builder.exclude(exclude)
    const results = await builder.analyze()
    const incomplete = DISCOVER
      ? results.incomplete.map((item) => ({ ...item, impact: `review-${item.impact ?? ''}` }))
      : []
    for (const violation of [...results.violations, ...incomplete]) {
      this.findings.push({
        screen,
        id: violation.id,
        impact: violation.impact ?? 'unknown',
        help: violation.help,
        targets: violation.nodes
          .slice(0, 6)
          .map(
            (node) =>
              `${node.target.join(' ')} :: ${(node.failureSummary ?? '').replace(/\n/g, ' ')}`
          )
      })
    }
    await page.evaluate(() => document.querySelector('#main')?.scrollTo(0, 0))
    await page.screenshot({ path: await e2eArtifact(`${screen}.png`) })
  }

  async finish(): Promise<void> {
    const text = this.findings
      .map(
        (item) =>
          `[${item.impact}] ${item.screen} · ${item.id}: ${item.help}\n    ${item.targets.join('\n    ')}`
      )
      .join('\n')
    await writeFile(await e2eArtifact(`a11y-${this.name}.txt`), text)
    const blocking = this.findings.filter((item) => BLOCKING.has(item.impact))
    expect(blocking.map((item) => `${item.screen} · ${item.id} · ${item.targets[0]}`)).toEqual([])
  }
}

export async function settle(page: Page): Promise<void> {
  await expect(page.getByText(/^Loading/)).toHaveCount(0)
  await expect(page.getByText(/Error invoking remote method/)).toHaveCount(0)
}

export async function freshDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), `citefox-${prefix}-`))
}

export async function relaunch(
  dir: string,
  prepare: (page: Page) => Promise<void>
): Promise<{ app: ElectronApplication; page: Page }> {
  const first = await launchCiteFox({ userDataDir: dir, viewport: VIEWPORT })
  try {
    await expect(first.page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    await prepare(first.page)
  } finally {
    await first.app.close()
  }
  return launchCiteFox({ userDataDir: dir, viewport: VIEWPORT })
}

export const SEEDED: readonly { screen: string; hash: string; heading: RegExp | string }[] = [
  { screen: 'overview', hash: '#/overview', heading: 'Summary' },
  { screen: 'questions', hash: '#/questions', heading: 'Questions' },
  { screen: 'competitors', hash: '#/competitors', heading: 'Competitors' },
  { screen: 'citations', hash: '#/citations', heading: 'Citations' },
  { screen: 'fixes', hash: '#/fixes', heading: 'Fixes' },
  { screen: 'check-history', hash: '#/history', heading: 'Check history' },
  { screen: 'add-questions', hash: '#/overview?drawer=add-questions', heading: 'Summary' },
  { screen: 'unavailable', hash: '#/no-such-screen', heading: 'This page isn’t available' },
  { screen: 'all-pages', hash: '#/pages', heading: 'Pages' },
  { screen: 'add-page', hash: '#/add-page', heading: 'Add a page to track' },
  { screen: 'page-read', hash: '#/pages/page-1/read', heading: 'Check what CiteFox read' },
  { screen: 'audience', hash: '#/pages/page-1/audience', heading: /Text alerts/ },
  { screen: 'prompts', hash: '#/pages/page-1/prompts', heading: /Text alerts/ },
  { screen: 'gaps', hash: '#/pages/page-1/gaps', heading: /Text alerts/ },
  { screen: 'running', hash: '#/pages/page-1/running', heading: /check/i },
  { screen: 'results', hash: '#/pages/page-1/results', heading: /Text alerts/ },
  { screen: 'prompt-detail', hash: '#/pages/page-1/prompt/prompt-1', heading: /alert the crew/ },
  { screen: 'markets', hash: '#/pages/page-1/markets', heading: /Text alerts/ },
  { screen: 'progress', hash: '#/pages/page-1/progress', heading: /Text alerts/ },
  { screen: 'sentiment', hash: '#/pages/page-1/sentiment', heading: /Text alerts/ },
  { screen: 'history', hash: '#/pages/page-1/history', heading: /Text alerts/ },
  { screen: 'export', hash: '#/export', heading: 'Export a report' },
  { screen: 'settings', hash: '#/settings', heading: 'Settings' },
  { screen: 'connections', hash: '#/connections', heading: 'Connections' },
  { screen: 'alerts', hash: '#/alerts', heading: 'Alerts' },
  { screen: 'email', hash: '#/settings?tab=email', heading: 'App settings' },
  { screen: 'reports', hash: '#/reports', heading: 'Reports' },
  { screen: 'templates', hash: '#/templates', heading: 'Templates' },
  { screen: 'playground', hash: '#/playground', heading: 'Playground' },
  { screen: 'projects', hash: '#/projects', heading: 'Projects' },
  { screen: 'new-project', hash: '#/projects/new', heading: 'New project' },
  { screen: 'status', hash: '#/status', heading: 'Status' },
  { screen: 'check', hash: '#/check', heading: 'Check now' }
]

/** First run, no project. `next` names the link that says what to do next, where one belongs. */
export const EMPTY: readonly { screen: string; hash: string; next?: RegExp }[] = [
  { screen: 'empty-overview', hash: '#/overview', next: /New project/ },
  { screen: 'empty-all-pages', hash: '#/pages', next: /New project/ },
  { screen: 'empty-add-page', hash: '#/add-page', next: /New project/ },
  { screen: 'empty-projects', hash: '#/projects', next: /New project/ },
  { screen: 'empty-export', hash: '#/export', next: /New project/ },
  { screen: 'empty-reports', hash: '#/reports', next: /New project/ },
  { screen: 'empty-alerts', hash: '#/alerts' },
  { screen: 'empty-templates', hash: '#/templates' },
  { screen: 'empty-playground', hash: '#/playground', next: /create a project/i },
  { screen: 'empty-status', hash: '#/status' },
  { screen: 'empty-settings', hash: '#/settings' },
  { screen: 'empty-connections', hash: '#/connections' },
  { screen: 'empty-check', hash: '#/check' }
]

/** The focused element's accessible-ish name, for keyboard assertions. */
export async function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const active = document.activeElement
    if (!active || active === document.body) return ''
    return (active.getAttribute('aria-label') || active.textContent || '').replace(/\s+/g, ' ')
  })
}

export async function focusInside(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((root) => {
    const node = document.querySelector(root)
    return Boolean(node && document.activeElement && node.contains(document.activeElement))
  }, selector)
}

/** Focus ring: a solid outline or a box-shadow ring, either way something visible. */
export async function focusRingVisible(page: Page): Promise<{ ok: boolean; name: string }> {
  return page.evaluate(() => {
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) return { ok: false, name: '' }
    // A search field draws its ring on the wrapper (:focus-within), so look up two levels.
    const ringed = (node: Element): boolean => {
      const style = getComputedStyle(node)
      const outline = style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0
      return outline || style.boxShadow !== 'none'
    }
    const parent = active.parentElement
    const grand = parent?.parentElement ?? null
    const ok =
      ringed(active) ||
      (parent !== null && parent.matches(':focus-within') && ringed(parent)) ||
      (grand !== null && grand.matches(':focus-within') && ringed(grand))
    const name = (active.getAttribute('aria-label') || active.textContent || active.tagName)
      .replace(/\s+/g, ' ')
      .slice(0, 60)
    return { ok, name }
  })
}
