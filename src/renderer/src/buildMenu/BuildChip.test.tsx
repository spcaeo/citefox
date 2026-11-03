// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import type { AppInfo, AppResetResult, OpenTestProfileResult } from '@shared/ipc'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAppInfoCache } from './appInfoStore'
import { BuildChip } from './BuildChip'
import type { BuildClient } from './buildClient'
import { BuildToolsHost } from './BuildToolsHost'
import { TestingPanel } from './TestingPanel'
import { useBuildActions } from './useBuildActions'

const BUILT = new Date(2026, 9, 22, 19, 50).toISOString()

function makeClient(
  overrides: {
    info?: Partial<AppInfo>
    reset?: AppResetResult
    open?: (fresh: boolean) => OpenTestProfileResult
  } = {}
): BuildClient & {
  resetKeepKeys: ReturnType<typeof vi.fn>
  openTestProfile: ReturnType<typeof vi.fn>
} {
  return {
    getInfo: vi.fn(() =>
      Promise.resolve({
        name: 'CiteFox',
        version: '0.11.0',
        build: { commit: '1787acc', builtAt: BUILT },
        ...overrides.info
      })
    ),
    resetKeepKeys: vi.fn(() => Promise.resolve<AppResetResult>(overrides.reset ?? { ok: true })),
    openTestProfile: vi.fn((request: { fresh: boolean }) =>
      Promise.resolve(
        overrides.open?.(request.fresh) ?? { ok: true as const, alreadyOpen: false as const }
      )
    )
  }
}

function Panel(): React.JSX.Element {
  return <TestingPanel actions={useBuildActions()} />
}

function renderChip(client: BuildClient, withPanel = false): ReturnType<typeof render> {
  return render(
    <BuildToolsHost client={client}>
      <header>
        <BuildChip />
      </header>
      {withPanel ? <Panel /> : null}
    </BuildToolsHost>
  )
}

async function openMenu(view: ReturnType<typeof render>): Promise<HTMLElement> {
  const chip = await view.findByRole('button', { name: /v0\.11\.0/ })
  fireEvent.click(chip)
  return view.getByRole('menu', { name: 'Build menu' })
}

beforeEach(() => {
  window.history.replaceState(null, '', '#/settings')
})

afterEach(() => {
  cleanup()
  resetAppInfoCache()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('BuildChip', () => {
  it('shows the version, build date and commit, and opens the build menu', async () => {
    const view = renderChip(makeClient())
    const chip = await view.findByRole('button', { name: /v0\.11\.0/ })
    expect(chip.textContent).toContain('v0.11.0 · Oct 22 · 1787acc')
    expect(chip.getAttribute('aria-haspopup')).toBe('menu')
    expect(chip.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(chip)
    const menu = view.getByRole('menu', { name: 'Build menu' })
    expect(chip.getAttribute('aria-expanded')).toBe('true')
    expect(menu.textContent).toContain('CiteFox 0.11.0')
    expect(menu.textContent).toContain('Build 1787acc · Oct 22, 2026, 7:50 PM')
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent)
    ).toEqual([
      'Copy build info',
      'Reset CiteFox, keep my keys…',
      'Test as a new user',
      'Start a fresh test profile…'
    ])
    expect(view.queryByText('Test profile')).toBeNull()
  })

  it('closes on Escape and gives focus back to the chip', async () => {
    const view = renderChip(makeClient())
    const menu = await openMenu(view)
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(view.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(view.getByRole('button', { name: /v0\.11\.0/ }))
  })

  it('copies the build info and shows a green tick for about 1.5 s', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const view = renderChip(makeClient())
    const menu = await openMenu(view)
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Copy build info' }))
    const copied = await within(menu).findByRole('menuitem', { name: 'Copied' })
    expect(copied.className).toContain('ui-menu-ok')
    const text = (writeText.mock.calls[0] as unknown as [string])[0]
    expect(text).toContain('CiteFox 0.11.0')
    expect(text).toContain('Commit: 1787acc')
    expect(text).toContain('OS: ')
    await waitFor(
      () => expect(within(menu).getByRole('menuitem', { name: 'Copy build info' })).toBeTruthy(),
      { timeout: 2500 }
    )
  })

  it('Test as a new user opens the test window and says so', async () => {
    const client = makeClient({
      open: (() => {
        let open = false
        return () => {
          const result = { ok: true as const, alreadyOpen: open }
          open = true
          return result
        }
      })()
    })
    const view = renderChip(client)
    let menu = await openMenu(view)
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Test as a new user' }))
    expect(await view.findByText('Test window opened')).toBeTruthy()
    expect(client.openTestProfile).toHaveBeenCalledWith({ fresh: false })
    menu = await openMenu(view)
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Test as a new user' }))
    expect(await view.findByText('Test window is already open')).toBeTruthy()
  })

  it('shows a refusal from main as the toast', async () => {
    const view = renderChip(
      makeClient({ open: () => ({ ok: false, message: 'Close the test window first.' }) })
    )
    const menu = await openMenu(view)
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Test as a new user' }))
    expect(await view.findByText('Close the test window first.')).toBeTruthy()
  })

  it('in a test profile: badge, test reset label, no test-window items', async () => {
    const view = renderChip(makeClient({ info: { testProfile: true } }))
    const chip = await view.findByRole('button', { name: /Test profile/ })
    expect(chip.getAttribute('data-test-profile')).toBe('true')
    fireEvent.click(chip)
    const menu = view.getByRole('menu', { name: 'Build menu' })
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent)
    ).toEqual(['Copy build info', 'Reset this test profile, keep its keys…'])
  })
})

