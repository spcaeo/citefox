// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it } from 'vitest'
import type { Notice, PageSummary } from '@shared/domain'
import type {
  NoticeList,
  ProjectList,
  SetupProgress,
  SetupStatus,
  StatusCapsule
} from '@shared/ipc'
import { buildPermissionsSnapshot } from '@shared/permissions'
import { StatusCapsule as CapsuleButton } from '../components/StatusCapsule'
import { PermissionsSummary } from '../permissions/PermissionsSummary'
import { PermissionsContext, type PermissionsContextValue } from '../ui/permissionsContext'
import { createMockAssistClient } from '../assist/client'
import { createMockUsageClient } from '../usage/client'
import { StatusScreen } from '.'
import type { LiveSource } from './live/source'
import type { StatusSource } from './source'

afterEach(cleanup)

const CAPSULE: StatusCapsule = {
  searchesLeft: 100,
  issueCount: 0,
  serpapi: 'ok',
  claudeCode: 'ok',
  jina: 'off',
  youtube: 'off'
}

const NOTICE: Notice = {
  id: 'n1',
  kind: 'search_cap',
  projectId: 'textbolt',
  projectName: 'TextBolt',
  title: 'TextBolt reached its search cap',
  body: 'Checks are waiting. Choose what happens this month.',
  actions: [
    { id: 'allow_10_month', label: 'Continue this month at 10% over', primary: true },
    { id: 'wait_reset', label: 'Wait for the reset', primary: false }
  ],
  createdAt: '2026-10-19T10:00:00.000Z',
  resolvedAt: null,
  resolution: null
}

function page(id: string, projectId = 'textbolt'): PageSummary {
  return {
    id,
    projectId,
    url: `https://textbolt.com/${id}`,
    title: null,
    label: `/${id}`,
    folder: null,
    status: 'setting_up',
    setupStep: 'read',
    intervalDays: 14,
    samples: 1,
    promptCount: 0,
    defaultMarketId: null,
    pinned: false,
    score: null,
    promptSetVersion: null
  } as PageSummary
}

const SETUP: SetupStatus = {
  builtAt: '2026-10-19T12:00:00.000Z',
  paused: false,
  pagesPerHour: 12,
  waiting: 2,
  running: 0,
  doneToday: 3,
  failed: 1,
  failures: [
    {
      projectId: 'textbolt',
      projectName: 'TextBolt',
      pageId: 'broken',
      url: 'https://textbolt.com/broken',
      label: '/broken',
      step: 'read',
      reason: 'The page returned 404.',
      nextStep: 'Check the URL.',
      attempts: 4,
      failedAt: '2026-10-19T11:00:00.000Z',
      retryAt: null
    },
    {
      projectId: 'textbolt',
      projectName: 'TextBolt',
      pageId: 'slow',
      url: 'https://textbolt.com/slow',
      label: '/slow',
      step: 'prompts',
      reason: 'Claude timed out.',
      nextStep: null,
      attempts: 1,
      failedAt: '2026-10-19T11:30:00.000Z',
      retryAt: '2026-10-19T11:45:00.000Z'
    }
  ],
  holdReason: null
}

const PROJECTS: ProjectList = {
  activeProjectId: 'textbolt',
  projects: [
    {
      id: 'textbolt',
      name: 'TextBolt',
      slug: 'textbolt',
      domain: 'textbolt.com',
      dbPath: '/tmp/t.db',
      clientName: null,
      status: 'active'
    }
  ]
}

