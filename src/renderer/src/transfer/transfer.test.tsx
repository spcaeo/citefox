// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type {
  ProjectImportPreview,
  ProjectImportResult,
  ProjectTransferSummary,
  SettingsImportPreview
} from '@shared/ipc'
import { DrawerHost } from '../shell/DrawerHost'
import { openDrawer, resetDrawersForTests } from '../shell/drawers'
import { UndoToastHost } from '../ui'
import { runMenuCommand } from './actions'
import { setTransferClient, type TransferClient } from './client'
import { ExportProjectDrawer } from './ExportProjectDrawer'
import { ImportProjectDrawer } from './ImportProjectDrawer'
import { ImportSettingsDrawer } from './ImportSettingsDrawer'

const PREVIEW: ProjectImportPreview = {
  token: 'tok-1',
  filename: 'textbolt.citefox-project.json',
  formatVersion: 1,
  schemaVersion: 41,
  appVersion: '0.12.0',
  exportedAt: '2026-10-20T09:00:00.000Z',
  project: { name: 'TextBolt', domain: 'textbolt.example', clientName: null },
  includesResults: false,
  sections: [
    { section: 'settings', label: 'Project settings', count: 1 },
    { section: 'pages', label: 'Pages', count: 12 },
    { section: 'questions', label: 'Questions and questions', count: 48 }
  ],
  sameSite: [{ projectId: 'proj-old', name: 'TextBolt (old Mac)' }],
  result: null
}

const RESULT: ProjectImportResult = {
  mode: 'new',
  projectId: 'proj-new',
  projectName: 'TextBolt (imported)',
  undoable: true,
  sections: [
    { section: 'pages', label: 'Pages', added: 12, skipped: 0, failed: 0, notes: [] },
    {
      section: 'questions',
      label: 'Questions and questions',
      added: 46,
      skipped: 2,
      failed: 0,
      notes: ['2 questions skipped: already in the project']
    }
  ]
}

const SUMMARY: ProjectTransferSummary = {
  projectId: 'proj-1',
  name: 'TextBolt',
  domain: 'textbolt.example',
  sections: [
    { section: 'settings', label: 'Project settings', count: 1 },
    { section: 'pages', label: 'Pages', count: 12 }
  ],
  checkCount: 30
}

const SETTINGS: SettingsImportPreview = {
  token: 'set-1',
  filename: 'citefox.citefox-settings.json',
  formatVersion: 1,
  appVersion: '0.12.0',
  exportedAt: '2026-10-20T09:00:00.000Z',
  fields: [
    { key: 'userName', label: 'Your name', current: 'Ada', incoming: 'Lin', changed: true },
    { key: 'theme', label: 'Theme', current: 'Light', incoming: 'Light', changed: false }
  ],
  result: null
}

function fakeClient(patch: Partial<TransferClient> = {}): TransferClient {
  return {
    projectSummary: vi.fn(async () => SUMMARY),
    exportProject: vi.fn(async () => ({
      ok: true as const,
      filename: 'textbolt.citefox-project.json',
      bytes: 2048,
      sections: SUMMARY.sections
    })),
    pickProject: vi.fn(async () => ({ ok: true as const, token: 'tok-1', filename: 'x' })),
    projectPreview: vi.fn(async () => PREVIEW),
    importProject: vi.fn(async () => RESULT),
    deleteProject: vi.fn(async () => ({ projectId: 'proj-new', activeProjectId: 'proj-1' })),
    exportSettings: vi.fn(async () => ({
      ok: true as const,
      filename: 'citefox.citefox-settings.json',
      bytes: 400,
      fieldCount: 12
    })),
    pickSettings: vi.fn(async () => ({ ok: true as const, token: 'set-1', filename: 'x' })),
    settingsPreview: vi.fn(async () => SETTINGS),
    applySettings: vi.fn(async () => [
      { key: 'userName', label: 'Your name', outcome: 'applied' as const, reason: null },
      { key: 'theme', label: 'Theme', outcome: 'unchanged' as const, reason: null }
    ]),
    onMenu: vi.fn(() => () => undefined),
    ...patch
  }
}

beforeEach(() => {
  resetDrawersForTests()
  window.location.hash = '#/projects'
})

