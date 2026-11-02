import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectDrawerRows } from '../drill-helpers'
import { drawerShots } from '../drawer-helpers'
import { chooseRowAction } from '../row-menu'
import { openHash, openTwoMarketApp, shot, type SeededApp } from '../screens-app'

const PROJECT = 'proj-1'
const SEEDED_URL = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'
const PRICING_URL = 'https://textbolt.com/pricing/'

type Bridge = Record<string, (request: unknown) => Promise<unknown>>

/** Calls a channel on the real preload bridge, as the renderer does. */
async function call(page: Page, channel: string, request: unknown): Promise<unknown> {
  return page.evaluate(
    ([name, body]) => (window as unknown as { citefox: Bridge }).citefox[name as string]?.(body),
    [channel, request] as const
  )
}

function grid(page: Page): Locator {
  return page.getByRole('grid', { name: 'Topics', exact: true })
}

async function toast(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.getByTestId('topic-undo')).toContainText(text)
}

async function undo(page: Page): Promise<void> {
  await page.getByTestId('topic-undo').getByRole('button', { name: 'Undo' }).click()
}

/**
 * CRUD e2e: Topics (item 2), on the seeded two-market project, which starts
 * with no topic. One app for the whole area; each step builds on the last.
 */
export function topicsCrud(): void {
  test.describe.configure({ mode: 'serial' })
  let seeded: SeededApp

  test.beforeAll(async () => {
    seeded = await openTwoMarketApp('crud-topics')
  })

  test.afterAll(async () => {
    await seeded?.close()
  })

  test('creates an empty topic, which says it has no questions yet', async () => {
    const { page } = seeded
    // The List view is the flat topics grid these steps work on (Tree is the default).
    await openHash(page, '#/topics?view=list')
    await expect(page.getByText('No topics yet')).toBeVisible()
    await page.locator('.screen-header').getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: 'New empty topic' }).click()
    await expect(page).toHaveURL(/new=empty/)
    const form = page.getByRole('form', { name: 'New empty topic' })
    await form.getByRole('textbox').fill('Pricing questions')
    await form.getByRole('button', { name: 'Create topic' }).click()
    await toast(page, 'Created Pricing questions.')
    await expect(grid(page).getByText('Pricing questions', { exact: true })).toBeVisible()
    await expect(page).not.toHaveURL(/new=empty/)
    await shot(page, 'crud-topics-empty-topic')

    await chooseRowAction(page, grid(page), 'Pricing questions', 'Open')
    await expect(page.getByRole('heading', { name: 'No questions yet' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Check now' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Add questions' }).first()).toHaveAttribute(
      'href',
      /drawer=add-questions&target=/
    )
    await openHash(page, '#/topics?view=list')
    await expect(grid(page)).toBeVisible()
  })

  test('merge with one topic says it needs two and offers + New topic', async () => {
    const { page } = seeded
    await chooseRowAction(page, grid(page), 'Pricing questions', 'Merge into another topic…')
    const dialog = page.getByRole('dialog', { name: 'Merge into another topic' })
    await expect(dialog).toContainText('Merging needs two topics')
    await expect(dialog).toContainText('nothing to merge it into yet')
    // No dead Merge button: Close, and New topic instead.
    await expect(dialog.getByRole('button', { name: 'Merge topics' })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'New topic' }).click()
    await expect(dialog).toHaveCount(0)
    const form = page.getByRole('form', { name: 'New empty topic' })
    await expect(form).toBeVisible()
    await form.getByRole('button', { name: 'Cancel' }).click()
    await expect(form).toHaveCount(0)
  })

  test('renames in place: double-click, type, Enter', async () => {
    const { page } = seeded
    await grid(page).getByText('Pricing questions', { exact: true }).dblclick()
    const input = page.getByRole('textbox', { name: 'Rename Pricing questions' })
    await input.fill('Pricing and plans')
    await input.press('Enter')
    await toast(page, 'Renamed to Pricing and plans.')
    await expect(grid(page).getByText('Pricing and plans', { exact: true })).toBeVisible()
  })

  test('pauses and resumes checks, with the Paused chip', async () => {
    const { page } = seeded
    await chooseRowAction(page, grid(page), 'Pricing and plans', 'Pause checks')
    await toast(page, 'Paused checks for Pricing and plans.')
    await expect(grid(page).getByText('Paused', { exact: true })).toBeVisible()
    await chooseRowAction(page, grid(page), 'Pricing and plans', 'Resume checks')
    await toast(page, 'Resumed checks for Pricing and plans.')
    await expect(grid(page).getByText('Paused', { exact: true })).toHaveCount(0)
  })

  test('duplicates, and Undo removes the copy', async () => {
    const { page } = seeded
    await chooseRowAction(page, grid(page), 'Pricing and plans', 'Duplicate')
    await toast(page, 'Made Pricing and plans (copy).')
    const copy = grid(page).getByText('Pricing and plans (copy)', { exact: true })
    await expect(copy).toBeVisible()
    await undo(page)
    await toast(page, 'The copy is gone.')
    await expect(copy).toHaveCount(0)
  })

  test('Topic settings drawer: on the URL, Back and Forward', async () => {
    const { page } = seeded
    await chooseRowAction(page, grid(page), 'Pricing and plans', 'Edit topic…')
    const drawer = page.getByTestId('topic-settings-drawer')
    await expect(drawer).toBeVisible()
    await expect(page).toHaveURL(/drawer=topic-settings/)
    await expect(drawer.getByRole('textbox', { name: 'Topic name' })).toHaveValue(
      'Pricing and plans'
    )
    await drawerShots(page, 'crud-topic-settings')
    await page.goBack()
    await expect(drawer).toHaveCount(0)
    await page.goForward()
    await expect(drawer).toBeVisible()
    await drawer.getByRole('button', { name: 'Paused', exact: true }).click()
    await drawer.getByRole('button', { name: 'Save changes' }).click()
    await expect(drawer).toHaveCount(0)
    await toast(page, 'Saved Pricing and plans.')
    await expect(grid(page).getByText('Paused', { exact: true })).toBeVisible()
    await undo(page)
    await expect(grid(page).getByText('Paused', { exact: true })).toHaveCount(0)
  })

  test('bulk pause and delete every ticked topic, with Undo', async () => {
    const { page } = seeded
    // Two topics with questions aimed at two different pages (for "+n" below).
    await call(page, 'setup:pause', { paused: true })
    await call(page, 'pages:add', {
      projectId: PROJECT,
      url: PRICING_URL,
      markets: [],
      intervalDays: 14,
      samples: 1,
      promptCount: 5
    })
    await call(page, 'topics:createTopics', {
      projectId: PROJECT,
      topics: [
        {
          name: 'Crew alerts',
          situation: 'A field crew lead wants texts when jobs change.',
          questions: [{ text: 'how do I text my whole crew at once', stage: 'problem' }],
          targetUrl: SEEDED_URL
        },
        {
          name: 'Plan limits',
          situation: 'An office manager compares plans.',
          questions: [{ text: 'which texting plan has scheduled messages', stage: 'options' }],
          targetUrl: PRICING_URL
        }
      ]
    })
    await page.evaluate(() => window.dispatchEvent(new Event('citefox:topics-changed')))
    await expect(grid(page).getByText('Plan limits', { exact: true })).toBeVisible()

    await grid(page).getByRole('checkbox', { name: 'Select every row on this page' }).check()
    await page.getByRole('button', { name: 'Pause checks' }).click()
    await toast(page, 'Paused checks for 3 topics.')
    await expect(grid(page).getByText('Paused', { exact: true })).toHaveCount(3)

    await grid(page).getByRole('checkbox', { name: 'Select every row on this page' }).check()
    await page.getByRole('button', { name: 'More topic actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await toast(page, 'Deleted 3 topics.')
    await expect(page.getByText('No topics yet')).toBeVisible()
    await undo(page)
    await toast(page, 'They are back.')
    await expect(grid(page).getByText('Paused', { exact: true })).toHaveCount(3)
  })

  test('"+n" opens every target page of a topic, and the count matches', async () => {
    const { page } = seeded
    // A CiteFox AI page pick is a hint until confirmed, and a moved question then takes its new
    // topic's page. Confirm Plan limits' pricing page, as a person does, so it moves with it.
    const listed = (await call(page, 'questions:list', { projectId: PROJECT })) as {
      sources: readonly { id: string; name: string }[]
      rows: readonly { promptId: string; sourceId: string }[]
    }
    const planLimits = listed.sources.find((source) => source.name === 'Plan limits')
    expect(planLimits).toBeDefined()
    await call(page, 'topics:setTarget', {
      projectId: PROJECT,
      topicId: planLimits?.id,
      promptIds: listed.rows
        .filter((row) => row.sourceId === planLimits?.id)
        .map((row) => row.promptId)
    })
    await chooseRowAction(page, grid(page), 'Plan limits', 'Merge into another topic…')
    const dialog = page.getByRole('dialog', { name: 'Merge into another topic' })
    await dialog.getByRole('radio', { name: /Crew alerts/ }).check()
    await dialog.getByRole('button', { name: 'Merge topics' }).click()
    await expect(grid(page).getByText('Plan limits', { exact: true })).toHaveCount(0)
    const more = grid(page).getByRole('button', {
      name: '+1: show the other 1 target page of Crew alerts'
    })
    await expect(more).toHaveText('+1')
    await more.click()
    // The first page is in the cell already: the drawer lists the other one, as "+1" says.
    const drill = page.getByRole('dialog', { name: /^More target pages of Crew alerts/ })
    await expect(drill).toBeVisible()
    await expectDrawerRows(drill, 1)
    await drawerShots(page, 'crud-topic-targets')
    await page.keyboard.press('Escape')
    await expect(drill).toHaveCount(0)
  })

  test('a merge is undone from the toast; Check now on ticked topics opens the scope drawer', async () => {
    const { page } = seeded
    await chooseRowAction(page, grid(page), 'Crew alerts', 'Merge into another topic…')
    const dialog = page.getByRole('dialog', { name: 'Merge into another topic' })
    await dialog.getByRole('radio', { name: /Pricing and plans/ }).check()
    await dialog.getByRole('button', { name: 'Merge topics' }).click()
    await toast(page, 'Merged Crew alerts into Pricing and plans (2 questions moved).')
    await expect(grid(page).getByText('Crew alerts', { exact: true })).toHaveCount(0)
    await undo(page)
    await toast(page, 'Crew alerts is back.')
    await expect(grid(page).getByText('Crew alerts', { exact: true })).toBeVisible()
    await expect(
      grid(page).getByRole('button', { name: 'Show the 2 questions in Crew alerts' })
    ).toBeVisible()

    await grid(page).getByRole('checkbox', { name: 'Select every row on this page' }).check()
    // The bulk bar keeps its buttons on one line at the narrow window.
    const size = page.viewportSize()
    await page.setViewportSize({ width: 1134, height: 770 })
    const bar = page.locator('.ui-lg-bulk')
    await shot(page, 'crud-topics-bulk-1134')
    const middle = async (name: string): Promise<number> => {
      const box = await bar.getByRole('button', { name, exact: true }).boundingBox()
      return box ? box.y + box.height / 2 : Number.NaN
    }
    const line = await middle('Check now')
    for (const name of ['Pause checks', 'Merge into', 'More topic actions', 'Clear']) {
      expect(Math.abs((await middle(name)) - line), `${name} on the same line`).toBeLessThan(6)
    }
    if (size) await page.setViewportSize(size)
    await page.getByRole('button', { name: 'Check now', exact: true }).click()
    await expect(page).toHaveURL(/drawer=check-now/)
    await expect(page).toHaveURL(/check\.scope=topic/)
    const drawer = page.getByRole('dialog', { name: /Check now/ })
    await expect(drawer).toBeVisible()
    await drawerShots(page, 'crud-topics-check-now')
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
  })
}
