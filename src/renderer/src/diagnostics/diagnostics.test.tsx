// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { DiagnosticsMenuEvent, DiagnosticsReport } from '@shared/ipc'
import { DrawerHost } from '../shell/DrawerHost'
import { openDrawer, resetDrawersForTests } from '../shell/drawers'
import { UndoToastHost } from '../ui'
import { openReportProblem } from './actions'
import { setDiagnosticsClient, type DiagnosticsClient } from './client'
import { ReportProblemDrawer } from './ReportProblemDrawer'
import { useDiagnosticsMenu } from './useDiagnosticsMenu'

const RELEASE = 'v0.13.2 · build 1424 · Nov 2, 2026 8:49 AM EST'

function reportFor(note: string, includeQuestions: boolean): DiagnosticsReport {
  const text = `CiteFox problem report\nNote: ${note || '(nothing)'}\nQuestions: ${includeQuestions ? 'yes' : 'no'}\n`
  return { text, bytes: text.length, lines: text.split('\n').length, release: RELEASE }
}

function fakeClient(patch: Partial<DiagnosticsClient> = {}): DiagnosticsClient {
  return {
    build: vi.fn(async (request) => reportFor(request.note, request.includeQuestions)),
    send: vi.fn(async () => ({ ok: true as const, reportId: 'CF-ABC234' })),
    save: vi.fn(async () => ({ saved: true as const, filename: 'report.txt' })),
    revealLogs: vi.fn(async () => ({ ok: true as const })),
    openMail: vi.fn(async () => ({ ok: true as const })),
    onMenu: vi.fn(() => () => undefined),
    ...patch
  }
}

const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve())
const open = vi.fn()

beforeEach(() => {
  resetDrawersForTests()
  window.location.hash = '#/projects'
  writeText.mockClear()
  open.mockClear()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  vi.stubGlobal('open', open)
})

afterEach(() => {
  cleanup()
  setDiagnosticsClient(null)
  resetDrawersForTests()
  vi.unstubAllGlobals()
  window.location.hash = ''
})

async function openDialog(client: DiagnosticsClient): Promise<HTMLElement> {
  setDiagnosticsClient(client)
  render(
    <>
      <DrawerHost projectId="proj-1" />
      <UndoToastHost />
    </>
  )
  act(() => openReportProblem())
  const dialog = await screen.findByRole('dialog', { name: /Report a problem/ })
  await waitFor(() =>
    expect(screen.getByTestId('report-preview').textContent).toContain('problem report')
  )
  return dialog
}