afterEach(() => {
  cleanup()
  setTransferClient(null)
  resetDrawersForTests()
  window.location.hash = ''
})

describe('Import project drawer', () => {
  test('previews the file, imports it as a new project, then Undo deletes it', async () => {
    const client = fakeClient()
    const onProjectsChanged = vi.fn()
    const onClose = vi.fn()
    render(
      <>
        <ImportProjectDrawer
          token="tok-1"
          mode="new"
          targetId={null}
          onChoice={vi.fn()}
          onClose={onClose}
          onProjectsChanged={onProjectsChanged}
          client={client}
        />
        <UndoToastHost />
      </>
    )
    const counts = await screen.findByTestId('import-counts')
    expect(within(counts).getByText('Questions and questions')).toBeTruthy()
    expect(within(counts).getByText('48')).toBeTruthy()
    expect(screen.getByText('textbolt.citefox-project.json')).toBeTruthy()
    expect(screen.getByText('Not included')).toBeTruthy()
    expect(screen.getByText(/keychain and are not included/)).toBeTruthy()
    expect(
      (screen.getByRole('radio', { name: /Import as a new project/ }) as HTMLInputElement).checked
    ).toBe(true)
    expect(screen.getByRole('radio', { name: /Replace TextBolt \(old Mac\)/ })).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByTestId('import-project-run'))
    })
    expect(client.importProject).toHaveBeenCalledWith({
      token: 'tok-1',
      mode: 'new',
      replaceProjectId: null
    })
    expect(onProjectsChanged).toHaveBeenCalledTimes(1)
    const result = screen.getByTestId('import-result')
    const questions = result.querySelector('tr[data-section="questions"]') as HTMLElement
    expect(within(questions).getByText('46')).toBeTruthy()
    expect(within(questions).getByText('2 questions skipped: already in the project')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByTestId('import-project-undo'))
    })
    expect(client.deleteProject).toHaveBeenCalledWith({
      projectId: 'proj-new',
      confirmName: 'TextBolt (imported)'
    })
    expect(onProjectsChanged).toHaveBeenCalledTimes(2)
    expect(onClose).toHaveBeenCalled()
    expect(screen.getByText('Removed TextBolt (imported).')).toBeTruthy()
  })

  test('Replace asks first, then merges into the same-site project', async () => {
    const client = fakeClient({
      importProject: vi.fn(async () => ({
        ...RESULT,
        mode: 'replace' as const,
        projectId: 'proj-old',
        projectName: 'TextBolt (old Mac)',
        undoable: false
      }))
    })
    const onChoice = vi.fn()
    const view = render(
      <ImportProjectDrawer
        token="tok-1"
        mode="new"
        targetId={null}
        onChoice={onChoice}
        onClose={vi.fn()}
        onProjectsChanged={vi.fn()}
        client={client}
      />
    )
    fireEvent.click(await screen.findByRole('radio', { name: /Replace TextBolt \(old Mac\)/ }))
    expect(onChoice).toHaveBeenCalledWith('replace', 'proj-old')

    view.rerender(
      <ImportProjectDrawer
        token="tok-1"
        mode="replace"
        targetId="proj-old"
        onChoice={onChoice}
        onClose={vi.fn()}
        onProjectsChanged={vi.fn()}
        client={client}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Replace project' }))
    const confirm = await screen.findByTestId('import-project-confirm')
    expect(client.importProject).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Replace project' }))
    })
    expect(client.importProject).toHaveBeenCalledWith({
      token: 'tok-1',
      mode: 'replace',
      replaceProjectId: 'proj-old'
    })
    expect(await screen.findByText('Merged into TextBolt (old Mac)')).toBeTruthy()
    expect(screen.queryByTestId('import-project-undo')).toBeNull()
  })

  test('a file that is no longer open says so in plain words', async () => {
    const client = fakeClient({
      projectPreview: vi.fn(async () => {
        throw new Error(
          "Error invoking remote method 'transfer:projectPreview': IpcRequestError: transfer:projectPreview: That file is no longer open"
        )
      })
    })
    render(
      <ImportProjectDrawer
        token="gone"
        mode="new"
        targetId={null}
        onChoice={vi.fn()}
        onClose={vi.fn()}
        onProjectsChanged={vi.fn()}
        client={client}
      />
    )
    expect(await screen.findByText(/That file is no longer open/)).toBeTruthy()
    expect(screen.queryByTestId('import-project-run')).toBeNull()
  })
})

