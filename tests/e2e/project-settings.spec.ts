import { expect, test, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expectMainAccessible, openHash, openTwoMarketApp } from './screens-app'
import { e2eArtifactsDir } from './artifacts'

/** The lead's screenshot folder for this branch (1280×900 shots). */
const SHOTS =
  process.env.CITEFOX_W4_SHOTS ?? path.join(e2eArtifactsDir(), 'screenshots', 'projects')

async function shoot(page: Page, name: string, section?: Locator): Promise<void> {
  mkdirSync(SHOTS, { recursive: true })
  if (section) await section.scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(SHOTS, `project-settings-${name}.png`) })
}

/** Opens a settings tab and returns its section card. */
async function region(page: Page, name: string): Promise<Locator> {
  await page.getByRole('tab', { name, exact: true }).click()
  const found = page.getByRole('region', { name, exact: true })
  await expect(found).toBeVisible()
  return found
}

async function openSettings(page: Page): Promise<void> {
  await openHash(page, '#/project-settings')
  await expect(page.getByRole('heading', { level: 1, name: 'Project settings' })).toBeVisible()
  await expect(page.getByRole('tablist', { name: 'Project settings sections' })).toBeVisible()
  await region(page, 'General')
}

test('project settings save caps, competitors, client, duplicate, archive, and delete on real IPC', async () => {
  test.setTimeout(180_000)
  const { app, page, close } = await openTwoMarketApp('project-settings')
  const exportPath = path.join(os.tmpdir(), `citefox-project-export-${Date.now()}.json`)
  try {
    await openSettings(page)
    await shoot(page, 'general')
    await expectMainAccessible(page)

    // Searches & cost: a cap and the 10%-over rule survive a reload.
    const searches = await region(page, 'Searches & cost')
    await searches.getByLabel('Monthly cap for TextBolt').fill('500')
    await searches.getByLabel(/Allow 10% over/).check()
    await searches.getByRole('button', { name: 'Save searches' }).click()
    await expect(searches.getByText('Searches saved.')).toBeVisible()
    await shoot(page, 'searches', searches)
    await page.reload()
    const reloaded = await region(page, 'Searches & cost')
    await expect(reloaded.getByLabel('Monthly cap for TextBolt')).toHaveValue('500')
    await expect(reloaded.getByLabel(/Allow 10% over/)).toBeChecked()
    await expect(reloaded.getByText('Up to 550 this month')).toBeVisible()

    // Find competitors from the recorded AI Overviews, then add one. The seed lists both
    // cited competitors, so twilio.com is taken off the list first.
    await page.evaluate(async () => {
      const api = (
        globalThis as typeof globalThis & {
          citefox: import('@shared/ipc').CiteFoxApi
        }
      ).citefox
      await api['projects:update']({ projectId: 'proj-1', competitors: ['simpletexting.com'] })
    })
    await page.reload()
    const general = await region(page, 'General')
    await general.getByRole('button', { name: 'Find competitors from AI Overviews' }).click()
    const found = general.getByRole('region', { name: 'Competitor suggestions' })
    await expect(found.getByText(/overviews? read/)).toBeVisible()
    const addButtons = found.getByRole('button', { name: /^Add .+ as a competitor$/ })
    await expect(addButtons.first()).toBeVisible()
    const label = (await addButtons.first().getAttribute('aria-label')) ?? ''
    const domain = label.replace(/^Add /, '').replace(/ as a competitor$/, '')
    await addButtons.first().click()
    await expect(found.locator('li', { hasText: domain }).getByText('On your list')).toBeVisible()
    await shoot(page, 'competitors', found)
    const competitors = await page.evaluate(async () => {
      const api = (
        globalThis as typeof globalThis & {
          citefox: import('@shared/ipc').CiteFoxApi
        }
      ).citefox
      return (await api['projects:get']({ projectId: 'proj-1' })).competitors
    })
    expect(competitors).toContain(domain)

    // Client project with a client name.
    await general.getByRole('switch', { name: 'This is a client project' }).click()
    await general.getByLabel('Client name').fill('TextBolt Inc.')
    await general.getByRole('button', { name: 'Save general settings' }).click()
    await expect(general.getByText('General settings saved.')).toBeVisible()
    await expect(
      (await region(page, 'CiteFox AI')).getByText(/client project running on Claude Code/)
    ).toBeVisible()

    // Export the project as JSON through the save dialog.
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath
      })) as typeof dialog.showSaveDialog
    }, exportPath)
    const data = await region(page, 'Data')
    await data.getByRole('button', { name: 'Export project' }).click()
    await expect(data.getByText(/Exported TextBolt as JSON/)).toBeVisible()
    expect(existsSync(exportPath)).toBe(true)
    const exported = JSON.parse(readFileSync(exportPath, 'utf8')) as { project: { name: string } }
    expect(exported.project.name).toBe('TextBolt')
    expect(readFileSync(exportPath, 'utf8')).not.toContain('fixture-serpapi-secret')

    // Duplicate, archive and restore the original.
    await data.getByRole('button', { name: 'Duplicate project' }).click()
    await expect(data.getByText(/Created TextBolt \(copy\)/)).toBeVisible()
    await data.getByRole('button', { name: 'Archive project' }).click()
    await expect(
      data.getByText(/checks stopped and it.s hidden from the project switcher/)
    ).toBeVisible()
    await shoot(page, 'archived', data)
    await data.getByRole('button', { name: 'Restore project' }).click()
    await expect(data.getByRole('button', { name: 'Archive project' })).toBeVisible()

    // Switch to the duplicate and delete it by typing its name.
    await page.getByRole('button', { name: /^Switch project/ }).click()
    await page
      .getByRole('group', { name: 'Projects' })
      .getByRole('button', { name: /TextBolt \(copy\)/ })
      .click()
    await openSettings(page)
    await expect((await region(page, 'General')).getByLabel('Project name')).toHaveValue(
      'TextBolt (copy)'
    )
    const copyData = await region(page, 'Data')
    await copyData.getByRole('button', { name: 'Delete project…' }).click()
    const confirm = copyData.getByRole('button', { name: 'Delete TextBolt (copy) for good' })
    await copyData.getByLabel(/to confirm/).fill('TextBolt')
    await expect(confirm).toBeDisabled()
    await copyData.getByLabel(/to confirm/).fill('TextBolt (copy)')
    await expect(confirm).toBeEnabled()
    await shoot(page, 'delete', copyData)
    await confirm.click()
    await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible()
    const remaining = await page.evaluate(async () => {
      const api = (
        globalThis as typeof globalThis & {
          citefox: import('@shared/ipc').CiteFoxApi
        }
      ).citefox
      return (await api['projects:list']()).projects.map((project) => project.name)
    })
    expect(remaining).toEqual(['TextBolt'])
  } finally {
    rmSync(exportPath, { force: true })
    await close()
  }
})
