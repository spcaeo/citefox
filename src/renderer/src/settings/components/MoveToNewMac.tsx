import { useState, type JSX } from 'react'
import { navigateHash, sectionHash } from '../../shell/routes'
import { exportSettingsNow, startProjectImport, startSettingsImport } from '../../transfer/actions'
import type { TransferClient } from '../../transfer/client'
import { Button, IconButton, Panel, SectionMenu, ToolGroup } from '../../ui'
import '../../transfer/transfer.css'

/**
 * Settings › Data & about: move to a new Mac. App settings go in one file and come back
 * through a preview; a project moves as its own file (Projects › row menu ›
 * Export project…). Keys never leave the keychain.
 */
export function MoveToNewMac({ client }: { client?: TransferClient }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  async function exportSettings(): Promise<void> {
    setBusy(true)
    setSaved(null)
    try {
      setSaved(await exportSettingsNow(client))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Move to a new Mac" className="stg-span-6">
      <div className="tf-move-actions">
        <Button
          busy={busy}
          disabled={busy}
          onClick={() => void exportSettings()}
          data-testid="settings-export"
        >
          Export app settings…
        </Button>
        <ToolGroup className="stg-card-tools">
          <IconButton
            tip
            icon="upload"
            label="Import app settings…"
            onClick={() => void startSettingsImport(client)}
            data-testid="settings-import"
          />
          <SectionMenu
            label="More ways to move"
            items={[
              {
                id: 'import-project',
                label: 'Import project…',
                onSelect: () => void startProjectImport(client)
              },
              {
                id: 'export-project',
                label: 'Export a project from Projects',
                onSelect: () => navigateHash(sectionHash('projects'))
              }
            ]}
          />
        </ToolGroup>
      </div>
      <p role="status" aria-live="polite" className="data-note">
        {saved ?? ''}
      </p>
    </Panel>
  )
}
