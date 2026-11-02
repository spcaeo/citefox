// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BuildClient } from '../buildMenu/buildClient'
import { BuildToolsHost } from '../buildMenu/BuildToolsHost'
import { getThemePreference, setThemePreference } from '../theme/themeStore'
import { ThemeMenu } from './ThemeMenu'

const CLIENT: BuildClient = {
  getInfo: () =>
    Promise.resolve({
      name: 'CiteFox',
      version: '0.12.0',
      build: { commit: 'fae9b4e', builtAt: new Date(2026, 9, 24, 9, 30).toISOString() }
    }),
  resetKeepKeys: () => Promise.resolve({ ok: true }),
  openTestProfile: () => Promise.resolve({ ok: true, alreadyOpen: false })
}

afterEach(() => {
  cleanup()
  setThemePreference('system')
  vi.restoreAllMocks()
})

function renderMenu(
  updateSettings: () => Promise<never> = () => Promise.resolve({} as never)
): ReturnType<typeof render> {
  return render(
    <BuildToolsHost client={CLIENT}>
      <ThemeMenu client={{ updateSettings }} />
    </BuildToolsHost>
  )
}

function open(view: ReturnType<typeof render>): HTMLElement {
  fireEvent.click(view.getByRole('button', { name: 'Theme' }))
  return view.getByRole('menu', { name: 'Theme' })
}

describe('the top bar theme switch', () => {
  it('starts on sepia, the default', () => {
    expect(getThemePreference()).toBe('sepia')
  })

  it('shows the current choice and lists Light, Dark, Sepia and System with a tick on it', async () => {
    setThemePreference('system')
    const view = renderMenu()
    const button = view.getByRole('button', { name: 'Theme' })
    expect(button.getAttribute('data-tip')).toBe('Theme: System')
    const menu = open(view)
    const names = [...menu.querySelectorAll('[role="menuitemradio"]')].map((item) => [
      item.getAttribute('aria-label'),
      item.getAttribute('aria-checked')
    ])
    expect(names).toEqual([
      ['Theme: Light', 'false'],
      ['Theme: Dark', 'false'],
      ['Theme: Sepia', 'false'],
      ['Theme: System', 'true']
    ])
    expect((await axe.run(view.container)).violations).toEqual([])
  })

  it('switches at once with one pick, saves it, and closes', async () => {
    const updateSettings = vi.fn(() => Promise.resolve({} as never))
    const view = renderMenu(updateSettings)
    fireEvent.click(within(open(view)).getByRole('menuitemradio', { name: 'Theme: Dark' }))
    expect(getThemePreference()).toBe('dark')
    expect(updateSettings).toHaveBeenCalledWith({ theme: 'dark' })
    await waitFor(() => expect(view.queryByRole('menu', { name: 'Theme' })).toBeNull())
    expect(view.getByRole('button', { name: 'Theme' }).getAttribute('data-tip')).toBe('Theme: Dark')
  })

  it('puts the theme back when saving fails', async () => {
    const view = renderMenu(() => Promise.reject(new Error('disk full')))
    fireEvent.click(within(open(view)).getByRole('menuitemradio', { name: 'Theme: Light' }))
    await waitFor(() => expect(getThemePreference()).toBe('system'))
  })
})
