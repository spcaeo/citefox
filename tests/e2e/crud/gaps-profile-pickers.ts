import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from '../artifacts'
import { drawerShots } from '../drawer-helpers'
import { stubKeyTests } from '../key-test-stub'
import { launchCiteFox } from '../launch'
import { openAllPages } from '../nav-helpers'
import { installRawMarkdown } from '../raw-hook'
import { chooseRowAction } from '../row-menu'
import { openHash } from '../screens-app'

const BODY = 'TextBolt sends text alerts from email. No developer required.'
const FAQ_ANSWER =
  'Yes. TextBolt turns any email into a text to your whole crew, so a missed alert reaches people in seconds without a developer.'

/** The seed has no coverage matrix (it needs Claude), so one is stored before launch. */
async function storeCoverage(userDataDir: string): Promise<void> {
  const { openAppStorage } = await import('../../../src/main/storage/app-storage')
  const { closeProjectDatabase, openProjectDatabase } =
    await import('../../../src/main/storage/project-files')
  const { insertCoverage } = await import('../../../src/main/storage/coverage-records')
  const { contentHash } = await import('../../../src/main/pipeline/hash')
  const storage = openAppStorage(userDataDir)
  const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  try {
    insertCoverage(db, {
      runId: 'cov-1',
      pageId: 'page-1',
      recordedAt: '2026-10-19T13:00:00.000Z',
      templateId: 'tpl-coverage',
      templateName: 'CiteFox default',
      templateHash: contentHash('coverage template'),
      templateUpdatedAt: null,
      contentHash: contentHash(BODY),
      reused: false,
      stale: false,
      rows: [
        {
          id: 'gap-row-1',
          runId: 'cov-1',
          pageId: 'page-1',
          promptId: 'prompt-1',
          coverage: 'weak',
          whereCovered: ['Intro'],
          currentContent: 'One line about alerts.',
          whatToUpdate: 'Add a section on alerting a crew without a developer.',
          mainGap: 'No crew alert steps.',
          priority: 'high',
          actions: ['new_faq'],
          suggestedFaq: {
            question: 'Can I text my crew from email?',
            answer: FAQ_ANSWER,
            wordCount: 23
          },
          done: false
        },
        {
          id: 'gap-row-2',
          runId: 'cov-1',
          pageId: 'page-1',
          promptId: 'prompt-2',
          coverage: 'strong',
          whereCovered: ['Pricing'],
          currentContent: 'The plan table lists scheduled texts.',
          whatToUpdate: 'Nothing to change.',
          mainGap: 'None.',
          priority: 'low',
          actions: ['none'],
          suggestedFaq: null,
          done: false
        }
      ],
      findings: []
    })
  } finally {
    closeProjectDatabase(db)
    storage.close()
  }
}

async function openApp(): Promise<{
  app: ElectronApplication
  page: Page
  close: () => Promise<void>
}> {
  installRawMarkdown()
  const { seedTwoMarketProject } = await import('../screens-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-crud-gaps-'))
  await seedTwoMarketProject(dir)
  await storeCoverage(dir)
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1280, height: 900 }
  })
  // "Test and save" tests a new key: recorded account body, no call to SerpApi.
  await stubKeyTests(app)
  await openAllPages(page)
  return {
    app,
    page,
    close: async () => {
      await app.close()
      await rm(dir, { recursive: true, force: true })
    }
  }
}

function hashOf(page: Page): Promise<string> {
  return page.evaluate(() => window.location.hash)
}

function statusRow(matrix: Locator, position: number): Locator {
  return matrix
    .locator('.ui-lg-row')
    .filter({ has: matrix.page().locator('.gp-q', { hasText: String(position) }) })
}

