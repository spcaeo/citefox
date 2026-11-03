import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { launchCiteFox } from './launch'
import { installRawMarkdown } from './raw-hook'
import { expectMainAccessible, openHash } from './screens-app'
import { e2eArtifactsDir } from './artifacts'
import {
  ASSISTANT_TEMPLATE_KINDS,
  GENERATION_TEMPLATE_KINDS,
  TOPIC_TEMPLATE_KINDS,
  templateKindLifecycle
} from '@shared/domain'
import { openAllPages } from './nav-helpers'
import { writeClaudeStandIn } from './claude-stand-in'

/**
 * The Templates screen through real IPC (FR-26.1 to FR-26.8, TPL-1 to TPL-5).
 * The two-market TextBolt seed is the open project, so every save is a project
 * version. The `claude` stand-in answers the buyer profile prompt from
 * claude-profile.json and `Assist: template.improve` from
 * src/main/assist/fixtures/template.improve.json. No SerpApi search runs.
 */

const ROOT = process.cwd()
const SHIM = path.join(ROOT, 'tests/e2e/claude-shim.mjs')
const FIXTURE_DIR = path.join(ROOT, 'src/main/providers/fixtures/textbolt')
const IMPROVE_FIXTURE = path.join(ROOT, 'src/main/assist/fixtures/template.improve.json')
const SCREENSHOTS = path.join(e2eArtifactsDir(), 'screenshots', 'templates')
/**
 * The Pages group, in run order. Topics (TOPIC_TEMPLATE_KINDS) follow, then Reports,
 * then Ask CiteFox's answer steps (ASSISTANT_TEMPLATE_KINDS) last.
 */
const PAGE_STEPS = [
  'Buyer profile',
  'Buyer questions',
  'Brand questions',
  'Coverage matrix',
  'Page audit',
  'Coverage fixes',
  'Overview gap',
  'Answer shape',
  'Sentiment claims',
  'Sentiment fact check',
  'Video brief'
]
// Retired steps (replaced by narrower ones) stay read-only and are not listed.
const LISTED_KINDS = GENERATION_TEMPLATE_KINDS.filter(
  (kind) => templateKindLifecycle(kind) === 'live'
)
const LISTED_TOPIC_KINDS = TOPIC_TEMPLATE_KINDS.filter(
  (kind) => templateKindLifecycle(kind) === 'live'
)
const ADDED_LINE = 'Keep each question under 30 words.'

