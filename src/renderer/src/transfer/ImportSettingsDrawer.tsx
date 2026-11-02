import { useState, type JSX } from 'react'
import { errorText } from '../components/errorText'
import { Drawer, DrawerFacts, DrawerGrid, DrawerSection } from '../ui'
import { startSettingsImport } from './actions'
import { transferClient, type TransferClient } from './client'
import { KEYCHAIN_LINE } from './ExportProjectDrawer'
import { exportedOn } from './format'
import { SettingsFieldTable, SettingsResultTable } from './tables'
import { useLoaded } from './useLoaded'
import './transfer.css'

export interface ImportSettingsDrawerProps {
  /** The picked file (`is.file`): an opaque token. */
  token: string
  onClose: () => void
  /** Settings changed: the shell reads them again (theme, defaults). */
  onSettingsChanged: () => void
  client?: TransferClient
}

/**
 * Import app settings (`?drawer=import-settings&is.file=<token>`): each setting
 * on this Mac next to the file's, then what applying did to each one. Keys are
 * never in the file, so none are changed.
 */
export function ImportSettingsDrawer({
  token,
  onClose,
  onSettingsChanged,
  client = transferClient()
}: ImportSettingsDrawerProps): JSX.Element {
  const loaded = useLoaded(token, () => client.settingsPreview(token), 'Could not read the file.')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const preview = loaded.value
  const result = preview?.result ?? null
  const changed = preview?.fields.filter((field) => field.changed).length ?? 0

  async function apply(): Promise<void> {
    if (preview === null) return
    setBusy(true)
    setError(null)
    try {
      const applied = await client.applySettings(token)
      loaded.set({ ...preview, result: applied })
      onSettingsChanged()
    } catch (cause) {
      setError(errorText(cause, 'Could not apply the settings.'))
    } finally {
      setBusy(false)
    }
  }

  const appliedCount = result?.filter((field) => field.outcome === 'applied').length ?? 0
  const failedCount = result?.filter((field) => field.outcome === 'failed').length ?? 0
  const summary = error ? (
    <span className="ui-drawer-error" role="alert">
      {error}
    </span>
  ) : result ? (
    `${appliedCount} applied${failedCount > 0 ? ` · ${failedCount} not applied` : ''}`
  ) : changed === 0 ? (
    'Every setting is already the same'
  ) : (
    `${changed} ${changed === 1 ? 'setting changes' : 'settings change'}`
  )

  return (
    <Drawer
      id="import-settings"
      title={result ? 'App settings imported' : 'Import app settings'}
      subtitle={preview?.filename}
      testId="import-settings-drawer"
      loading={loaded.loading}
      busy={busy}
      closeDisabled={busy}
      onClose={onClose}
      {...(loaded.error
        ? { error: { message: loaded.error, onRetry: () => void startSettingsImport(client) } }
        : {})}
      footer={
        result
          ? { summary, cancel: 'Close' }
          : {
              summary,
              primary: {
                label:
                  changed === 0
                    ? 'Apply changes'
                    : changed === 1
                      ? 'Apply 1 change'
                      : `Apply ${changed} changes`,
                busy,
                disabled: busy || changed === 0,
                onClick: () => void apply(),
                testId: 'import-settings-apply'
              }
            }
      }
    >
      {preview ? (
        <DrawerGrid>
          <DrawerSection title="About the file" span={8}>
            <DrawerFacts
              label="About the file"
              items={[
                { label: 'File', value: preview.filename },
                { label: 'Made with', value: `CiteFox ${preview.appVersion}` },
                { label: 'Exported', value: exportedOn(preview.exportedAt) }
              ]}
            />
          </DrawerSection>
          <DrawerSection title="API keys" span={4}>
            <p className="tf-note">{KEYCHAIN_LINE}</p>
          </DrawerSection>
          {result ? (
            <DrawerSection title="What was applied">
              <SettingsResultTable results={result} />
            </DrawerSection>
          ) : (
            <DrawerSection
              title="Settings in the file"
              description="Highlighted rows change when you apply."
            >
              <SettingsFieldTable fields={preview.fields} />
            </DrawerSection>
          )}
        </DrawerGrid>
      ) : null}
    </Drawer>
  )
}
