import { useMemo } from 'react'
import type { ProjectStatus } from '@shared/domain'
import type { ProjectDetail } from '@shared/ipc'
import type { AdminClient } from '../../../admin/client'
import { errorText } from '../../../components/errorText'
import { openProjectExport } from '../../../transfer/actions'
import { showUndo } from '../../../ui'
import type { ShellClient } from '../../client'
import type { ProjectRowActions } from '../types'

/** What the list's row edits need from the screen. */
export interface ProjectRowDeps {
  client: Pick<ShellClient, 'updateProject'>
  /** Duplicate, Export and Delete. Omitted (Vite harness): those are left out. */
  admin?: Pick<AdminClient, 'duplicateProject'>
  /** Reloads the project list. */
  reload: () => Promise<void>
  /** Shows a failure above the list; null clears it. */
  setError: (message: string | null) => void
  /** Opens the delete confirm for one project. */
  askDelete: (projectId: string) => void
}

type Run = (work: () => Promise<void>, failure: string) => Promise<boolean>

function runner(setError: ProjectRowDeps['setError']): Run {
  return async (work, failure) => {
    setError(null)
    try {
      await work()
      return true
    } catch (cause) {
      setError(errorText(cause, failure))
      return false
    }
  }
}

/**
 * Pause or Resume with Undo (deep audit setup S5.3): the toast puts the old
 * status back. Errors show above the list instead of a toast.
 */
export function useToggleWithUndo(
  deps: Pick<ProjectRowDeps, 'client' | 'reload' | 'setError'>
): (project: ProjectDetail) => Promise<void> {
  const { client, reload, setError } = deps
  return useMemo(() => {
    const run = runner(setError)
    return async (project: ProjectDetail) => {
      const previous = project.status
      const next: ProjectStatus = previous === 'paused' ? 'active' : 'paused'
      const done = await run(async () => {
        await client.updateProject({ projectId: project.id, status: next })
        await reload()
      }, 'Could not update the project.')
      if (!done) return
      showUndo({
        message: next === 'paused' ? `Paused ${project.name}.` : `Resumed ${project.name}.`,
        effect:
          next === 'paused'
            ? 'Its scheduled checks stop until you resume it.'
            : 'Checks run again on its schedule.',
        undo: async () => {
          await client.updateProject({ projectId: project.id, status: previous })
          await reload()
        }
      })
    }
  }, [client, reload, setError])
}

function adminActions(
  admin: NonNullable<ProjectRowDeps['admin']>,
  reload: () => Promise<void>,
  run: Run
): Pick<ProjectRowActions, 'onDuplicate' | 'onExport'> {
  return {
    onDuplicate: async (project) => {
      let copy = ''
      const done = await run(async () => {
        copy = (await admin.duplicateProject({ projectId: project.id })).name
        await reload()
      }, 'Could not duplicate the project.')
      if (done) {
        showUndo({
          message: `Created ${copy}.`,
          effect: `Same settings and markets. Pages, questions and history stay with ${project.name}.`
        })
      }
    },
    // The project file (settings, lists, optionally check results) to move it to a new Mac.
    // Report exports live in Reports.
    onExport: (project) => {
      openProjectExport(project.id)
      return Promise.resolve()
    }
  }
}

/** Rename, Duplicate, Export, Archive (with Undo) and Delete for the row menu. */
export function useProjectRowActions(deps: ProjectRowDeps): ProjectRowActions {
  const { client, admin, reload, setError, askDelete } = deps
  return useMemo<ProjectRowActions>(() => {
    const run = runner(setError)
    return {
      onRename: async (project, name) => {
        const saved = await run(async () => {
          await client.updateProject({ projectId: project.id, name })
          await reload()
        }, 'Could not rename the project.')
        if (saved) {
          showUndo({
            message: `Renamed ${project.name} to ${name}.`,
            undo: async () => {
              await client.updateProject({ projectId: project.id, name: project.name })
              await reload()
            }
          })
        }
        return saved
      },
      ...(admin ? adminActions(admin, reload, run) : {}),
      onArchive: async (project) => {
        const previous = project.status
        const done = await run(async () => {
          await client.updateProject({ projectId: project.id, status: 'archived' })
          await reload()
        }, 'Could not archive the project.')
        if (done) {
          showUndo({
            message: `Archived ${project.name}.`,
            effect: 'Checks stopped and it left the project switcher. Its history stays.',
            undo: async () => {
              await client.updateProject({ projectId: project.id, status: previous })
              await reload()
            }
          })
        }
      },
      ...(admin ? { onDelete: (project: ProjectDetail) => askDelete(project.id) } : {})
    }
  }, [client, admin, reload, setError, askDelete])
}
