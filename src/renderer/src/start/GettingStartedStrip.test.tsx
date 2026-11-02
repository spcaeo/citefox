// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { axeViolations } from '../ui/axe.test-helper'
import { fakeStartClient, journey } from './fakeStartClient.test-helper'
import { GettingStartedStrip } from './GettingStartedStrip'
import { stripState } from './stripModel'

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('stripState', () => {
  it('marks Setup done always and the next step current', () => {
    const fresh = journey()
    expect(stripState('setup', fresh)).toBe('done')
    expect(stripState('found', fresh)).toBe('current')
    expect(stripState('plan', fresh)).toBe('todo')
    const planned = journey({ hasPlan: true })
    expect(stripState('found', planned)).toBe('done')
    expect(stripState('plan', planned)).toBe('current')
    const checking = journey({ hasPlan: true, checkStarted: true })
    expect(stripState('plan', checking)).toBe('done')
    expect(stripState('check', checking)).toBe('current')
    expect(stripState('results', checking)).toBe('todo')
    expect(stripState('results', journey({ hasPlan: true, hasResults: true }))).toBe('done')
  })
})

describe('GettingStartedStrip', () => {
  it('links every step to its journey screen and marks the current one', async () => {
    const client = fakeStartClient({ journey: journey({ hasPlan: true }) })
    const view = render(<GettingStartedStrip client={client} projectId="proj-1" revision={0} />)
    const region = await screen.findByRole('region', { name: 'Getting started' })
    const links = Array.from(region.querySelectorAll('a')).map((link) => [
      link.textContent,
      link.getAttribute('href')
    ])
    expect(links).toEqual([
      ['Setup (done)', '#/start/setup'],
      ['Your site (done)', '#/start'],
      ['Plan', '#/start/plan'],
      ['First check', '#/start/check'],
      ['First results', '#/start/results']
    ])
    expect(screen.getByRole('link', { name: 'Plan' }).getAttribute('aria-current')).toBe('step')
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('hides once dismissed, and stays hidden for that project', async () => {
    const client = fakeStartClient({ journey: journey({ hasPlan: true }) })
    const first = render(<GettingStartedStrip client={client} projectId="proj-1" revision={0} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Hide getting started' }))
    expect(screen.queryByRole('region', { name: 'Getting started' })).toBeNull()
    expect(localStorage.getItem('citefox.gettingStarted.dismissed.proj-1')).toBe('1')
    first.unmount()
    render(<GettingStartedStrip client={client} projectId="proj-1" revision={1} />)
    await waitFor(() => expect(client.statusCalls).toBe(2))
    expect(screen.queryByRole('region', { name: 'Getting started' })).toBeNull()
  })

  it('is not shown for a project set up without the journey', async () => {
    const client = fakeStartClient({ journey: journey() })
    render(<GettingStartedStrip client={client} projectId="proj-1" revision={0} />)
    await waitFor(() => expect(client.statusCalls).toBe(1))
    expect(screen.queryByRole('region', { name: 'Getting started' })).toBeNull()
  })

  it('is gone once the first results exist, or with no project', async () => {
    const done = fakeStartClient({ journey: journey({ hasPlan: true, hasResults: true }) })
    render(<GettingStartedStrip client={done} projectId="proj-1" revision={0} />)
    await waitFor(() => expect(done.statusCalls).toBe(1))
    expect(screen.queryByRole('region', { name: 'Getting started' })).toBeNull()
    cleanup()
    const none = fakeStartClient({ journey: journey({ hasPlan: true }) })
    render(<GettingStartedStrip client={none} projectId={null} revision={0} />)
    expect(none.statusCalls).toBe(0)
    expect(screen.queryByRole('region', { name: 'Getting started' })).toBeNull()
  })

  it('asks again when the engine revision changes', async () => {
    const client = fakeStartClient({ journey: journey({ hasPlan: true }) })
    const view = render(<GettingStartedStrip client={client} projectId="proj-1" revision={0} />)
    await screen.findByRole('region', { name: 'Getting started' })
    view.rerender(<GettingStartedStrip client={client} projectId="proj-1" revision={1} />)
    await waitFor(() => expect(client.statusCalls).toBe(2))
  })
})