/** Content gaps, Buyer profile, Track a page, Add an API key and the top bar's Create entries. */
export function gapsProfilePickersCrud(): void {
  test('content gaps: edit and reset an FAQ draft, open → published → verified, JSON-LD, plan as a fix', async () => {
    test.setTimeout(180_000)
    const { app, page, close } = await openApp()
    try {
      await openHash(page, '#/pages/page-1/gaps')
      const panel = page.locator('#page-tabpanel')
      const matrix = panel.getByRole('grid', { name: 'Coverage matrix' })
      await expect(matrix).toBeVisible()

      await test.step('edit the FAQ draft in its drawer, then reset to Claude’s draft', async () => {
        await chooseRowAction(page, matrix, 'question 1', 'Edit FAQ draft')
        await expect.poll(() => hashOf(page)).toMatch(/drawer=gap-draft&gap=gap-row-1/)
        const drawer = page.getByRole('dialog', { name: /Edit FAQ draft/ })
        await expect(drawer.getByRole('textbox', { name: 'Answer' })).toHaveValue(FAQ_ANSWER)
        await drawerShots(page, 'crud-gap-draft')
        await drawer
          .getByRole('textbox', { name: 'Answer' })
          .fill('Yes. TextBolt texts your crew from any email, no developer needed.')
        await expect(drawer.getByText(/short of the 40–70 words/)).toBeVisible()
        await drawer.getByRole('button', { name: 'Save draft' }).click()
        await expect(drawer).toHaveCount(0)
        await expect(page.getByTestId('gap-draft-toast')).toContainText('Saved the FAQ draft')

        await chooseRowAction(page, matrix, 'question 1', 'Edit FAQ draft')
        const again = page.getByRole('dialog', { name: /Edit FAQ draft/ })
        await expect(again.getByRole('textbox', { name: 'Answer' })).toHaveValue(
          /no developer needed/
        )
        await again.getByRole('button', { name: 'Reset to CiteFox AI’s draft' }).click()
        await expect(again).toHaveCount(0)
        await expect(page.getByTestId('gap-draft-toast')).toContainText(
          'back to CiteFox AI’s draft'
        )
      })

      await test.step('open → published → verified', async () => {
        await expect(statusRow(matrix, 1)).toContainText('Open')
        await chooseRowAction(page, matrix, 'question 1', 'Mark published: question 1')
        await expect(statusRow(matrix, 1)).toContainText('Published')
        await chooseRowAction(page, matrix, 'question 1', 'Mark verified: question 1')
        await expect(statusRow(matrix, 1)).toContainText('Verified')
        // The status is stored: it survives a reload.
        await page.reload()
        await expect(
          statusRow(panel.getByRole('grid', { name: 'Coverage matrix' }), 1)
        ).toContainText('Verified')
      })

      await test.step('copy as FAQPage JSON-LD', async () => {
        await app.evaluate(({ clipboard }) => clipboard.writeText(''))
        await chooseRowAction(page, matrix, 'question 1', 'Copy as FAQPage JSON-LD')
        await expect
          .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
          .toContain('"FAQPage"')
        const copied = JSON.parse(await app.evaluate(({ clipboard }) => clipboard.readText())) as {
          mainEntity: { name: string }[]
        }
        expect(copied.mainEntity[0]?.name).toBe('Can I text my crew from email?')
        await page.keyboard.press('Escape')
      })

      await test.step('plan as a fix opens the Fix drawer on the URL', async () => {
        await chooseRowAction(page, matrix, 'question 1', 'Plan as a fix')
        await expect.poll(() => hashOf(page)).toMatch(/drawer=fix&fix=new&fix\.page=page-1/)
        expect(await hashOf(page)).toContain('fix.prompts=prompt-1')
      })
    } finally {
      await close()
    }
  })

  test('buyer profile: edit a point in place, add one, remove it with Undo', async () => {
    test.setTimeout(180_000)
    const { page, close } = await openApp()
    try {
      await openHash(page, '#/pages/page-1/audience')
      const grid = page.getByRole('grid', { name: 'Buyer profile points' })
      await expect(grid).toBeVisible()

      await grid.getByRole('button', { name: 'Edit point: They send email.' }).click()
      const box = grid.getByRole('textbox', { name: 'Edit point: They send email.' })
      await box.fill('They live in their inbox.')
      await box.press('Enter')
      await expect(grid.getByText('They live in their inbox.')).toBeVisible()

      await grid.getByRole('button', { name: 'Add environment' }).click()
      const add = grid.getByRole('textbox', { name: 'New point in Their environment' })
      await add.fill('Slack for the office')
      await add.press('Enter')
      await expect(grid.getByText('Slack for the office')).toBeVisible()
      await page.screenshot({ path: await e2eArtifact('drawer-crud-profile-inline-1280.png') })

      await chooseRowAction(page, grid, 'Slack for the office', 'Remove')
      await expect(grid.getByText('Slack for the office')).toHaveCount(0)
      const toast = page.getByTestId('profile-remove-toast')
      await expect(toast).toContainText('Removed “Slack for the office”.')
      await toast.getByRole('button', { name: 'Undo' }).click()
      await expect(grid.getByText('Slack for the office')).toBeVisible()
      // Saved: a reload shows the edited and restored points.
      await page.reload()
      const reloaded = page.getByRole('grid', { name: 'Buyer profile points' })
      await expect(reloaded.getByText('They live in their inbox.')).toBeVisible()
      await expect(reloaded.getByText('Slack for the office')).toBeVisible()
    } finally {
      await close()
    }
  })

  test('pickers create: track a page from the top bar, add a SerpApi key from Searches, top bar Create', async () => {
    test.setTimeout(180_000)
    const { page, close } = await openApp()
    try {
      const search = page.getByRole('combobox', {
        name: 'Find anything: screens, settings, reports, help, actions, pages, topics and questions'
      })

      await test.step('the top bar offers Create entries when nothing matches', async () => {
        await search.fill('zzqx weekend outages')
        const create = page.getByRole('group', { name: 'Create' })
        await expect(
          create.getByRole('option', { name: 'Create topic “zzqx weekend outages”' })
        ).toBeVisible()
        await expect(
          create.getByRole('option', { name: 'Add questions: “zzqx weekend outages”' })
        ).toBeVisible()
        await search.press('ArrowDown')
        await search.press('Enter')
        await expect.poll(() => hashOf(page)).toContain('drawer=new-topic')
        const topic = page.getByRole('dialog', { name: /New topic/ })
        await topic.getByRole('button', { name: 'Close New topic' }).click()
        await expect.poll(() => hashOf(page)).not.toContain('drawer=')
      })

      await test.step('track a page typed in the top bar; it opens the new page', async () => {
        await search.fill('/brand-new-e2e-page')
        await page.getByRole('option', { name: 'Track page /brand-new-e2e-page' }).click()
        await expect.poll(() => hashOf(page)).toContain('drawer=track-page')
        const drawer = page.getByRole('dialog', { name: /Track a page/ })
        await expect(drawer.getByRole('textbox', { name: 'Address' })).toHaveValue(
          '/brand-new-e2e-page'
        )
        await drawerShots(page, 'crud-track-page')
        await drawer.getByRole('textbox', { name: 'Label (optional)' }).fill('Brand new e2e')
        await drawer.getByRole('button', { name: 'Track page' }).click()
        await expect(drawer).toHaveCount(0)
        await expect.poll(() => hashOf(page)).toMatch(/^#\/pages\/page-[^/]+\/prompts/)
        expect(await hashOf(page)).not.toContain('page-1/')
      })

      await test.step('Searches: “+ Add a SerpApi key…” adds one and picks it', async () => {
        await openHash(page, '#/project-settings')
        await page.getByRole('tab', { name: 'Searches & cost', exact: true }).click()
        const searches = page.getByRole('region', { name: 'Searches & cost', exact: true })
        await searches.getByLabel(/A dedicated key/).check()
        const picker = searches.getByRole('combobox', { name: /^Dedicated key/ })
        await picker.selectOption('__citefox_new__')
        await expect.poll(() => hashOf(page)).toContain('drawer=add-key&key.provider=serpapi')
        const drawer = page.getByRole('dialog', { name: /Add a SerpApi key/ })
        await drawerShots(page, 'crud-add-key')
        await drawer.getByRole('textbox', { name: 'Name' }).fill('E2E dedicated key')
        await drawer.getByLabel('API key', { exact: true }).fill('fake-e2e-serpapi-key-0001')
        await drawer.getByRole('button', { name: 'Test and save' }).click()
        await expect(drawer).toHaveCount(0)
        await expect(page.getByTestId('add-key-toast')).toContainText(
          'E2E dedicated key tested and saved.'
        )
        await expect(picker.locator('option:checked')).toHaveText(/E2E dedicated key/)
        await expect(page.locator('body')).not.toContainText('fake-e2e-serpapi-key-0001')
      })
    } finally {
      await close()
    }
  })
}
