import { useState, type JSX } from 'react'
import type { ProjectImportMode, ProjectImportPreview, ProjectImportResult } from '@shared/ipc'
import { errorText } from '../components/errorText'
import {
  Confirm,
  Drawer,
  DrawerFacts,
  DrawerGrid,
  type DrawerFooterSpec,
  DrawerSection,
  showUndo
} from '../ui'
import { startProjectImport } from './actions'
import { transferClient, type TransferClient } from './client'
import { KEYCHAIN_LINE } from './ExportProjectDrawer'
import { exportedOn } from './format'
import { ImportResultTable, SectionCountTable } from './tables'
import { useLoaded } from './useLoaded'
import './transfer.css'

export interface ImportProjectDrawerProps {
  /** The picked file (`ip.file`): an opaque token main holds the file under. */
  token: string
  /** `ip.mode`: new (default) or replace. */
  mode: ProjectImportMode
  /** `ip.target`: the same-site project Replace writes into. */
  targetId: string | null
  onChoice: (mode: ProjectImportMode, targetId: string | null) => void
  onClose: () => void
  /** A project was added, changed or removed: the Projects list reads again. */
  onProjectsChanged: () => void
  client?: TransferClient
}

function Facts({ preview }: { preview: ProjectImportPreview }): JSX.Element {
  return (
    <DrawerFacts
      label="About the file"
      items={[
        { label: 'File', value: preview.filename },
        { label: 'Project', value: preview.project.name },
        { label: 'Site', value: preview.project.domain },
        { label: 'Exported', value: exportedOn(preview.exportedAt) },
        { label: 'Made with', value: `CiteFox ${preview.appVersion}` },
        {
          label: 'File version',
          value: `${preview.formatVersion} · database ${preview.schemaVersion}`
        },
        {
          label: 'Check results',
          value: preview.includesResults ? 'Included' : 'Not included'
        }
      ]}
    />
  )
}

/**
 * Import project (`?drawer=import-project&ip.file=<token>`): what the picked
 * file holds, how to import it (as a new project, or into the project already
 * here for the same site), then what each part did. Import as new can be
 * undone: Undo deletes the project it made.
 */