describe('Report a problem drawer', () => {
  test('opens from its URL with no project, explains itself, and previews the exact text', async () => {
    const client = fakeClient()
    setDiagnosticsClient(client)
    render(<DrawerHost projectId={null} />)
    act(() => openDrawer('report-problem'))
    const dialog = await screen.findByRole('dialog', { name: /Report a problem/ })
    expect(window.location.hash).toContain('drawer=report-problem')
    expect(dialog.textContent).toContain('Nothing is sent unless you choose it below.')
    expect(dialog.textContent).toContain('This is exactly what would be shared.')
    await waitFor(() =>
      expect(screen.getByTestId('report-preview').textContent).toBe(reportFor('', false).text)
    )
    expect(client.build).toHaveBeenCalledWith({
      includeQuestions: false,
      note: '',
      projectId: null
    })
    expect(dialog.textContent).toContain('lines')
  })

  test('the open project is read; a link can name another, and keeps the question box', async () => {
    const client = fakeClient()
    await openDialog(client)
    expect(client.build).toHaveBeenLastCalledWith({
      includeQuestions: false,
      note: '',
      projectId: 'proj-1'
    })
    cleanup()
    resetDrawersForTests()
    const second = fakeClient()
    setDiagnosticsClient(second)
    render(<DrawerHost projectId="proj-1" />)
    act(() => openDrawer('report-problem', { 'rp.project': 'proj-7', 'rp.q': '1' }))
    await screen.findByRole('dialog', { name: /Report a problem/ })
    await waitFor(() =>
      expect(second.build).toHaveBeenCalledWith({
        includeQuestions: true,
        note: '',
        projectId: 'proj-7'
      })
    )
    expect(
      (screen.getByRole('checkbox', { name: /Include my question texts/ }) as HTMLInputElement)
        .checked
    ).toBe(true)
  })

  test('the toggle is off by default, changes the request and the URL, and rebuilds the preview', async () => {
    const client = fakeClient()
    await openDialog(client)
    const box = screen.getByRole('checkbox', {
      name: /Include my question texts/
    }) as HTMLInputElement
    expect(box.checked).toBe(false)
    fireEvent.click(box)
    await waitFor(() => expect(window.location.hash).toContain('rp.q=1'))
    await waitFor(() =>
      expect(screen.getByTestId('report-preview').textContent).toContain('Questions: yes')
    )
    expect(client.build).toHaveBeenLastCalledWith({
      includeQuestions: true,
      note: '',
      projectId: 'proj-1'
    })
  })

  test('what you type goes into the report', async () => {
    const client = fakeClient()
    await openDialog(client)
    fireEvent.change(screen.getByRole('textbox', { name: 'What happened?' }), {
      target: { value: 'Checks all fail' }
    })
    await waitFor(() =>
      expect(screen.getByTestId('report-preview').textContent).toContain('Note: Checks all fail')
    )
    expect(client.build).toHaveBeenLastCalledWith({
      includeQuestions: false,
      note: 'Checks all fail',
      projectId: 'proj-1'
    })
  })

  test('Copy report copies the exact preview and shows a tick', async () => {
    await openDialog(fakeClient())
    const preview = screen.getByTestId('report-preview').textContent ?? ''
    fireEvent.click(screen.getByTestId('report-copy'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(preview))
    await waitFor(() => expect(screen.getByTestId('report-copy').textContent).toContain('Copied'))
  })

  test('Save as file saves the shown text; a closed dialog says nothing', async () => {
    const client = fakeClient()
    await openDialog(client)
    const preview = screen.getByTestId('report-preview').textContent ?? ''
    fireEvent.click(screen.getByTestId('report-save'))
    await waitFor(() => expect(client.save).toHaveBeenCalledWith(preview))
    expect(await screen.findByText('Saved report.txt.')).toBeTruthy()
  })

  test('Email it to us copies the full report first, then opens a short email with the note', async () => {
    const client = fakeClient()
    await openDialog(client)
    fireEvent.change(screen.getByRole('textbox', { name: 'What happened?' }), {
      target: { value: 'It broke' }
    })
    await waitFor(() =>
      expect(screen.getByTestId('report-preview').textContent).toContain('It broke')
    )
    const preview = screen.getByTestId('report-preview').textContent ?? ''
    fireEvent.click(screen.getByTestId('report-email'))
    await waitFor(() => expect(client.openMail).toHaveBeenCalledWith('It broke'))
    expect(writeText).toHaveBeenCalledWith(preview)
    expect(await screen.findByText('The full report is copied.')).toBeTruthy()
    expect(screen.getByText('Paste it into the email.')).toBeTruthy()
    expect(writeText.mock.invocationCallOrder[0]).toBeLessThan(
      (client.openMail as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] ?? 0
    )
  })

  test('Open a GitHub issue copies the report, then opens a new issue with a short body', async () => {
    await openDialog(fakeClient())
    fireEvent.click(screen.getByTestId('report-issue'))
    await waitFor(() => expect(open).toHaveBeenCalled())
    const [url, target, features] = open.mock.calls[0] as [string, string, string]
    expect(url.startsWith('https://github.com/spcaeo/citefox/issues/new?title=')).toBe(true)
    expect(url.length).toBeLessThan(2000)
    expect(decodeURIComponent(url)).toContain(RELEASE)
    expect(decodeURIComponent(url)).toContain('Paste the full report below this line')
    expect(target).toBe('_blank')
    expect(features).toContain('noopener')
    expect(writeText).toHaveBeenCalled()
    expect(await screen.findByText('Paste it into the GitHub issue.')).toBeTruthy()
  })

  test('says what to do when the mail program cannot open, and when the copy fails', async () => {
    const client = fakeClient({
      openMail: vi.fn(async () => ({
        ok: false as const,
        reason: 'Could not open your mail program.',
        nextStep: 'Copy the report and email it to us yourself.'
      }))
    })
    writeText.mockRejectedValueOnce(new Error('denied'))
    await openDialog(client)
    fireEvent.click(screen.getByTestId('report-email'))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Could not open your mail program.')
  })

  test('Show logs folder asks main to open it', async () => {
    const client = fakeClient()
    await openDialog(client)
    fireEvent.click(screen.getByTestId('report-logs'))
    await waitFor(() => expect(client.revealLogs).toHaveBeenCalled())
  })

  test('a build that fails shows the reason with a retry', async () => {
    const build = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          "Error invoking remote method 'diagnostics:build': IpcRequestError: diagnostics:build: Request failed"
        )
      )
      .mockImplementation(async (request: { note: string; includeQuestions: boolean }) =>
        reportFor(request.note, request.includeQuestions)
      )
    setDiagnosticsClient(fakeClient({ build }))
    render(<DrawerHost projectId={null} />)
    act(() => openDrawer('report-problem'))
    const retry = await screen.findByRole('button', { name: /Try again|Retry/ })
    fireEvent.click(retry)
    await waitFor(() =>
      expect(screen.getByTestId('report-preview').textContent).toContain('problem report')
    )
  })

  test('the drawer can be rendered on its own', async () => {
    const onClose = vi.fn()
    render(
      <ReportProblemDrawer
        includeQuestions={false}
        onIncludeQuestions={() => undefined}
        projectId={null}
        onClose={onClose}
        client={fakeClient()}
      />
    )
    expect(await screen.findByRole('dialog', { name: /Report a problem/ })).toBeTruthy()
  })
})

