// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState, type JSX } from 'react'
import { afterEach, describe, expect, test, vi, type Mock } from 'vitest'
import type { ExportStartResult } from '@shared/domain'
import type { ProjectDetail, UpdateProjectRequest } from '@shared/ipc'
import type { AdminClient } from '../../admin/client'
import { resetDrawersForTests } from '../../shell/drawers'
import { UndoToastHost } from '../../ui'
import { DeleteProjectConfirm } from './components/DeleteProjectConfirm'
import { ProjectTable } from './components/ProjectTable'
import { useProjectRowActions, useToggleWithUndo } from './hooks/useProjectRowActions'
import type { ProjectActions } from './types'

afterEach(() => {
  cleanup()
  window.location.hash = ''
  resetDrawersForTests()
})

const MARKET = {
  id: 'mkt-us',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop' as const,
  localWording: false,
  serpapiLocation: null
}

function project(id: string, name: string, patch: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id,
    name,
    slug: id,
    domain: `${id}.example`,
    dbPath: `projects/${id}.sqlite`,
    clientName: null,
    status: 'active',
    includeSubdomains: false,
    brandNames: [name],
    competitors: [],
    defaultMarket: MARKET,
    foundPageCount: 40,
    trackedPageCount: 12,
    markets: [MARKET],
    ...patch
  }
}

type Admin = Pick<AdminClient, 'duplicateProject' | 'exportProject' | 'deleteProject'>

function fakes(): {
  updates: UpdateProjectRequest[]
  client: { updateProject: (request: UpdateProjectRequest) => Promise<ProjectDetail> }
  admin: { [K in keyof Admin]: Mock<Admin[K]> }
  reload: Mock<() => Promise<void>>
} {
  const updates: UpdateProjectRequest[] = []
  return {
    updates,
    client: {
      updateProject: async (request) => {
        updates.push(request)
        return project(request.projectId, request.name ?? 'Alpha')
      }
    },
    admin: {
      duplicateProject: vi.fn<Admin['duplicateProject']>(async () =>
        project('alpha-copy', 'Alpha (copy)')
      ),
      exportProject: vi.fn<Admin['exportProject']>(
        async (): Promise<ExportStartResult> =>
          ({ ok: true, jobId: 'job-1' }) as unknown as ExportStartResult
      ),
      deleteProject: vi.fn<Admin['deleteProject']>(async () => ({
        projectId: 'alpha',
        activeProjectId: null
      }))
    },
    reload: vi.fn<() => Promise<void>>(async () => undefined)
  }
}

function Harness({
  projects,
  deps
}: {
  projects: readonly ProjectDetail[]
  deps: ReturnType<typeof fakes>
}): JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const toggle = useToggleWithUndo({ client: deps.client, reload: deps.reload, setError })
  const edits = useProjectRowActions({
    client: deps.client,
    admin: deps.admin,
    reload: deps.reload,
    setError,
    askDelete: setDeleteId
  })
  const actions: ProjectActions = {
    onOpen: vi.fn(async () => undefined),
    onSettings: vi.fn(),
    onToggleStatus: toggle,
    onRestore: vi.fn(async () => undefined),
    onGo: vi.fn(),
    loadPageScores: vi.fn(async () => [])
  }
  const deleting = projects.find((item) => item.id === deleteId)
  return (
    <>
      {error ? <p role="alert">{error}</p> : null}
      <ProjectTable
        rows={projects.map((item) => ({
          project: item,
          score: undefined,
          schedule: undefined,
          usage: undefined
        }))}
        total={projects.length}
        actions={actions}
        edits={edits}
        statusFilter={{
          label: 'Status',
          value: 'all',
          options: [{ value: 'all', label: 'All' }],
          onChange: vi.fn()
        }}
        empty={<p>No projects</p>}
      />
      {deleting ? (
        <DeleteProjectConfirm
          admin={deps.admin}
          project={deleting}
          onCancel={() => setDeleteId(null)}
          onDeleted={async () => {
            setDeleteId(null)
            await deps.reload()
          }}
        />
      ) : null}
      <UndoToastHost />
    </>
  )
}

async function menu(name: string, item: RegExp | string): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }))
  return screen.findByRole('menuitem', { name: item })
}