describe('Export project drawer', () => {
  test('check results are off by default; the export sends the choice', async () => {
    const client = fakeClient()
    const onIncludeResults = vi.fn()
    const onClose = vi.fn()
    const view = render(
      <ExportProjectDrawer
        projectId="proj-1"
        includeResults={false}
        onIncludeResults={onIncludeResults}
        onClose={onClose}
        client={client}
      />
    )
    const box = (await screen.findByRole('checkbox', {
      name: /Include stored check results/
    })) as HTMLInputElement
    expect(box.checked).toBe(false)
    expect(screen.queryByText('Stored check results')).toBeNull()
    fireEvent.click(box)
    expect(onIncludeResults).toHaveBeenCalledWith(true)

    view.rerender(
      <ExportProjectDrawer
        projectId="proj-1"
        includeResults
        onIncludeResults={onIncludeResults}
        onClose={onClose}
        client={client}
      />
    )
    expect(screen.getByText('Stored check results')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByTestId('export-project-save'))
    })
    expect(client.exportProject).toHaveBeenCalledWith({ projectId: 'proj-1', includeResults: true })
    expect(onClose).toHaveBeenCalled()
  })

  test('a failed save stays open with the reason', async () => {
    const client = fakeClient({
      exportProject: vi.fn(async () => ({
        ok: false as const,
        cancelled: false,
        reason: 'Could not write the file.',
        nextStep: 'Pick another folder.'
      }))
    })
    const onClose = vi.fn()
    render(
      <ExportProjectDrawer
        projectId="proj-1"
        includeResults={false}
        onIncludeResults={vi.fn()}
        onClose={onClose}
        client={client}
      />
    )
    await screen.findByRole('checkbox', { name: /Include stored check results/ })
    await act(async () => {
      fireEvent.click(screen.getByTestId('export-project-save'))
    })
    expect(screen.getByRole('alert').textContent).toBe(
      'Could not write the file. Pick another folder.'
    )
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('Import app settings drawer', () => {
  test('shows each setting next to the file, applies and reports per field', async () => {
    const client = fakeClient()
    const onSettingsChanged = vi.fn()
    render(
      <ImportSettingsDrawer
        token="set-1"
        onClose={vi.fn()}
        onSettingsChanged={onSettingsChanged}
        client={client}
      />
    )
    const table = await screen.findByTestId('settings-fields')
    const name = table.querySelector('tr[data-field="userName"]') as HTMLElement
    expect(name.getAttribute('data-changed')).toBe('true')
    expect(within(name).getByText('Lin')).toBeTruthy()
    expect(screen.getByText(/keychain and are not included/)).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply 1 change' }))
    })
    expect(client.applySettings).toHaveBeenCalledWith('set-1')
    expect(onSettingsChanged).toHaveBeenCalled()
    const result = screen.getByTestId('settings-result')
    expect(result.querySelector('tr[data-field="userName"]')?.textContent).toContain('Applied')
    expect(result.querySelector('tr[data-field="theme"]')?.textContent).toContain(
      'Already the same'
    )
  })
})

describe('shell wiring', () => {
  test('the import drawer opens from its URL with no project open', async () => {
    setTransferClient(fakeClient())
    render(<DrawerHost projectId={null} />)
    act(() => openDrawer('import-project', { 'ip.file': 'tok-1' }))
    const dialog = await screen.findByRole('dialog', { name: /Import project/ })
    await waitFor(() => expect(within(dialog).getByTestId('import-counts')).toBeTruthy())
    expect(window.location.hash).toContain('drawer=import-project')
    expect(window.location.hash).toContain('ip.file=tok-1')
  })

  test('File menu: Import Project picks a file, then opens the drawer with its token', async () => {
    const client = fakeClient()
    runMenuCommand('import-project', null, client)
    await waitFor(() => expect(window.location.hash).toContain('ip.file=tok-1'))
    expect(client.pickProject).toHaveBeenCalled()
    runMenuCommand('export-project', 'proj-1', client)
    await waitFor(() => expect(window.location.hash).toContain('ep.project=proj-1'))
  })
})
