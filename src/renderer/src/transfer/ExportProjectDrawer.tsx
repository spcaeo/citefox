import { useState, type JSX } from 'react'
import { errorText } from '../components/errorText'
import {
  Drawer,
  DrawerFacts,
  DrawerGrid,
  DrawerMain,
  DrawerRail,
  DrawerSection,
  showUndo
} from '../ui'
import { transferClient, type TransferClient } from './client'
import { SectionCountTable } from './tables'
import { useLoaded } from './useLoaded'
import './transfer.css'

export const KEYCHAIN_LINE =
  "API keys stay in this Mac's keychain and are not included. Add them again on the new Mac."

export interface ExportProjectDrawerProps {
  projectId: string
  /** "Include stored check results" (`ep.results=1`). Off by default. */
  includeResults: boolean
  onIncludeResults: (value: boolean) => void
  onClose: () => void
  client?: TransferClient
}

/**
 * Export project (`?drawer=export-project&ep.project=<id>`): what the file will
 * hold, then the save dialog. One `.citefox-project.json` file carries the
 * project's settings and lists; stored check results only when ticked.
 */
export function ExportProjectDrawer({
  projectId,
  includeResults,
  onIncludeResults,
  onClose,
  client = transferClient()
}: ExportProjectDrawerProps): JSX.Element {
  const summary = useLoaded(
    projectId,
    () => client.projectSummary(projectId),
    'Could not read the project.'
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const project = summary.value

  async function save(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const result = await client.exportProject({ projectId, includeResults })
      if (result.ok) {
        showUndo({ message: `Saved ${result.filename}.`, effect: KEYCHAIN_LINE })
        onClose()
        return
      }
      if (!result.cancelled) setError(`${result.reason} ${result.nextStep}`)
    } catch (cause) {
      setError(errorText(cause, 'Could not export the project.'))
    } finally {
      setBusy(false)
    }
  }

  const lists = (project?.sections ?? []).filter((section) => section.section !== 'results')
  const sections =
    project && includeResults
      ? [
          ...lists,
          { section: 'results' as const, label: 'Stored check results', count: project.checkCount }
        ]
      : lists

  return (
    <Drawer
      id="export-project"
      title="Export project"
      subtitle={
        project ? `${project.name} · ${project.domain}` : 'One file to move a project to a new Mac'
      }
      testId="export-project-drawer"
      loading={summary.loading}
      busy={busy}
      closeDisabled={busy}
      onClose={onClose}
      {...(summary.error ? { error: { message: summary.error, onRetry: summary.reload } } : {})}
      footer={{
        summary: error ? (
          <span className="ui-drawer-error" role="alert">
            {error}
          </span>
        ) : (
          'Saves one .citefox-project.json file'
        ),
        primary: {
          label: 'Export project…',
          busy,
          disabled: busy || project === null,
          onClick: () => void save(),
          testId: 'export-project-save'
        }
      }}
    >
      <DrawerGrid>
        <DrawerMain>
          <DrawerSection title="What the file holds">
            <SectionCountTable sections={sections} label="What the file holds" />
          </DrawerSection>
          <DrawerSection title="Check results">
            <label className="tf-check">
              <input
                type="checkbox"
                checked={includeResults}
                onChange={(event) => onIncludeResults(event.target.checked)}
              />
              <span>
                Include stored check results
                <span className="tf-check-hint">
                  {project
                    ? `${project.checkCount.toLocaleString()} stored ${project.checkCount === 1 ? 'check' : 'checks'}. `
                    : ''}
                  Makes the file larger. Off: the new Mac starts with no check history.
                </span>
              </span>
            </label>
          </DrawerSection>
        </DrawerMain>
        <DrawerRail>
          <DrawerSection title="Project">
            {project ? (
              <DrawerFacts
                label="Project"
                items={[
                  { label: 'Name', value: project.name },
                  { label: 'Site', value: project.domain }
                ]}
              />
            ) : null}
          </DrawerSection>
          <DrawerSection title="API keys">
            <p className="tf-note">{KEYCHAIN_LINE}</p>
          </DrawerSection>
        </DrawerRail>
      </DrawerGrid>
    </Drawer>
  )
}
