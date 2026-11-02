// @vitest-environment happy-dom
import type { JSX } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CheckProgress, SetupProgress, StartProgress } from '@shared/ipc'
import { axeViolations } from '../ui/axe.test-helper'
import {
  activitySnapshot,
  checkLine,
  ensureActivityFeed,
  MAX_ACTIVITY,
  recordActivity,
  resetActivityFeed,
  setupLine,
  startLine
} from './activity'
import { DrawerLevel } from '../shell/DrawerLevel'
import { useDrawerEntry } from '../shell/drawers'
import { ActivityControl, ActivityDrawer } from './ActivityPanel'
import { activityHref, activityOpenIn } from './activityHash'
import { fakeStartClient } from './fakeStartClient.test-helper'

vi.setConfig({ testTimeout: 30_000 })

beforeEach(() => {
  resetActivityFeed()
  window.location.hash = '#/pages'
})
afterEach(cleanup)

/** The shell's DrawerHost draws the Activity drawer; this is the same wiring. */
function Host(): JSX.Element | null {
  const api = useDrawerEntry('activity')
  if (api === null) return null
  return (
    <DrawerLevel depth={api.depth}>
      <ActivityDrawer onClose={() => api.close()} />
    </DrawerLevel>
  )
}

function renderControl(client = fakeStartClient()): ReturnType<typeof render> {
  return render(
    <>
      <ActivityControl client={client} />
      <Host />
    </>
  )
}

function startProgress(partial: Partial<StartProgress> = {}): StartProgress {
  return {
    projectId: 'proj-1',
    phase: 'running',
    items: [
      {
        id: 'key_pages',
        label: 'Read key pages',
        state: 'running',
        detail: 'Reading /pricing',
        durationMs: null,
        estimateSeconds: 20,
        subItems: [],
        progress: null
      }
    ],
    startedAt: '2026-10-22T10:00:00.000Z',
    elapsedMs: 4000,
    etaSeconds: 40,
    message: null,
    known: {
      pageCount: null,
      sections: [],
      rivals: [],
      buyers: null,
      picked: null,
      pickedPages: [],
      questions: [],
      upNext: []
    },
    ...partial
  }
}

function checkProgress(done: number, total: number): CheckProgress {
  return {
    jobId: 'job-1',
    projectId: 'proj-1',
    pageId: 'topic-1',
    marketId: 'mkt',
    promptId: null,
    sampleNo: null,
    phase: 'search',
    state: 'running',
    detail: '',
    nextStep: null,
    errorCode: null,
    retrySearches: 0,
    done,
    total,
    searchesUsed: done,
    searchesMax: total,
    monthUsed: null,
    monthLimit: null,
    markets: []
  }
}

function setupProgress(state: SetupProgress['state'], step: SetupProgress['step']): SetupProgress {
  const ref = {
    projectId: 'proj-1',
    projectName: 'TextBolt',
    pageId: 'page-1',
    url: 'https://textbolt.com/pricing',
    label: null
  }
  return {
    projectId: 'proj-1',
    pageId: 'page-1',
    step,
    state,
    message: 'CiteFox AI limit reached',
    status: {
      builtAt: '2026-10-22T10:00:00.000Z',
      paused: false,
      pagesPerHour: 12,
      waiting: 0,
      running: 1,
      doneToday: 0,
      failed: 0,
      failures: [],
      holdReason: null,
      pages: { waiting: [], running: [ref], doneToday: [], failed: [] }
    }
  }
}

describe('activity lines', () => {
  it('says what each stream is doing in plain words', () => {
    expect(startLine(startProgress()).text).toBe('Read key pages · Reading /pricing')
    expect(startLine(startProgress({ phase: 'done' }))).toMatchObject({
      text: 'Your site is ready',
      state: 'ok'
    })
    expect(checkLine(checkProgress(6, 10))).toMatchObject({
      text: 'Checked 6 of 10 questions',
      state: 'running'
    })
    expect(checkLine(checkProgress(10, 10)).state).toBe('ok')
    expect(setupLine(setupProgress('running', 'prompts')).text).toBe(
      'Page setup: writing questions for /pricing'
    )
    expect(setupLine(setupProgress('failed', 'profile'))).toMatchObject({
      text: 'Page setup stopped for /pricing: CiteFox AI limit reached',
      state: 'warning'
    })
  })

  it('replaces a running line with the next line of the same key, and caps the feed', () => {
    const client = fakeStartClient()
    let clock = 1000
    ensureActivityFeed(client, () => (clock += 1))
    ensureActivityFeed(client)
    client.push.check(checkProgress(1, 10))
    client.push.check(checkProgress(2, 10))
    client.push.check(checkProgress(10, 10))
    expect(activitySnapshot().map((entry) => entry.text)).toEqual(['Checked 10 of 10 questions'])
    client.push.setup(setupProgress('running', 'read'))
    client.push.setup(setupProgress('done', 'coverage'))
    expect(activitySnapshot()).toHaveLength(2)
    expect(activitySnapshot()[1]?.text).toBe('Page setup done for /pricing')
    for (let index = 0; index < MAX_ACTIVITY + 5; index += 1) {
      recordActivity({
        key: `k${index}`,
        at: index,
        area: 'Topic',
        text: `line ${index}`,
        state: 'ok'
      })
    }
    expect(activitySnapshot()).toHaveLength(MAX_ACTIVITY)
  })
})

describe('activity hash', () => {
  it('opens the Activity drawer on the drawer stack, keeping other query values', () => {
    expect(activityHref('#/pages?view=tracked')).toBe('#/pages?view=tracked&drawer=activity')
    expect(activityHref('#/start')).toBe('#/start?drawer=activity')
    expect(activityOpenIn('#/start?drawer=activity')).toBe(true)
    expect(activityOpenIn('#/start')).toBe(false)
  })
})

describe('ActivityControl', () => {
  it('opens from the button into the URL, lists now and earlier, and closes with Escape', async () => {
    const client = fakeStartClient()
    const view = renderControl(client)
    act(() => {
      client.push.changed(startProgress())
      client.push.check(checkProgress(10, 10))
    })
    const button = screen.getByRole('button', { name: /Activity/ })
    expect(button.textContent).toContain('1 running')
    button.focus()
    fireEvent.click(button)
    await waitFor(() => expect(window.location.hash).toBe('#/pages?drawer=activity'))
    const dialog = await screen.findByRole('dialog', { name: 'Activity' })
    expect(dialog.getAttribute('data-drawer')).toBe('activity')
    expect(
      within(within(dialog).getByRole('list', { name: 'Running now' })).getByText(
        /Read key pages · Reading \/pricing/
      )
    ).toBeTruthy()
    expect(within(dialog).getByRole('list', { name: 'Earlier' }).textContent).toContain(
      'Checked 10 of 10 questions'
    )
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close Activity' }))
    )
    expect(await axeViolations(view.container)).toEqual([])
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(window.location.hash).toBe('#/pages'))
    await waitFor(() => expect(document.activeElement).toBe(button))
  })

  it('opens from a pasted URL and closes with ✕', async () => {
    window.location.hash = '#/start?drawer=activity'
    renderControl()
    const dialog = await screen.findByRole('dialog', { name: 'Activity' })
    expect(screen.getByText('Nothing is running.')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close Activity' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(window.location.hash).toBe('#/start'))
  })

  it('closes on Back', async () => {
    renderControl()
    fireEvent.click(screen.getByRole('button', { name: /Activity/ }))
    expect(await screen.findByRole('dialog', { name: 'Activity' })).toBeTruthy()
    await act(async () => {
      window.history.back()
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(window.location.hash).toBe('#/pages')
  })
})
