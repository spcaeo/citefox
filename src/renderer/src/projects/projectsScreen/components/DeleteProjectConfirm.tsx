import { useId, useState, type JSX } from 'react'
import type { ProjectDetail } from '@shared/ipc'
import type { AdminClient } from '../../../admin/client'
import { errorText } from '../../../components/errorText'
import { Confirm, showUndo } from '../../../ui'

/**
 * Delete a project from the list (FR-10.8): the one confirm, held until the
 * project's name is typed, since its database file goes for good. On the URL
 * as `?delete=<project id>`.
 */
export function DeleteProjectConfirm({
  admin,
  project,
  onDeleted,
  onCancel
}: {
  admin: Pick<AdminClient, 'deleteProject'>
  project: ProjectDetail
  onDeleted: () => Promise<void>
  onCancel: () => void
}): JSX.Element {
  const id = useId()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await admin.deleteProject({ projectId: project.id, confirmName: typed })
      await onDeleted()
      showUndo({
        message: `Deleted ${project.name}.`,
        effect: 'Its pages, questions and check history are gone.'
      })
    } catch (cause) {
      setError(errorText(cause, 'Could not delete the project.'))
      setBusy(false)
    }
  }

  return (
    <Confirm
      title={`Delete ${project.name}?`}
      confirmLabel="Delete project"
      busy={busy}
      confirmDisabled={typed !== project.name}
      testId="pj-confirm-delete"
      onConfirm={() => void remove()}
      onCancel={onCancel}
      body={
        <>
          <p>
            Deletes{' '}
            {project.trackedPageCount > 0
              ? `its ${project.trackedPageCount.toLocaleString('en-US')} tracked ${project.trackedPageCount === 1 ? 'page' : 'pages'}, `
              : 'its pages, '}
            questions and all check history. Shared keys are not touched. This can&apos;t be undone:
            export it first if you may want it back.
          </p>
          <label className="field pj-delete-field" htmlFor={`${id}-name`}>
            <span className="field-label">
              Type <span className="mono">{project.name}</span> to confirm
            </span>
            <input
              id={`${id}-name`}
              className="ui-input"
              autoComplete="off"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          </label>
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
        </>
      }
    />
  )
}