function live(initial: { notices?: readonly Notice[]; setup?: SetupStatus } = {}): LiveSource & {
  calls: { channel: string; request: unknown }[]
  pushNotices: (list: NoticeList) => void
  pushProgress: (progress: SetupProgress) => void
} {
  const calls: { channel: string; request: unknown }[] = []
  const noticeListeners: ((list: NoticeList) => void)[] = []
  const progressListeners: ((progress: SetupProgress) => void)[] = []
  let notices = initial.notices ?? [NOTICE]
  let setup = initial.setup ?? SETUP
  return {
    calls,
    pushNotices: (list) => noticeListeners.forEach((listener) => listener(list)),
    pushProgress: (progress) => progressListeners.forEach((listener) => listener(progress)),
    'notices:list': async () => ({ notices }),
    'notices:resolve': async (request) => {
      calls.push({ channel: 'notices:resolve', request })
      notices = notices.filter((notice) => notice.id !== request.noticeId)
      return {
        notice: { ...NOTICE, resolvedAt: 'now', resolution: request.actionId },
        message: 'Checks for TextBolt continue this month, up to 10% over the cap.'
      }
    },
    'notices:changed': (listener) => {
      noticeListeners.push(listener)
      return () => undefined
    },
    'setup:status': async () => setup,
    'setup:retry': async (request) => {
      calls.push({ channel: 'setup:retry', request })
      return setup
    },
    'setup:pause': async (request) => {
      calls.push({ channel: 'setup:pause', request })
      setup = { ...setup, paused: request.paused }
      return setup
    },
    'setup:setRate': async (request) => {
      calls.push({ channel: 'setup:setRate', request })
      setup = { ...setup, pagesPerHour: request.pagesPerHour }
      return setup
    },
    'setup:progress': (listener) => {
      progressListeners.push(listener)
      return () => undefined
    },
    'pages:list': async () => ({
      foundPageCount: 4,
      pages: [page('one'), page('broken'), page('slow')]
    }),
    'projects:list': async () => PROJECTS
  }
}

function capsule(source: LiveSource, open = true): ReturnType<typeof render> {
  return render(
    <CapsuleButton
      capsule={CAPSULE}
      keys={[]}
      checkup={null}
      jinaMode={null}
      open={open}
      onOpenChange={() => undefined}
      live={source}
    />
  )
}

