import type { TransferMenuCommand } from '@shared/ipc'
import { errorText } from '../components/errorText'
import { openDrawer } from '../shell/drawers'
import { showUndo } from '../ui'
import { transferClient, type TransferClient } from './client'

/**
 * The four ways in (Projects, Settings › Data, the File menu): each opens the
 * same drawer or runs the same export, so there is one path per task.
 */

/** Opens Export project for one project. */
export function openProjectExport(projectId: string): void {
  openDrawer('export-project', { 'ep.project': projectId })
}

function report(reason: string, nextStep: string): void {
  showUndo({ message: reason, effect: nextStep })
}

/** The open dialog, then the import drawer with the file's preview. */
export async function startProjectImport(client: TransferClient = transferClient()): Promise<void> {
  try {
    const picked = await client.pickProject()
    if (picked.ok) openDrawer('import-project', { 'ip.file': picked.token })
    else if (!picked.cancelled) report(picked.reason, picked.nextStep)
  } catch (cause) {
    report(errorText(cause, 'Could not open the file.'), 'Try again.')
  }
}

export async function startSettingsImport(
  client: TransferClient = transferClient()
): Promise<void> {
  try {
    const picked = await client.pickSettings()
    if (picked.ok) openDrawer('import-settings', { 'is.file': picked.token })
    else if (!picked.cancelled) report(picked.reason, picked.nextStep)
  } catch (cause) {
    report(errorText(cause, 'Could not open the file.'), 'Try again.')
  }
}

/** The save dialog, then a toast with what was saved. Returns the line it showed. */
export async function exportSettingsNow(
  client: TransferClient = transferClient()
): Promise<string | null> {
  try {
    const result = await client.exportSettings()
    if (result.ok) {
      const line = `Saved ${result.filename}.`
      showUndo({
        message: line,
        effect: "API keys stay in this Mac's keychain and are not included."
      })
      return line
    }
    if (!result.cancelled) report(result.reason, result.nextStep)
    return null
  } catch (cause) {
    report(errorText(cause, 'Could not export the settings.'), 'Try again.')
    return null
  }
}

/** File menu commands. Export project needs a project; with none open it says so. */
export function runMenuCommand(
  command: TransferMenuCommand,
  activeProjectId: string | null,
  client: TransferClient = transferClient()
): void {
  if (command === 'export-project') {
    if (activeProjectId === null)
      report('Open a project first.', 'Then choose Export Project again.')
    else openProjectExport(activeProjectId)
  } else if (command === 'import-project') {
    void startProjectImport(client)
  } else if (command === 'export-settings') {
    void exportSettingsNow(client)
  } else {
    void startSettingsImport(client)
  }
}