describe('Projects row menu edits', () => {
  test('Rename edits the name in place: Enter saves with Undo, Escape keeps it', async () => {
    const deps = fakes()
    render(<Harness projects={[project('alpha', 'Alpha')]} deps={deps} />)
    fireEvent.click(await menu('Alpha', 'Rename'))
    const field = (await screen.findByRole('textbox', {
      name: 'New name for Alpha'
    })) as HTMLInputElement
    await waitFor(() => expect(document.activeElement).toBe(field))
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'New name for Alpha' })).toBeNull()
    expect(deps.updates).toEqual([])

    fireEvent.click(await menu('Alpha', 'Rename'))
    const again = await screen.findByRole('textbox', { name: 'New name for Alpha' })
    fireEvent.change(again, { target: { value: '  Alpha Labs ' } })
    await act(async () => {
      fireEvent.keyDown(again, { key: 'Enter' })
    })
    expect(deps.updates).toEqual([{ projectId: 'alpha', name: 'Alpha Labs' }])
    expect(screen.queryByRole('textbox', { name: 'New name for Alpha' })).toBeNull()
    expect(screen.getByText('Renamed Alpha to Alpha Labs.')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    })
    expect(deps.updates.at(-1)).toEqual({ projectId: 'alpha', name: 'Alpha' })
  })

  test('Pause and Resume use their own icons, and Pause has Undo', async () => {
    const deps = fakes()
    render(
      <Harness
        projects={[project('alpha', 'Alpha'), project('beta', 'Beta', { status: 'paused' })]}
        deps={deps}
      />
    )
    const pause = await menu('Alpha', 'Pause')
    expect(pause.querySelector('path[d="M9 6v12"]')).toBeTruthy()
    await act(async () => {
      fireEvent.click(pause)
    })
    expect(deps.updates).toEqual([{ projectId: 'alpha', status: 'paused' }])
    expect(screen.getByText('Paused Alpha.')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    })
    expect(deps.updates.at(-1)).toEqual({ projectId: 'alpha', status: 'active' })

    const resume = await menu('Beta', 'Resume')
    expect(resume.querySelector('path[d="M8 5.5v13l10.5-6.5z"]')).toBeTruthy()
  })

  test('Archive with Undo, Duplicate and Export', async () => {
    const deps = fakes()
    render(<Harness projects={[project('alpha', 'Alpha', { status: 'paused' })]} deps={deps} />)
    await act(async () => {
      fireEvent.click(await menu('Alpha', 'Archive'))
    })
    expect(deps.updates).toEqual([{ projectId: 'alpha', status: 'archived' }])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    })
    // Back to paused, not active.
    expect(deps.updates.at(-1)).toEqual({ projectId: 'alpha', status: 'paused' })

    await act(async () => {
      fireEvent.click(await menu('Alpha', 'Duplicate'))
    })
    expect(deps.admin.duplicateProject).toHaveBeenCalledWith({ projectId: 'alpha' })
    expect(screen.getByText('Created Alpha (copy).')).toBeTruthy()

    await act(async () => {
      fireEvent.click(await menu('Alpha', 'Export project…'))
    })
    // Export opens the project file drawer (one .citefox-project.json), not a report export.
    expect(deps.admin.exportProject).not.toHaveBeenCalled()
    expect(window.location.hash).toContain('drawer=export-project')
    expect(window.location.hash).toContain('ep.project=alpha')
  })

  test('Delete waits for the typed name, then deletes and reloads', async () => {
    const deps = fakes()
    render(<Harness projects={[project('alpha', 'Alpha')]} deps={deps} />)
    fireEvent.click(await menu('Alpha', 'Delete…'))
    const dialog = screen.getByTestId('pj-confirm-delete')
    const confirm = within(dialog).getByRole('button', { name: 'Delete project' })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText(/Type Alpha to confirm/), {
      target: { value: 'alpha' }
    })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText(/Type Alpha to confirm/), {
      target: { value: 'Alpha' }
    })
    await act(async () => {
      fireEvent.click(confirm)
    })
    expect(deps.admin.deleteProject).toHaveBeenCalledWith({
      projectId: 'alpha',
      confirmName: 'Alpha'
    })
    expect(deps.reload).toHaveBeenCalled()
    expect(screen.queryByTestId('pj-confirm-delete')).toBeNull()
    expect(screen.getByText('Deleted Alpha.')).toBeTruthy()
  })

  test('without edits the menu only navigates and pauses', async () => {
    const actions: ProjectActions = {
      onOpen: vi.fn(async () => undefined),
      onSettings: vi.fn(),
      onToggleStatus: vi.fn(async () => undefined),
      onRestore: vi.fn(async () => undefined),
      onGo: vi.fn(),
      loadPageScores: vi.fn(async () => [])
    }
    render(
      <ProjectTable
        rows={[
          {
            project: project('alpha', 'Alpha'),
            score: undefined,
            schedule: undefined,
            usage: undefined
          }
        ]}
        total={1}
        actions={actions}
        statusFilter={{ label: 'Status', value: 'all', options: [], onChange: vi.fn() }}
        empty={null}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Alpha' }))
    await screen.findByRole('menuitem', { name: 'Pause' })
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Delete…' })).toBeNull()
  })
})
