// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { CiteFoxApi, OnboardingState } from '@shared/ipc'
import { App } from './App'

const NOT_FINISHED: OnboardingState = {
  finished: false,
  currentStep: 'profile',
  profile: null,
  steps: []
}

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'citefox')
  localStorage.clear()
})

describe('App start-up', () => {
  it('shows an error with Try again when setup cannot be read, then recovers', async () => {
    let calls = 0
    install({
      'onboarding:getState': () => {
        calls += 1
        return calls === 1
          ? Promise.reject(new Error('The database is locked by another CiteFox.'))
          : Promise.resolve(NOT_FINISHED)
      }
    })
    const view = render(<App />)
    const alert = await view.findByRole('alert')
    expect(alert.textContent).toContain('The database is locked by another CiteFox.')
    expect(view.queryByRole('navigation')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Try again' }))
    await waitFor(() => {
      expect(view.queryByRole('button', { name: 'Try again' })).toBeNull()
    })
    expect(calls).toBe(2)
    expect(view.container.textContent).not.toContain('Loading projects')
  })

  it('uses the real API in dev unless the mock is asked for', async () => {
    let calls = 0
    install({
      'onboarding:getState': () => {
        calls += 1
        return Promise.resolve(NOT_FINISHED)
      }
    })
    render(<App />)
    await waitFor(() => {
      expect(calls).toBe(1)
    })
  })
})

describe('Join CiteFox at start-up', () => {
  const account = (enabled: boolean, joined: boolean) => () =>
    Promise.resolve({ enabled, joined, waiting: false, details: null })

  it('comes first when this build registers and the person has not joined', async () => {
    install({
      'account:get': account(true, false),
      'onboarding:getState': () => Promise.resolve(NOT_FINISHED)
    })
    const view = render(<App />)
    expect(await view.findByRole('heading', { name: 'Join CiteFox' })).toBeTruthy()
  })

  it('is skipped once joined, and in a build without a registration address', async () => {
    for (const [enabled, joined] of [
      [true, true],
      [false, false]
    ] as const) {
      let reads = 0
      install({
        'account:get': account(enabled, joined),
        'onboarding:getState': () => {
          reads += 1
          return Promise.resolve(NOT_FINISHED)
        }
      })
      const view = render(<App />)
      await waitFor(() => {
        expect(reads).toBe(1)
      })
      await waitFor(() => {
        expect(view.container.textContent).not.toContain('Loading setup')
      })
      expect(view.queryByRole('heading', { name: 'Join CiteFox' })).toBeNull()
      cleanup()
    }
  })
})

function install(api: Partial<CiteFoxApi>): void {
  const base: Partial<CiteFoxApi> = {
    'app:getInfo': () => Promise.resolve({ name: 'CiteFox', version: '0.1.0' }),
    'settings:get': () => Promise.reject(new Error('not needed')),
    'connections:getOverview': () => Promise.reject(new Error('not needed'))
  }
  Object.defineProperty(window, 'citefox', {
    configurable: true,
    value: { ...base, ...api }
  })
}
