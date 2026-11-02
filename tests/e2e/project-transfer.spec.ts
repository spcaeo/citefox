import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { installRawMarkdown } from './raw-hook'
import { openAllPages } from './nav-helpers'

/**
 * Moving to a new Mac: Projects › Export project… writes one
 * `.citefox-project.json`; Import project… previews it, imports it as a new
 * project and Undo deletes that project again. Settings › Data exports the app
 * settings with no key in them. Main's native dialogs are replaced in the main
 * process, so nothing opens: a save lands in a temp folder under the name main
 * proposed, an open returns the file the test points at.
 */
test('export a project, import it as new, undo it, and export app settings', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-transfer-'))
  const saveDir = await mkdtemp(path.join(os.tmpdir(), 'citefox-transfer-save-'))
  installRawMarkdown()
  const { seedFixtureProject } = await import('./fixture-project')
  await seedFixtureProject(dir)
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1440, height: 900 }
  })
  try {
    await openAllPages(page)
    await stubDialogs(app, saveDir)

    // ---- Export from the Projects row menu ----
    await go(page, '#/projects')
    await page.getByRole('button', { name: 'Actions for TextBolt' }).first().click()
    await page.getByRole('menuitem', { name: 'Export project…' }).click()
    const exportDrawer = page.getByTestId('export-project-drawer')
    await expect(exportDrawer).toBeVisible()
    await expect(page).toHaveURL(/drawer=export-project/)
    const results = exportDrawer.getByRole('checkbox', { name: /Include stored check results/ })
    await expect(results).not.toBeChecked()
    await expect(exportDrawer.getByText(/keychain and are not included/)).toBeVisible()
    await page.screenshot({ path: await e2eArtifact('project-transfer-export-1440.png') })
    await exportDrawer.getByTestId('export-project-save').click()
    await expect(exportDrawer).toBeHidden()

    const saved = (await readdir(saveDir)).filter((name) => name.endsWith('.citefox-project.json'))
    expect(saved).toHaveLength(1)
    const projectPath = path.join(saveDir, saved[0] ?? '')
    const file = JSON.parse(await readFile(projectPath, 'utf8')) as {
      format: string
      formatVersion: number
      includesResults: boolean
      project: { name: string; domain: string }
      tables: Record<string, unknown[]>
    }
    expect(file).toMatchObject({
      format: 'citefox-project',
      formatVersion: 1,
      includesResults: false,
      project: { name: 'TextBolt', domain: 'textbolt.com' }
    })
    expect(file.tables.pages?.length).toBe(1)
    expect(file.tables).not.toHaveProperty('runs')

    // ---- Import it as a new project ----
    await pointOpenAt(app, projectPath)
    await page.getByRole('button', { name: 'Projects actions' }).click()
    await page.getByRole('menuitem', { name: 'Import project…' }).click()
    const importDrawer = page.getByTestId('import-project-drawer')
    await expect(importDrawer).toBeVisible()
    await expect(page).toHaveURL(/drawer=import-project&ip\.file=/)
    const counts = importDrawer.getByTestId('import-counts')
    await expect(counts.locator('tr[data-section="pages"]')).toContainText('1')
    await expect(counts.locator('tr[data-section="settings"]')).toBeVisible()
    await expect(importDrawer.getByText('Not included', { exact: true })).toBeVisible()
    await expect(importDrawer.getByRole('radio', { name: /Import as a new project/ })).toBeChecked()
    await expect(importDrawer.getByRole('radio', { name: /Replace TextBolt/ })).toBeVisible()
    await page.screenshot({ path: await e2eArtifact('project-transfer-import-1440.png') })
    await page.setViewportSize({ width: 1134, height: 820 })
    await page.screenshot({ path: await e2eArtifact('project-transfer-import-1134.png') })

    await importDrawer.getByTestId('import-project-run').click()
    const result = importDrawer.getByTestId('import-result')
    await expect(result).toBeVisible()
    await expect(result.locator('tr[data-section="pages"]')).toContainText('1')
    await expect(importDrawer.getByText('Imported as TextBolt (imported)')).toBeVisible()
    const list = page.getByRole('main')
    await expect(list.getByRole('link', { name: 'Open TextBolt (imported)' })).toBeVisible()
    await page.screenshot({ path: await e2eArtifact('project-transfer-result.png') })

    // ---- Undo deletes the imported project ----
    await importDrawer.getByTestId('import-project-undo').click()
    await expect(importDrawer).toBeHidden()
    await expect(page.getByText('Removed TextBolt (imported).')).toBeVisible()
    await expect(list.getByRole('link', { name: 'Open TextBolt (imported)' })).toHaveCount(0)
    await expect(list.getByRole('link', { name: 'Open TextBolt', exact: true })).toBeVisible()

    // ---- App settings: no key, token or webhook in the file ----
    await go(page, '#/settings')
    await page.getByRole('tab', { name: 'Data & about', exact: true }).click()
    await expect(page.getByText('Keys and passwords stay in the keychain.')).toBeVisible()
    await page.getByTestId('settings-export').click()
    await expect
      .poll(async () =>
        (await readdir(saveDir)).filter((name) => name.endsWith('.citefox-settings.json'))
      )
      .toHaveLength(1)
    const settingsName = (await readdir(saveDir)).find((name) =>
      name.endsWith('.citefox-settings.json')
    )
    const settingsText = await readFile(path.join(saveDir, settingsName ?? ''), 'utf8')
    const settings = JSON.parse(settingsText) as {
      format: string
      note: string
      values: Record<string, unknown>
    }
    expect(settings.format).toBe('citefox-settings')
    expect(settings.note).toMatch(/keychain/)
    expect(Object.keys(settings.values).join(' ')).not.toMatch(/key|secret|token|password|webhook/i)
    expect(settingsText).not.toMatch(/sk-ant-|hooks\.slack\.com|xox[bp]-/)
    await page.screenshot({ path: await e2eArtifact('project-transfer-settings-data.png') })

    // ---- Import the settings file: a preview per setting; nothing differs here ----
    await pointOpenAt(app, path.join(saveDir, settingsName ?? ''))
    await page.getByTestId('settings-import').click()
    const settingsDrawer = page.getByTestId('import-settings-drawer')
    await expect(settingsDrawer).toBeVisible()
    await expect(page).toHaveURL(/drawer=import-settings&is\.file=/)
    await expect(settingsDrawer.getByTestId('settings-fields')).toContainText('Your name')
    await expect(settingsDrawer.getByText('Every setting is already the same')).toBeVisible()
    await expect(settingsDrawer.getByTestId('import-settings-apply')).toBeDisabled()
    await page.screenshot({ path: await e2eArtifact('project-transfer-settings-import.png') })
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
    await rm(saveDir, { recursive: true, force: true })
  }
})

