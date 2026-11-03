import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readStoredZip } from '../../src/main/export/zip'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { installRawMarkdown } from './raw-hook'
import { openAllPages } from './nav-helpers'

/**
 * Settings → Data (Mockups/Settings.dc.html): "Export all data" writes one zip
 * through main's save dialog, and the reveal button shows the data folder.
 * Both Electron calls are replaced in the main process, so nothing opens.
 */
test('Settings exports all data as a zip and shows the data folder', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-settings-data-'))
  const saveDir = await mkdtemp(path.join(os.tmpdir(), 'citefox-settings-save-'))
  installRawMarkdown()
  const { seedFixtureProject } = await import('./fixture-project')
  await seedFixtureProject(dir)
  const { app, page } = await launchCiteFox({ userDataDir: dir })
  try {
    await openAllPages(page)
    const zipPath = path.join(saveDir, 'citefox-backup.zip')
    await stubShell(app, zipPath)

    await page.evaluate(() => {
      window.location.hash = '#/settings'
    })
    await page.getByRole('tab', { name: 'Data & about', exact: true }).click()
    const data = page.getByRole('region', { name: 'Data' })
    await expect(data).toBeVisible()
    await data.scrollIntoViewIfNeeded()
    await data.getByRole('button', { name: 'Export all data (JSON)' }).click()
    await expect(data.getByRole('status')).toContainText('Saved citefox-backup.zip')
    await expect(data.getByRole('status')).toContainText('1 project')
    await page.screenshot({ path: await e2eArtifact('settings-data.png'), fullPage: true })

    const entries = readStoredZip(await readFile(zipPath))
    const names = entries.map((entry) => entry.name).sort()
    expect(names).toEqual(['citefox-data.json', 'projects/textbolt.citefox.json', 'settings.json'])
    const project = JSON.parse(
      entries.find((entry) => entry.name === 'projects/textbolt.citefox.json')?.data.toString() ??
        '{}'
    ) as { format: string; schemaVersion: number }
    expect(project).toMatchObject({ format: 'citefox-export', schemaVersion: 2 })

    // The reveal button says what the system calls it (Show in Finder on a Mac).
    await data
      .getByRole('button', { name: /^(Show in Finder|Show in Explorer|Open data folder)$/ })
      .click()
    await expect
      .poll(() =>
        app.evaluate(
          () => (global as typeof globalThis & { __citefoxShown?: string[] }).__citefoxShown
        )
      )
      // macOS temp folders sit behind a link (/var → /private/var); main shows the real one.
      // Windows may keep the short 8.3 name (RUNNER~1) that the temp folder was given.
      .toEqual([process.platform === 'win32' ? dir : await realpath(dir)])
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
    await rm(saveDir, { recursive: true, force: true })
  }
})

async function stubShell(app: ElectronApplication, zipPath: string): Promise<void> {
  await app.evaluate(({ dialog, shell }, filePath: string) => {
    const target = global as typeof globalThis & { __citefoxShown?: string[] }
    target.__citefoxShown = []
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath
    })) as unknown as typeof dialog.showSaveDialog
    shell.showItemInFolder = (folder: string) => {
      target.__citefoxShown?.push(folder)
    }
  }, zipPath)
}
