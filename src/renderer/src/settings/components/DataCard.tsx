import { useState, type JSX } from 'react'
import { platformFromUserAgent, type DesktopPlatform } from '../../alerts/model'
import type { OnboardingClient } from '../../onboarding/client'
import { exportHash } from '../../shell/routes'
import { Button, Panel, PathText, ToolButton, ToolGroup } from '../../ui'
import { dataFolderLabel } from '../utils/dataFolder'
import { MoveToNewMac } from './MoveToNewMac'

type DataCardProps = {
  client: Pick<OnboardingClient, 'exportAllData' | 'openDataFolder'>
  dataDirectory: string
}

type Note = { tone: 'ok' | 'error'; text: string } | null

function currentPlatform(): DesktopPlatform {
  return platformFromUserAgent(typeof navigator === 'undefined' ? '' : navigator.userAgent)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/**
 * Settings › Data & about: where the data lives, show it in the file manager,
 * export everything as one zip, and move to a new Mac. Main opens the save dialog and the
 * folder; this card never sends a path.
 */
export function DataCard({ client, dataDirectory }: DataCardProps): JSX.Element {
  const [busy, setBusy] = useState<'export' | 'reveal' | null>(null)
  const [note, setNote] = useState<Note>(null)

  async function exportAll(): Promise<void> {
    setBusy('export')
    setNote(null)
    try {
      const result = await client.exportAllData()
      if (result.ok) {
        const skipped = result.projects.filter((project) => project.file === null)
        const saved = `Saved ${result.filename} (${formatBytes(result.bytes)}, ${plural(
          result.projects.length - skipped.length,
          'project'
        )}).`
        const missing =
          skipped.length > 0
            ? ` Not included: ${skipped.map((project) => project.name).join(', ')}. ${
                skipped[0]?.error ?? ''
              }`
            : ''
        setNote({ tone: skipped.length > 0 ? 'error' : 'ok', text: `${saved}${missing}`.trim() })
      } else if (!result.cancelled) {
        setNote({ tone: 'error', text: `${result.reason} ${result.nextStep}` })
      }
    } catch {
      setNote({ tone: 'error', text: 'CiteFox could not export your data. Try again.' })
    } finally {
      setBusy(null)
    }
  }

  async function reveal(): Promise<void> {
    setBusy('reveal')
    setNote(null)
    try {
      const result = await client.openDataFolder()
      if (!result.ok) setNote({ tone: 'error', text: `${result.reason} ${result.nextStep}` })
    } catch {
      setNote({ tone: 'error', text: 'Could not open the folder. Open it from your file manager.' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="stg-grid">
      <Panel title="Data" className="stg-span-6">
        <div className="field">
          <span className="field-label">App data folder</span>
          <PathText path={dataDirectory} onReveal={() => client.openDataFolder()} />
        </div>
        <div className="inline inline-start">
          <Button disabled={busy !== null} onClick={() => void reveal()}>
            {dataFolderLabel(currentPlatform())}
          </Button>
          <ToolGroup className="stg-card-tools">
            <ToolButton
              kind="download"
              label="Export all data (JSON)"
              disabled={busy !== null}
              busy={busy === 'export'}
              onClick={() => void exportAll()}
            />
          </ToolGroup>
        </div>
        <p className="hint" id="data-export-hint">
          Every project and your app settings in one zip. Keys and passwords stay in the keychain.
          For a client report: <a href={exportHash()}>Export report (HTML)</a>.
        </p>
        <p
          role="status"
          aria-live="polite"
          className={note?.tone === 'error' ? 'data-note data-note-error' : 'data-note'}
        >
          {note?.text ?? ''}
        </p>
      </Panel>
      <MoveToNewMac />
    </div>
  )
}