export function ImportProjectDrawer({
  token,
  mode,
  targetId,
  onChoice,
  onClose,
  onProjectsChanged,
  client = transferClient()
}: ImportProjectDrawerProps): JSX.Element {
  const loaded = useLoaded(token, () => client.projectPreview(token), 'Could not read the file.')
  const [busy, setBusy] = useState<'import' | 'undo' | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const preview = loaded.value
  const result = preview?.result ?? null
  const target =
    mode === 'replace'
      ? (preview?.sameSite.find((project) => project.projectId === targetId) ?? null)
      : null

  async function runImport(): Promise<void> {
    if (preview === null) return
    setConfirming(false)
    setBusy('import')
    setError(null)
    try {
      const done = await client.importProject({
        token,
        mode: target ? 'replace' : 'new',
        replaceProjectId: target?.projectId ?? null
      })
      loaded.set({ ...preview, result: done })
      onProjectsChanged()
    } catch (cause) {
      setError(errorText(cause, 'Could not import the project.'))
    } finally {
      setBusy(null)
    }
  }

  async function undo(done: ProjectImportResult): Promise<void> {
    if (preview === null) return
    setBusy('undo')
    setError(null)
    try {
      await client.deleteProject({ projectId: done.projectId, confirmName: done.projectName })
      loaded.set({ ...preview, result: null })
      onProjectsChanged()
      showUndo({ message: `Removed ${done.projectName}.`, effect: 'The import was undone.' })
      onClose()
    } catch (cause) {
      setError(errorText(cause, 'Could not undo the import.'))
    } finally {
      setBusy(null)
    }
  }

  const summary = error ? (
    <span className="ui-drawer-error" role="alert">
      {error}
    </span>
  ) : result ? (
    result.mode === 'new' ? (
      `Imported as ${result.projectName}`
    ) : (
      `Merged into ${result.projectName}`
    )
  ) : target ? (
    `Replaces settings in ${target.name} · nothing is removed`
  ) : (
    'Adds a new project · Undo removes it'
  )

  const footer: DrawerFooterSpec = loaded.error
    ? { cancel: 'Close' }
    : result
      ? {
          summary,
          cancel: 'Close',
          ...(result.undoable
            ? {
                secondary: {
                  label: 'Undo import',
                  busy: busy === 'undo',
                  disabled: busy !== null,
                  onClick: () => void undo(result),
                  testId: 'import-project-undo'
                }
              }
            : {})
        }
      : {
          summary,
          secondary: {
            label: 'Choose another file…',
            disabled: busy !== null,
            onClick: () => void startProjectImport(client)
          },
          primary: {
            label: target ? 'Replace project' : 'Import project',
            busy: busy === 'import',
            disabled: busy !== null || preview === null,
            onClick: () => (target ? setConfirming(true) : void runImport()),
            testId: 'import-project-run'
          }
        }

  return (
    <Drawer
      id="import-project"
      title={result ? 'Project imported' : 'Import project'}
      subtitle={preview ? `${preview.project.name} · ${preview.project.domain}` : undefined}
      testId="import-project-drawer"
      loading={loaded.loading}
      busy={busy !== null}
      closeDisabled={busy !== null}
      onClose={onClose}
      {...(loaded.error
        ? {
            error: {
              message: loaded.error,
              onRetry: () => void startProjectImport(client)
            }
          }
        : {})}
      footer={footer}
    >
      {preview ? (
        <DrawerGrid>
          <DrawerSection title="About the file" span={8}>
            <Facts preview={preview} />
          </DrawerSection>
          <DrawerSection title="API keys" span={4}>
            <p className="tf-note">{KEYCHAIN_LINE}</p>
          </DrawerSection>
          {result ? (
            <DrawerSection
              title="What was imported"
              description="Skipped rows were already in the project. Failed rows say why."
            >
              <ImportResultTable sections={result.sections} />
            </DrawerSection>
          ) : (
            <>
              <DrawerSection title="What the file holds" span={6}>
                <SectionCountTable
                  sections={preview.sections}
                  label="What the file holds"
                  testId="import-counts"
                />
              </DrawerSection>
              <DrawerSection title="How to import" span={6}>
                <div className="tf-ways" role="radiogroup" aria-label="How to import">
                  <label className={`tf-way${target ? '' : ' on'}`}>
                    <input
                      type="radio"
                      name="import-mode"
                      checked={target === null}
                      onChange={() => onChoice('new', null)}
                    />
                    <span>
                      Import as a new project
                      <span className="tf-check-hint">
                        Adds it next to your projects. Undo removes it.
                      </span>
                    </span>
                  </label>
                  {preview.sameSite.map((project) => (
                    <label
                      key={project.projectId}
                      className={`tf-way${target?.projectId === project.projectId ? ' on' : ''}`}
                    >
                      <input
                        type="radio"
                        name="import-mode"
                        checked={target?.projectId === project.projectId}
                        onChange={() => onChoice('replace', project.projectId)}
                      />
                      <span>
                        Replace {project.name}
                        <span className="tf-check-hint">
                          Same site. Its settings are replaced; lists are merged and nothing is
                          removed. Duplicates are skipped.
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </DrawerSection>
            </>
          )}
        </DrawerGrid>
      ) : null}
      {confirming && target ? (
        <Confirm
          title={`Replace ${target.name}?`}
          body="Settings from the file replace this project's. Pages, questions and the other lists are merged: nothing is removed. This cannot be undone."
          confirmLabel="Replace project"
          onConfirm={() => void runImport()}
          onCancel={() => setConfirming(false)}
          testId="import-project-confirm"
        />
      ) : null}
    </Drawer>
  )
}