describe('Send to CiteFox', () => {
  const CONSENT =
    /I understand this report \(shown above\) is sent to the CiteFox team at Space-O Technologies\./

  test('needs the consent tick: the button stays off until it is ticked, and nothing is sent before the click', async () => {
    const client = fakeClient()
    await openDialog(client)
    const send = screen.getByTestId('report-send') as HTMLButtonElement
    expect(send.disabled).toBe(true)
    expect(screen.getByText(CONSENT)).toBeTruthy()
    fireEvent.click(screen.getByTestId('report-consent'))
    expect(send.disabled).toBe(false)
    expect(client.send).not.toHaveBeenCalled()
  })

  test('sends the shown text with consent, then shows the reference with a copy button', async () => {
    const client = fakeClient()
    await openDialog(client)
    fireEvent.change(screen.getByRole('textbox', { name: 'What happened?' }), {
      target: { value: 'All failed' }
    })
    await waitFor(() =>
      expect(screen.getByTestId('report-preview').textContent).toContain('All failed')
    )
    const preview = screen.getByTestId('report-preview').textContent ?? ''
    fireEvent.click(screen.getByTestId('report-consent'))
    fireEvent.click(screen.getByTestId('report-send'))
    await waitFor(() => expect(client.send).toHaveBeenCalled())
    expect(client.send).toHaveBeenCalledWith({
      includeQuestions: false,
      note: 'All failed',
      projectId: 'proj-1',
      consent: true,
      text: preview
    })
    const sent = await screen.findByTestId('report-sent')
    expect(sent.textContent).toBe(
      'Sent. Your reference is CF-ABC234. Please quote it if you write to us.'
    )
    expect(screen.getByRole('button', { name: 'Copy CF-ABC234' })).toBeTruthy()
    expect((screen.getByTestId('report-send') as HTMLButtonElement).disabled).toBe(true)
  })

  test.each([['offline'], ['invalid'], ['rate'], ['http-500']])(
    'a failed send (%s) says so in plain words and offers Save as file and Email',
    async (error) => {
      const client = fakeClient({ send: vi.fn(async () => ({ ok: false as const, error })) })
      await openDialog(client)
      fireEvent.click(screen.getByTestId('report-consent'))
      fireEvent.click(screen.getByTestId('report-send'))
      const alert = await screen.findByTestId('report-send-failed')
      expect(alert.textContent).toContain('We could not send it just now.')
      expect(alert.textContent).toContain('getcitifox@gmail.com')
      expect(screen.queryByTestId('report-sent')).toBeNull()
      expect((screen.getByTestId('report-save') as HTMLButtonElement).disabled).toBe(false)
      expect((screen.getByTestId('report-email') as HTMLButtonElement).disabled).toBe(false)
      expect((screen.getByTestId('report-send') as HTMLButtonElement).disabled).toBe(false)
    }
  )

  test('a send that throws is the same as a failed one', async () => {
    const client = fakeClient({ send: vi.fn(async () => Promise.reject(new Error('gone'))) })
    await openDialog(client)
    fireEvent.click(screen.getByTestId('report-consent'))
    fireEvent.click(screen.getByTestId('report-send'))
    expect(await screen.findByTestId('report-send-failed')).toBeTruthy()
  })
})

describe('Help › Report a problem… (menu command)', () => {
  test('main pushes diagnostics:menu and the drawer opens on the URL', () => {
    let listener: ((event: DiagnosticsMenuEvent) => void) | null = null
    const client = fakeClient({
      onMenu: (next) => {
        listener = next
        return () => {
          listener = null
        }
      }
    })
    const { unmount } = renderHook(() => useDiagnosticsMenu('proj-9', client))
    expect(listener).not.toBeNull()
    act(() => listener?.({ command: 'report-problem' }))
    expect(window.location.hash).toContain('drawer=report-problem')
    expect(window.location.hash).toContain('rp.project=proj-9')
    unmount()
    expect(listener).toBeNull()
  })
})
