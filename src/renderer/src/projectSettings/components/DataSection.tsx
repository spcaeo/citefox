import { useId, useState, type JSX } from 'react'
import { Button, PathText, ToolButton, ToolGroup } from '../../ui'
import { projectExportRequest } from '../../admin/client'
import { pagesHash, sectionHash } from '../../shell/routes'
import { useSave } from '../hooks/useSave'
import type { SectionProps } from '../types'
import { fileName, formatBytes, plural } from '../utils/model'
import { SaveStatus, Section } from './bits'

/** FR-10.8. The database file, Export, Duplicate, Archive or Restore, and Delete. */
export function DataSection({
  view,
  admin,
  client,
  refresh,
  onDeleted
}: SectionProps & { onDeleted: (activeProjectId: string | null) => Promise<void> }): JSX.Element {
  const base = useId()
  const project = view.project
  const archived = project.status === 'archived'
  const file = fileName(view.database.path)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const action = useSave()
  const removal = useSave()

  async function exportProject(): Promise<void> {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    await action.run(async () => {
      const result = await admin.exportProject(
        projectExportRequest(
          project.id,
          view.markets.map((market) => market.id),
          zone
        )
      )
      if (!result.ok) {
        throw new Error(result.nextStep ? `${result.reason} ${result.nextStep}` : result.reason)
      }
    }, `Exported ${project.name} as JSON. Keys are never in the file.`)
  }

  async function duplicate(): Promise<void> {
    let name = ''
    await action.run(
      async () => {
        name = (await admin.duplicateProject({ projectId: project.id })).name
        await refresh()
      },
      () =>
        `Created ${name} with the same settings and markets. Pages, questions and history stay with ${project.name}.`
    )
  }

  async function toggleArchive(): Promise<void> {
    await action.run(
      async () => {
        await client.updateProject({
          projectId: project.id,
          status: archived ? 'active' : 'archived'
        })
        await refresh()
      },
      archived
        ? `${project.name} is restored. Checks run again on its schedule.`
        : `${project.name} is archived.`
    )
  }

  async function remove(): Promise<void> {
    await removal.run(async () => {
      const result = await admin.deleteProject({ projectId: project.id, confirmName: typed })
      await onDeleted(result.activeProjectId)
    }, `${project.name} was deleted.`)
  }

  return (
    <Section id={'ps-data'} title="Data">
      <div className="field">
        <span className="field-label">Project database</span>
        <div className="ps-db">
          <PathText path={view.database.path} />
          <span className="faint">
            {formatBytes(view.database.bytes)} ·{' '}
            <a
              href={pagesHash({ view: 'all' })}
              aria-label={`${plural(view.database.pageCount, 'page', 'pages')}: open All pages`}
            >
              {plural(view.database.pageCount, 'page', 'pages')}
            </a>{' '}
            ·{' '}
            <a
              href={sectionHash('status')}
              aria-label={`${plural(view.database.checkCount, 'check', 'checks')}: open recent activity in Status`}
            >
              {plural(view.database.checkCount, 'check', 'checks')}
            </a>
          </span>
        </div>
        <span className="hint">
          Everything for {project.name} is in this one file. API keys stay in your keychain.
        </span>
      </div>
      <div className="actions">
        <Button onClick={() => void toggleArchive()}>
          {archived ? 'Restore project' : 'Archive project'}
        </Button>
        <ToolGroup className="actions-tools">
          <ToolButton kind="download" label="Export project" onClick={() => void exportProject()} />
          <ToolButton kind="copy" label="Duplicate project" onClick={() => void duplicate()} />
        </ToolGroup>
      </div>
      <SaveStatus state={action.state} />
      {archived ? (
        <div className="note" role="status">
          <p>
            {project.name} is archived: checks stopped and it&apos;s hidden from the project
            switcher. Its history is kept. Restore it here or from{' '}
            <a href={sectionHash('projects')}>All projects</a>.
          </p>
        </div>
      ) : null}
      <div className="ps-danger">
        <div className="split">
          <span className="stack-tight">
            <span className="field-label">Delete project</span>
            <span className="hint">
              Deletes {file}: {plural(view.database.pageCount, 'page', 'pages')}, prompts and all
              check history. Shared keys and default templates aren&apos;t touched.
            </span>
          </span>
          <Button
            className="ps-btn-danger"
            aria-expanded={deleteOpen}
            aria-controls={`${base}-del`}
            onClick={() => {
              setDeleteOpen((open) => !open)
              setTyped('')
              removal.reset()
            }}
          >
            Delete project…
          </Button>
        </div>
        {deleteOpen ? (
          <div className="stack-tight" id={`${base}-del`}>
            <label className="field" htmlFor={`${base}-confirm`}>
              <span className="field-label">
                Type <span className="mono">{project.name}</span> to confirm
              </span>
              <input
                id={`${base}-confirm`}
                className="ob-input"
                autoComplete="off"
                value={typed}
                aria-describedby={`${base}-confirm-h`}
                onChange={(event) => setTyped(event.target.value)}
              />
              <span className="hint" id={`${base}-confirm-h`}>
                This can&apos;t be undone. Export the project first if you may want it back.
              </span>
            </label>
            <div className="actions">
              <Button
                variant="danger"
                disabled={typed !== project.name || removal.state.kind === 'saving'}
                onClick={() => void remove()}
              >
                Delete {project.name} for good
              </Button>
              <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
            </div>
            <SaveStatus state={removal.state} />
          </div>
        ) : null}
      </div>
    </Section>
  )
}
