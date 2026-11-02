// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetAppInfoCache } from '../buildMenu/appInfoStore'
import type { BuildClient } from '../buildMenu/buildClient'
import { BuildToolsHost } from '../buildMenu/BuildToolsHost'
import { RELEASES_URL, SettingsMenu } from './SettingsMenu'
import { resetUpdateStore } from '../updates/updateStore'

const CLIENT: BuildClient = {
  getInfo: () =>
    Promise.resolve({
      name: 'CiteFox',
      version: '0.12.0',
      build: { commit: 'fae9b4e', number: 1424, builtAt: '2026-10-24T13:30:00.000Z' }
    }),
  resetKeepKeys: () => Promise.resolve({ ok: true }),
  openTestProfile: () => Promise.resolve({ ok: true, alreadyOpen: false })
}

afterEach(() => {
  cleanup()
  resetAppInfoCache()
  resetUpdateStore()
  window.location.hash = ''
  vi.restoreAllMocks()
})

function renderMenu(
  overrides: Partial<Parameters<typeof SettingsMenu>[0]> = {}
): ReturnType<typeof render> {
  return render(
    <BuildToolsHost client={CLIENT}>
      <SettingsMenu
        searches="31,898 searches left"
        setup="Setup: 1 step left"
        onOpenStatus={() => undefined}
        {...overrides}
      />
    </BuildToolsHost>
  )
}

function open(view: ReturnType<typeof render>): HTMLElement {
  fireEvent.click(view.getByRole('button', { name: 'Settings menu' }))
  return view.getByRole('menu', { name: 'Settings menu' })
}

describe('the ⚙ menu', () => {
  it('lists settings, keys, searches, setup, the version and updates, in that order', async () => {
    const view = renderMenu()
    const menu = open(view)
    await within(menu).findByRole('menuitem', {
      name: /^v0\.12\.0 · build 1424 · Oct 24, 2026 9:30 AM EDT/
    })
    const names = [...menu.querySelectorAll('[role^="menuitem"]')].map(
      (item) => item.getAttribute('aria-label') ?? item.textContent
    )
    expect(names).toEqual([
      'App settings',
      'Connections and keys',
      '31,898 searches left · details',
      'Setup: 1 step left',
      'v0.12.0 · build 1424 · Oct 24, 2026 9:30 AM EDT: copy build info',
      'Check for updates'
    ])
    expect((await axe.run(view.container)).violations).toEqual([])
  })

  it('opens the status popover, the setup list, settings and the releases page', () => {
    const onOpenStatus = vi.fn()
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null)
    const view = renderMenu({ onOpenStatus })
    fireEvent.click(
      within(open(view)).getByRole('menuitem', { name: '31,898 searches left · details' })
    )
    expect(onOpenStatus).toHaveBeenCalledOnce()
    fireEvent.click(within(open(view)).getByRole('menuitem', { name: 'Setup: 1 step left' }))
    expect(window.location.hash).toBe('#/permissions')
    fireEvent.click(within(open(view)).getByRole('menuitem', { name: 'App settings' }))
    expect(window.location.hash).toBe('#/settings')
    fireEvent.click(within(open(view)).getByRole('menuitem', { name: 'Check for updates' }))
    expect(opened).toHaveBeenCalledWith(RELEASES_URL, '_blank', 'noopener,noreferrer')
  })

  it('leaves out the setup line when nothing is left and says so without a search count', () => {
    const view = renderMenu({ setup: null, searches: null })
    const menu = open(view)
    expect(within(menu).queryByRole('menuitem', { name: /^Setup/ })).toBeNull()
    expect(within(menu).getByRole('menuitem', { name: 'Searches left · details' })).toBeTruthy()
  })

  it('Check for updates asks main, says "Up to date", or offers the newer download', async () => {
    const none = {
      available: false,
      latest: null,
      dismissed: false,
      checkedAt: null,
      failed: false
    }
    const url =
      'https://github.com/spcaeo/citefox/releases/download/v0.13.0/CiteFox-Setup-0.13.0-x64.exe'
    let answer: typeof none | Record<string, unknown> = none
    resetUpdateStore({
      get: () => Promise.resolve(none),
      check: () => Promise.resolve(answer as typeof none),
      dismiss: () => Promise.resolve(none)
    })
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)
    const view = renderMenu()
    let menu = open(view)
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Check for updates/ }))
    await waitFor(() => {
      expect(within(menu).getByText('Up to date')).toBeTruthy()
    })
    expect(opened).not.toHaveBeenCalled()
    answer = {
      available: true,
      latest: { version: '0.13.0', build: null, notesUrl: url, downloadUrl: url },
      dismissed: false,
      checkedAt: null,
      failed: false
    }
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Check for updates/ }))
    const download = await within(menu).findByRole('menuitem', { name: 'Download v0.13.0' })
    fireEvent.click(download)
    expect(opened).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer')
    menu = open(view)
    expect(within(menu).getByText('v0.13.0 out')).toBeTruthy()
  })
})