async function go(page: Page, hash: string): Promise<void> {
  await page.evaluate((next) => {
    window.location.hash = next
  }, hash)
}

/** Saves land in `folder` under the name main proposed; opens return the file set by pointOpenAt. */
async function stubDialogs(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate(({ dialog }, saveFolder: string) => {
    const target = global as typeof globalThis & { __citefoxOpen?: string }
    const save = async (...args: unknown[]): Promise<{ canceled: boolean; filePath: string }> => {
      const options = args.find(
        (arg): arg is { defaultPath?: string } =>
          typeof arg === 'object' && arg !== null && 'defaultPath' in arg
      )
      const name = (options?.defaultPath ?? 'export.json').split(/[\\/]/).pop() ?? 'export.json'
      return { canceled: false, filePath: `${saveFolder}/${name}` }
    }
    const open = async (): Promise<{ canceled: boolean; filePaths: string[] }> => ({
      canceled: target.__citefoxOpen === undefined,
      filePaths: target.__citefoxOpen === undefined ? [] : [target.__citefoxOpen]
    })
    dialog.showSaveDialog = save as unknown as typeof dialog.showSaveDialog
    dialog.showOpenDialog = open as unknown as typeof dialog.showOpenDialog
  }, folder)
}

async function pointOpenAt(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate((_electron, file: string) => {
    ;(global as typeof globalThis & { __citefoxOpen?: string }).__citefoxOpen = file
  }, filePath)
}