describe('reset dialog', () => {
  it('opens on the URL, lists what goes and what stays, and Cancel closes it', async () => {
    const client = makeClient()
    const view = renderChip(client)
    const menu = await openMenu(view)
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Reset CiteFox, keep my keys…' }))
    const dialog = await view.findByRole('alertdialog', { name: 'Reset CiteFox, keep my keys?' })
    expect(window.location.hash).toBe('#/settings?dialog=reset')
    expect(dialog.textContent).toContain('Projects, pages and questions')
    expect(dialog.textContent).toContain('Background check and login item')
    expect(dialog.textContent).toContain('Your API keys')
    expect(dialog.textContent).toContain('A backup of the current data is kept in the data folder.')
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    expect(document.activeElement).toBe(cancel)
    expect(within(dialog).getByRole('button', { name: 'Reset and restart' }).className).toContain(
      'danger'
    )
    fireEvent.click(cancel)
    await waitFor(() => expect(view.queryByRole('alertdialog')).toBeNull())
    expect(window.location.hash).toBe('#/settings')
    expect(client.resetKeepKeys).not.toHaveBeenCalled()
  })

  it('a pasted URL opens the dialog; Escape closes it', async () => {
    window.history.replaceState(null, '', '#/settings?dialog=reset')
    const view = renderChip(makeClient())
    const dialog = await view.findByRole('alertdialog', { name: 'Reset CiteFox, keep my keys?' })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(view.queryByRole('alertdialog')).toBeNull())
  })

  it('resets and shows Restarting…', async () => {
    window.history.replaceState(null, '', '#/settings?dialog=reset')
    const client = makeClient()
    const view = renderChip(client)
    const dialog = await view.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset and restart' }))
    expect(await within(dialog).findByRole('status')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Restarting…' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(
      true
    )
    expect(client.resetKeepKeys).toHaveBeenCalledTimes(1)
  })

  it('shows a refusal inline and stays open', async () => {
    window.history.replaceState(null, '', '#/settings?dialog=reset')
    const view = renderChip(
      makeClient({ reset: { ok: false, message: 'CiteFox could not reset (test run).' } })
    )
    const dialog = await view.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset and restart' }))
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'CiteFox could not reset (test run).'
    )
    expect(within(dialog).getByRole('button', { name: 'Reset and restart' })).toBeTruthy()
  })

  it('in a test profile, resets the test profile', async () => {
    window.history.replaceState(null, '', '#/settings?dialog=reset')
    const view = renderChip(makeClient({ info: { testProfile: true } }))
    const dialog = await view.findByRole('alertdialog', {
      name: 'Reset this test profile, keep its keys?'
    })
    expect(dialog.textContent).toContain('Your real data and keys are not touched.')
  })
})

describe('fresh test profile dialog', () => {
  it('clears and opens the test window, then closes with a toast', async () => {
    const client = makeClient()
    const view = renderChip(client)
    const menu = await openMenu(view)
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Start a fresh test profile…' }))
    const dialog = await view.findByRole('alertdialog', { name: 'Start a fresh test profile?' })
    expect(window.location.hash).toBe('#/settings?dialog=fresh-test')
    expect(dialog.textContent).toContain('Your real data and keys are not touched.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear and open' }))
    expect(await view.findByText('Fresh test window opened')).toBeTruthy()
    expect(view.queryByRole('alertdialog')).toBeNull()
    expect(client.openTestProfile).toHaveBeenCalledWith({ fresh: true })
  })

  it('keeps the dialog open with the reason when main refuses', async () => {
    window.history.replaceState(null, '', '#/settings?dialog=fresh-test')
    const view = renderChip(
      makeClient({
        open: () => ({ ok: false, message: 'Close the test window first, then start fresh.' })
      })
    )
    const dialog = await view.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear and open' }))
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Close the test window first, then start fresh.'
    )
  })
})

describe('Testing panel (Settings › About)', () => {
  it('runs the same actions as the menu', async () => {
    const client = makeClient()
    const view = renderChip(client, true)
    const panel = await view.findByRole('region', { name: 'Testing' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Open test window' }))
    expect(await view.findByText('Test window opened')).toBeTruthy()
    fireEvent.click(within(panel).getByRole('button', { name: 'Reset…' }))
    expect(
      await view.findByRole('alertdialog', { name: 'Reset CiteFox, keep my keys?' })
    ).toBeTruthy()
    // One host, one dialog, even with the chip and the panel both on screen.
    expect(view.getAllByRole('alertdialog')).toHaveLength(1)
  })

  it('the toast closes by itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const view = renderChip(makeClient(), true)
    const panel = await view.findByRole('region', { name: 'Testing' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Open test window' }))
    expect(await view.findByText('Test window opened')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(6000)
    })
    expect(view.queryByText('Test window opened')).toBeNull()
  })
})