test('templates list every step, save project versions, compare, reset, try and improve', async () => {
  test.setTimeout(240_000)
  installRawMarkdown()
  const { seedTwoMarketProject, SEED } = await import('./screens-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-template-editor-'))
  await seedTwoMarketProject(dir)
  const bin = path.join(dir, 'bin')
  await mkdir(bin, { recursive: true })
  await writeClaudeStandIn(path.join(bin, 'claude'), SHIM)
  await mkdir(SCREENSHOTS, { recursive: true })

  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1280, height: 900 },
    env: {
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      CITEFOX_FIXTURE_DIR: FIXTURE_DIR,
      CITEFOX_SHIM_LOG: path.join(dir, 'claude-shim.log')
    }
  })

  try {
    await openAllPages(page)
    await openHash(page, '#/templates')
    await expect(page.getByRole('heading', { level: 1, name: 'Templates' })).toBeVisible()

    await test.step('every AI step is listed in run order as the default', async () => {
      await expect(stepButtons(page)).toHaveCount(LISTED_KINDS.length)
      for (const [index, label] of PAGE_STEPS.entries()) {
        const row = stepButtons(page).nth(index)
        await expect(row).toContainText(label)
        await expect(row).toContainText('Default')
        await expect(
          stepContainers(page)
            .nth(index)
            .locator('[title^="v"]')
            .filter({ hasText: /^v\d+$/ })
        ).toHaveAttribute('title', /^v\d+ · hash [0-9a-f]{4}…/)
      }
      // The file name sits in the step name's tooltip, not in the row text.
      await expect(
        stepButtons(page).nth(PAGE_STEPS.length).locator('.tpl-grid-label')
      ).toHaveAttribute('title', `${LISTED_TOPIC_KINDS[0]}.md`)
      await expect(stepButtons(page).last()).toContainText('Ask: how this screen works')
      const groups = page.locator('[role="grid"][aria-label="AI steps"] .ui-lg-group')
      await expect(groups).toHaveCount(4)
      await expect(groups.nth(0)).toContainText(`Pages${PAGE_STEPS.length}`)
      await expect(groups.nth(1)).toContainText(`Topics${LISTED_TOPIC_KINDS.length}`)
      await expect(groups.nth(2)).toContainText('Reports1')
      await expect(stepButtons(page).filter({ hasText: 'Check summary' })).toHaveCount(1)
      await expect(groups.nth(3)).toContainText(`Ask CiteFox${ASSISTANT_TEMPLATE_KINDS.length}`)
      await expectMainAccessible(page)
      await page.screenshot({ path: path.join(SCREENSHOTS, 'templates-steps.png') })
      await showTab(page, /^Edit · /)
      await expect(
        editor(page).getByText(
          'Your edits apply to this project only; the default stays available.'
        )
      ).toBeVisible()
      await expectMainAccessible(page)
      await page.screenshot({ path: path.join(SCREENSHOTS, 'templates-step-editor.png') })
    })

    await test.step('editing Buyer questions saves a project version and compares with the default', async () => {
      await openStep(page, 'Buyer questions')
      await editor(page).getByRole('button', { name: 'Edit', exact: true }).click()
      const area = editor(page).getByRole('textbox', { name: 'Template' })
      const shipped = await area.inputValue()
      await area.fill(`${shipped.trimEnd()}\n${ADDED_LINE}\n`)
      await expect(editor(page).getByText('Unsaved changes')).toBeVisible()
      await editor(page).getByRole('button', { name: 'Save', exact: true }).click()
      await expect(
        editor(page).getByText(/^Saved as v1 · hash [0-9a-f]{4}…\. Existing/)
      ).toBeVisible()
      await expect(stepRow(page, 'Buyer questions')).toContainText('Overridden for this project')

      await editor(page).getByRole('button', { name: 'Compare with default' }).click()
      const compare = editor(page).getByRole('region', {
        name: 'Your version compared with the default'
      })
      await expect(compare.getByRole('listitem').filter({ hasText: ADDED_LINE })).toContainText(
        `Added: ${ADDED_LINE}`
      )
      await compare.scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(SCREENSHOTS, 'templates-compare.png') })
    })

    await test.step('Tone saves with the body as the next version, and Reset goes back', async () => {
      const tone = editor(page).getByLabel('Tone')
      await expect(tone.locator('option', { hasText: 'Search-style short' })).toHaveCount(0)
      await expect(
        editor(page).getByText(/Buyer questions stay long situational questions/)
      ).toBeVisible()
      await tone.selectOption({ label: 'Conversational' })
      await editor(page).getByRole('button', { name: 'Save', exact: true }).click()
      await expect(editor(page).getByText(/^Saved as v2 · hash/)).toBeVisible()
      await expect(
        editor(page).getByRole('button', { name: 'Version history: 2 versions' })
      ).toBeVisible()

      await editor(page).getByRole('button', { name: 'Reset to default' }).click()
      const dialog = page.getByRole('alertdialog', {
        name: 'Reset Buyer questions to the default?'
      })
      await dialog.getByRole('button', { name: 'Reset' }).click()
      await expect(stepRow(page, 'Buyer questions')).toContainText('Default')
      await expect(editor(page).getByLabel('Tone')).toHaveValue('')
      await expect(editor(page).getByText(ADDED_LINE)).toHaveCount(0)
    })

    await test.step('versions and last runs drill into the shared drawer', async () => {
      const drawer = page.getByRole('dialog')
      const history = editor(page).getByRole('button', { name: /^Version history: \d+ versions?$/ })
      const shown = Number(await history.locator('[data-nfr-figure]').textContent())
      await history.click()
      await expect(drawer.locator('[data-drill-row]')).toHaveCount(shown)
      await page.keyboard.press('Escape')
      await expect(drawer).toHaveCount(0)

      await showTab(page, /^Steps/)
      const row = stepContainers(page).filter({ hasText: 'Buyer questions' })
      await row.getByRole('button', { name: /^Version history: v\d+/ }).click()
      await expect(drawer.getByRole('heading', { level: 2 })).toContainText(
        'Buyer questions: version history'
      )
      // Project versions (2) plus the app default's versions.
      expect(await drawer.locator('[data-drill-row]').count()).toBeGreaterThanOrEqual(3)
      await page.keyboard.press('Escape')

      const lastRun = stepContainers(page).getByRole('button', { name: /^AI calls: Last run/ })
      if ((await lastRun.count()) > 0) {
        await lastRun.first().click()
        const heading = await drawer.getByRole('heading', { level: 2 }).textContent()
        const calls = Number(/· (\d+) calls?$/.exec(heading ?? '')?.[1])
        await expect(drawer.locator('[data-drill-row]')).toHaveCount(calls)
        await page.keyboard.press('Escape')
      }
      await expectMainAccessible(page)
    })

    await test.step('the content-gap steps show their output fields', async () => {
      // Content gaps run as three steps (P1): the matrix rates, the page audit finds.
      await openStep(page, 'Page audit')
      await expect(
        page.getByRole('region', { name: 'Output fields as JSON schema' })
      ).toContainText('"findings"')
      await openStep(page, 'Coverage matrix')
      const fields = page.getByRole('region', { name: 'Output fields as JSON schema' })
      await expect(fields).toContainText('"rows"')
      await expect(
        page.getByText(
          "CiteFox checks CiteFox AI's answer against these fields and retries once if they don't match."
        )
      ).toBeVisible()
      await expect(editor(page).getByLabel('Tone')).toHaveCount(0)
    })

    await test.step('Try it runs the buyer profile draft on the seeded page and saves nothing', async () => {
      await openStep(page, 'Buyer profile')
      await expect(page.getByLabel('Page', { exact: true })).toHaveValue(SEED.pageId)
      await expect(page.getByLabel('Market', { exact: true })).toHaveValue(SEED.us)
      await expect(page.getByText(/^Uses your AI plan · about \d+ s$/)).toBeVisible()
      await page.getByRole('button', { name: 'Run on sample' }).click()
      await expect(page.getByText(/matched the output fields/)).toBeVisible({ timeout: 60_000 })
      await expect(page.getByRole('region', { name: "CiteFox AI's answer" })).toContainText('who')
      await expect(page.getByText('The prompt CiteFox sent')).toBeVisible()
      await page.getByRole('button', { name: 'Run on sample' }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(SCREENSHOTS, 'templates-try.png') })
      const profile = await page.evaluate(
        (request) =>
          (
            window as unknown as {
              citefox: Record<string, (value: unknown) => Promise<{ who: string } | null>>
            }
          ).citefox['buyerProfile:get']?.(request),
        { projectId: SEED.projectId, pageId: SEED.pageId }
      )
      expect(profile?.who).toBe('Office managers.')
      await expect(stepRow(page, 'Buyer profile')).toContainText('Default')
    })

    await test.step('Improve with Claude applies lines to the draft and Undo restores it', async () => {
      const fixture = JSON.parse(readFileSync(IMPROVE_FIXTURE, 'utf8')) as {
        items: { text: string; sign: 'add' | 'remove' | null }[]
      }
      const added = fixture.items.find((item) => item.sign === 'add')?.text ?? ''
      expect(added.length).toBeGreaterThan(0)
      await openStep(page, 'Buyer questions')
      const name = 'Improve this template with CiteFox AI'
      // The editor's one AI menu holds Improve with Claude.
      await editor(page).getByRole('button', { name: 'AI actions for this template' }).click()
      await page.getByRole('menuitem', { name: new RegExp(`^${name}`) }).click()
      const region = editor(page).getByRole('region', { name })
      // A step with no saved runs needs an instruction; Try again sends it.
      await region
        .getByRole('textbox', { name: 'Tell CiteFox AI what to change' })
        .fill('Keep prompts long and never name a brand.')
      await region.getByRole('button', { name: 'Try again' }).click()
      await expect(region.getByRole('button', { name: 'Apply', exact: true })).toBeVisible({
        timeout: 60_000
      })
      await expect(region.getByRole('listitem').first()).toContainText(added)
      await region.getByRole('button', { name: 'Apply', exact: true }).click()
      const area = editor(page).getByRole('textbox', { name: 'Template' })
      await expect(area).toHaveValue(new RegExp(escapeRegExp(added)))
      await expect(
        editor(page).getByText(
          'Added to the template below. Review the wording, then Save. Saving makes a new version.'
        )
      ).toBeVisible()
      await expect(editor(page).getByText('Unsaved changes')).toBeVisible()
      await region.scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(SCREENSHOTS, 'templates-improve.png') })
      await region.getByRole('button', { name: 'Undo' }).click()
      await expect(area).not.toHaveValue(new RegExp(escapeRegExp(added)))
      await expect(editor(page).getByText('Unsaved changes')).toHaveCount(0)
      await expect(stepRow(page, 'Buyer questions')).toContainText('Default')
      await expectMainAccessible(page)
    })
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})

/** The step grid's body rows (each holds version and last-run drill links). */
function stepButtons(page: Page): Locator {
  return page.locator('[role="grid"][aria-label="AI steps"] [data-row]')
}

function stepContainers(page: Page): Locator {
  return stepButtons(page)
}

async function showTab(page: Page, name: RegExp): Promise<void> {
  await page.getByRole('tab', { name }).click()
}

/** The row whose step name is exactly `label` ("Buyer profile", not "Topic buyer profile"). */
function stepRow(page: Page, label: string): Locator {
  return stepButtons(page).filter({
    has: page.locator('.tpl-grid-label', { hasText: new RegExp(`^${escapeRegExp(label)}$`) })
  })
}

function editor(page: Page): Locator {
  return page.getByRole('region', { name: 'Template editor' })
}

async function openStep(page: Page, label: string): Promise<void> {
  await showTab(page, /^Steps/)
  await stepRow(page, label).locator('.tpl-grid-label').click()
  await expect(editor(page).getByRole('heading', { level: 2, name: label })).toBeVisible()
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