describe('notices in the capsule and popover', () => {
  it('badges the capsule and answers a notice in the popover', async () => {
    const source = live()
    const view = capsule(source)
    const pill = await view.findByRole('button', { name: /1 decision waiting for you/ })
    expect(pill.querySelector('.sp-badge')?.textContent).toBe('1')
    const dialog = view.getByRole('dialog', { name: 'Credits and connections' })
    const list = within(dialog).getByRole('list', { name: 'Decisions waiting for you' })
    expect(within(list).getByText('TextBolt reached its search cap')).toBeTruthy()
    fireEvent.click(within(list).getByRole('button', { name: 'Continue this month at 10% over' }))
    await waitFor(() =>
      expect(source.calls).toContainEqual({
        channel: 'notices:resolve',
        request: { noticeId: 'n1', actionId: 'allow_10_month' }
      })
    )
    expect(await within(dialog).findByText(/continue this month, up to 10% over/)).toBeTruthy()
    await waitFor(() => expect(pill.querySelector('.sp-badge')).toBeNull())
    expect(pill.getAttribute('aria-label')).toBe('100 searches left this month · Setup done')
  })

  it('follows notices:changed pushes', async () => {
    const source = live({ notices: [] })
    const view = capsule(source, false)
    const pill = view.getByRole('button', { name: /^100 searches left this month/ })
    expect(pill.querySelector('.sp-badge')).toBeNull()
    await act(async () => undefined)
    await act(async () => source.pushNotices({ notices: [NOTICE, { ...NOTICE, id: 'n2' }] }))
    expect(pill.querySelector('.sp-badge')?.textContent).toBe('2')
    expect(pill.getAttribute('aria-label')).toContain('2 decisions waiting for you')
  })

  it('shows a setup line while pages are set up and opens the Page setup card', async () => {
    window.location.hash = ''
    const source = live({ notices: [], setup: { ...SETUP, running: 2 } })
    const view = capsule(source)
    const dialog = view.getByRole('dialog', { name: 'Credits and connections' })
    expect(await within(dialog).findByText(/Setting up 2 pages · 2 waiting/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Page setup' }))
    expect(window.location.hash).toBe('#/status')
  })
})

function statusSource(): StatusSource {
  const reject = async (): Promise<never> => {
    throw new Error('not in this test')
  }
  return {
    'status:getCapsule': async () => CAPSULE,
    'connections:getOverview': reject,
    'settings:get': reject,
    'queue:getStatus': reject,
    'queue:pause': reject,
    'queue:resume': reject,
    'queue:status': () => () => undefined,
    'email:getSettings': reject,
    'deliveries:list': reject,
    'checks:listActive': reject,
    'schedule:listDue': reject,
    'projectSettings:usage': reject,
    'projects:list': async () => PROJECTS
  }
}

function rows(): HTMLElement[] {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"].drill-drawer')
  if (!dialog) throw new Error('drawer is not open')
  return Array.from(dialog.querySelectorAll<HTMLElement>('[data-drill-row]'))
}

function figure(button: HTMLElement): number {
  return Number(button.querySelector('[data-nfr-figure]')?.textContent ?? 'NaN')
}

function screen(source: LiveSource): ReturnType<typeof render> {
  return render(
    <StatusScreen
      source={statusSource()}
      live={source}
      assistClient={createMockAssistClient()}
      usageClient={createMockUsageClient()}
      now={new Date(2026, 9, 19, 14, 0)}
    />
  )
}

/** Page setup sits on the Checks tab. */
async function setupCard(view: ReturnType<typeof render>): Promise<HTMLElement> {
  fireEvent.click(await view.findByRole('tab', { name: 'Checks' }))
  return view.findByRole('region', { name: 'Page setup' })
}

describe('Status: notices and page setup', () => {
  it('answers a notice on the Status screen', async () => {
    const source = live()
    const view = screen(source)
    const card = await view.findByRole('region', { name: 'Decisions waiting for you' })
    fireEvent.click(within(card).getByRole('button', { name: /^Actions for / }))
    fireEvent.click(view.getByRole('menuitem', { name: 'Wait for the reset' }))
    await waitFor(() =>
      expect(source.calls).toContainEqual({
        channel: 'notices:resolve',
        request: { noticeId: 'n1', actionId: 'wait_reset' }
      })
    )
  })

  it('setup counts open their pages and the totals match (NFR-14)', async () => {
    window.location.hash = ''
    const source = live({ notices: [] })
    const view = screen(source)
    const card = await setupCard(view)
    const waiting = await within(card).findByRole('button', { name: /^2 waiting: show the pages/ })
    expect(figure(waiting)).toBe(SETUP.waiting)
    fireEvent.click(waiting)
    expect(rows()).toHaveLength(SETUP.waiting)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Retry')
    fireEvent.click(view.getAllByRole('button', { name: 'Close' })[0] as HTMLElement)

    const failed = within(card).getByRole('button', { name: /^1 failed: show the pages/ })
    expect(figure(failed)).toBe(SETUP.failed)
    fireEvent.click(failed)
    expect(rows()).toHaveLength(SETUP.failed)
    fireEvent.keyDown(rows()[0] as HTMLElement, { key: 'Enter' })
    expect(window.location.hash).toBe('#/pages/broken/results')

    // Done today was not seen finishing in this window: plain text, never a drawer that disagrees.
    expect(within(card).queryByRole('button', { name: /done today/ })).toBeNull()
    expect(within(card).getByText('3')).toBeTruthy()

    // A page starting makes Running drill, with the same total.
    await act(async () =>
      source.pushProgress({
        projectId: 'textbolt',
        pageId: 'one',
        step: 'profile',
        state: 'running',
        message: 'Writing the buyer profile.',
        status: { ...SETUP, running: 1, waiting: 1 }
      })
    )
    const running = await within(card).findByRole('button', { name: /^1 running: show the pages/ })
    fireEvent.click(running)
    expect(rows()).toHaveLength(1)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Buyer profile')
  })

  it('with the runner page lists, every setup count drills, Done today included (NFR-14)', async () => {
    window.location.hash = ''
    const ref = (id: string): NonNullable<SetupStatus['pages']>['waiting'][number] => ({
      projectId: 'textbolt',
      projectName: 'TextBolt',
      pageId: id,
      url: `https://textbolt.com/${id}`,
      label: `/${id}`
    })
    const setup: SetupStatus = {
      ...SETUP,
      running: 1,
      waiting: 1,
      pages: {
        waiting: [ref('two')],
        running: [ref('one')],
        doneToday: [ref('d1'), ref('d2'), ref('d3')],
        failed: [ref('broken')]
      }
    }
    const view = screen(live({ notices: [], setup }))
    const card = await setupCard(view)
    for (const [name, total] of [
      [/^1 waiting: show the pages/, 1],
      [/^1 running: show the pages/, 1],
      [/^3 done today: show the pages/, 3],
      [/^1 failed: show the pages/, 1]
    ] as const) {
      const button = await within(card).findByRole('button', { name })
      expect(figure(button)).toBe(total)
      fireEvent.click(button)
      expect(rows()).toHaveLength(total)
      fireEvent.click(view.getAllByRole('button', { name: 'Close' })[0] as HTMLElement)
    }
    fireEvent.click(within(card).getByRole('button', { name: /^3 done today/ }))
    fireEvent.keyDown(rows()[1] as HTMLElement, { key: 'Enter' })
    expect(window.location.hash).toBe('#/pages/d2/results')
  })

  it('retries, pauses and sets the hourly rate', async () => {
    const source = live({ notices: [] })
    const view = screen(source)
    const card = await setupCard(view)
    expect(within(card).getByText(/The page returned 404/)).toBeTruthy()
    expect(within(card).getByText(/Retries Oct 19/)).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: 'Retry /broken' }))
    await waitFor(() =>
      expect(source.calls).toContainEqual({
        channel: 'setup:retry',
        request: { projectId: 'textbolt', pageIds: ['broken'] }
      })
    )
    fireEvent.click(within(card).getByRole('button', { name: 'Retry all failed' }))
    await waitFor(() =>
      expect(source.calls).toContainEqual({ channel: 'setup:retry', request: {} })
    )
    fireEvent.click(within(card).getByRole('button', { name: 'Pause page setup' }))
    expect(await within(card).findByRole('button', { name: 'Resume page setup' })).toBeTruthy()
    expect(source.calls).toContainEqual({ channel: 'setup:pause', request: { paused: true } })

    const rate = within(card).getByLabelText('Pages an hour')
    fireEvent.change(rate, { target: { value: '500' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))
    expect(await within(card).findByRole('alert')).toBeTruthy()
    expect(source.calls.some((call) => call.channel === 'setup:setRate')).toBe(false)
    fireEvent.change(rate, { target: { value: '30' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(source.calls).toContainEqual({
        channel: 'setup:setRate',
        request: { pagesPerHour: 30 }
      })
    )
    const result = await axe.run(card)
    expect(result.violations).toEqual([])
    // The axe scan is slow when every test file runs at once; the default 5 s limit flaked.
  }, 20_000)
})

describe('one readiness model', () => {
  it('the capsule, its popover and Settings say the same steps left as What CiteFox needs', async () => {
    // No SerpApi key and Claude never checked: 2 required steps left.
    const snapshot = buildPermissionsSnapshot({
      platform: 'darwin',
      now: '2026-10-23T10:00:00.000Z',
      claudeProvider: 'claude-code',
      claudeModel: null,
      checkup: null,
      checkupAt: null,
      keys: [],
      jinaMode: 'fallback',
      keychain: { stored: 0, checkedAt: null, failed: 0 },
      notifications: { supported: true, asked: false, lastResult: null },
      background: { supported: true, installed: false },
      loginItem: { supported: true, enabled: false },
      autoExport: { enabled: 0, unusable: 0 },
      email: { accounts: 0 }
    })
    expect(snapshot.requiredOpen).toBe(2)
    const value = {
      snapshot,
      claude: snapshot.claude,
      loading: false,
      error: null,
      checking: false,
      progress: null,
      steps: {},
      busy: null,
      message: null,
      refresh: async () => snapshot,
      checkClaude: async () => snapshot.claude,
      ensureClaude: async () => snapshot.claude,
      request: async () => null
    } satisfies PermissionsContextValue
    const view = render(
      <PermissionsContext.Provider value={value}>
        <CapsuleButton
          capsule={{ ...CAPSULE, serpapi: 'off', claudeCode: 'unchecked' }}
          keys={[]}
          checkup={null}
          jinaMode={null}
          open
          onOpenChange={() => undefined}
          live={live({ notices: [] })}
        />
        <PermissionsSummary />
      </PermissionsContext.Provider>
    )
    const pill = await view.findByRole('button', { name: /2 steps left\. CiteFox AI/ })
    expect(pill.getAttribute('data-tone')).toBe('warn')
    expect(pill.textContent).not.toContain('0 issues')
    const dialog = view.getByRole('dialog', { name: 'Credits and connections' })
    expect(within(dialog).getByRole('link', { name: '2 required steps left' })).toBeTruthy()
    expect(within(dialog).queryByText('No issues')).toBeNull()
    expect(view.getByText(/2 required steps left$/, { selector: '.pm-summary' })).toBeTruthy()
  })
})
