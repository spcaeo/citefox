// @vitest-environment happy-dom
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { afterOnboardingHash, emptyProjectHash, readStartChoice, saveStartChoice } from './choice'
import { fakeStartClient, journey } from './fakeStartClient.test-helper'
import { useStartRedirect } from './useStartRedirect'

beforeEach(() => {
  localStorage.clear()
  window.location.hash = '#/pages'
})
afterEach(() => localStorage.clear())

describe('how the user chose to start', () => {
  it('finishing onboarding opens the choice screen, not setup', () => {
    expect(afterOnboardingHash()).toBe('#/start/choose')
  })

  it('is remembered per project', () => {
    expect(readStartChoice('p1')).toBeNull()
    saveStartChoice('p1', 'self')
    saveStartChoice('p2', 'autopilot')
    expect(readStartChoice('p1')).toBe('self')
    expect(readStartChoice('p2')).toBe('autopilot')
    saveStartChoice('p1', 'autopilot')
    expect(readStartChoice('p1')).toBe('autopilot')
  })

  it('ignores anything else in storage', () => {
    localStorage.setItem('citefox.startChoice.p1', 'maybe')
    expect(readStartChoice('p1')).toBeNull()
  })

  it('sends an empty project to the choice screen, or to what was chosen', () => {
    expect(emptyProjectHash(null, false)).toBe('#/start/choose')
    expect(emptyProjectHash('autopilot', false)).toBe('#/start')
    expect(emptyProjectHash('self', false)).toBe('#/add')
    expect(emptyProjectHash('self', true)).toBe('#/start/setup')
  })
})

describe('useStartRedirect', () => {
  const landing = { kind: 'section', section: 'pages' } as const

  it('an empty project with no choice lands on "How do you want to start?"', async () => {
    const client = fakeStartClient({ journey: journey({ projectId: 'p1', empty: true }) })
    renderHook(() => useStartRedirect({ location: landing, projectId: 'p1', ready: true, client }))
    await waitFor(() => expect(window.location.hash).toBe('#/start/choose'))
  })

  it('"I\'ll choose myself" lands on the chooser next time', async () => {
    saveStartChoice('p1', 'self')
    const client = fakeStartClient({ journey: journey({ projectId: 'p1', empty: true }) })
    renderHook(() => useStartRedirect({ location: landing, projectId: 'p1', ready: true, client }))
    await waitFor(() => expect(window.location.hash).toBe('#/add'))
  })

  it('leaves projects with pages alone', async () => {
    const client = fakeStartClient({ journey: journey({ projectId: 'p1', empty: false }) })
    renderHook(() => useStartRedirect({ location: landing, projectId: 'p1', ready: true, client }))
    await waitFor(() => expect(client.statusCalls).toBe(1))
    expect(window.location.hash).toBe('#/pages')
  })
})
