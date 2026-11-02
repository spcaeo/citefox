// @vitest-environment happy-dom
import { cleanup, render, waitFor } from '@testing-library/react'
import type { AppInfo } from '@shared/ipc'
import { TEST_PROFILE_UNAVAILABLE } from '@shared/permissions'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BuildToolsHost, resetAppInfoCache } from '../buildMenu'
import { AppScheduleSection } from './SchedulePanel'

afterEach(() => {
  cleanup()
  resetAppInfoCache()
})

const SCHEDULE = {
  startAtLogin: true,
  catchUpAfterSleep: true,
  checkWhenClosed: true,
  dailyCheckTime: '09:00'
}

function renderSchedule(info: AppInfo): ReturnType<typeof render> {
  const client = {
    getInfo: () => Promise.resolve(info),
    resetKeepKeys: () => Promise.resolve({ ok: true as const }),
    openTestProfile: () => Promise.resolve({ ok: true as const, alreadyOpen: false })
  }
  return render(
    <BuildToolsHost client={client}>
      <AppScheduleSection app={SCHEDULE} onPatch={vi.fn(() => Promise.resolve())} />
    </BuildToolsHost>
  )
}

describe('Schedule in a test profile', () => {
  it('turns off start at login and background checks with the reason', async () => {
    const view = renderSchedule({ name: 'CiteFox', version: '0.11.0', testProfile: true })
    const login = view.getByRole('switch', { name: /Start CiteFox at login/ })
    const closed = view.getByRole('switch', { name: 'Also check when CiteFox is closed' })
    await waitFor(() => expect(login.hasAttribute('disabled')).toBe(true))
    expect(closed.hasAttribute('disabled')).toBe(true)
    expect(login.getAttribute('aria-checked')).toBe('false')
    expect(view.getAllByText(TEST_PROFILE_UNAVAILABLE)).toHaveLength(2)
    // Catch up after sleep is still the user's choice.
    expect(
      view
        .getByRole('switch', { name: 'Catch up on missed checks after sleep' })
        .hasAttribute('disabled')
    ).toBe(false)
  })

  it('leaves them alone in the real profile', async () => {
    const view = renderSchedule({ name: 'CiteFox', version: '0.11.0', testProfile: false })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const login = view.getByRole('switch', { name: /Start CiteFox at login/ })
    expect(login.hasAttribute('disabled')).toBe(false)
    expect(login.getAttribute('aria-checked')).toBe('true')
    expect(view.queryByText(TEST_PROFILE_UNAVAILABLE)).toBeNull()
  })
})
