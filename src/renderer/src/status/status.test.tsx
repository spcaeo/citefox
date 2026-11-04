// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  ApiKeyMetadata,
  DeliveryRecord,
  DueList,
  EmailSettings,
  ProjectUsageReport,
  QueueStatus
} from '@shared/domain'
import type { CheckJob, ConnectionsOverview, ProjectList, StatusCapsule } from '@shared/ipc'
import { StatusCapsule as CapsuleButton } from '../components/StatusCapsule'
import { createMockAssistClient } from '../assist/client'
import { createMockUsageClient } from '../usage/client'
import { StatusScreen } from '.'
import { openStatusAt } from './focus'
import { serpUsageSummary } from '../keys/serpUsage'
import type { StatusSource } from './source'
import {
  emailState,
  failedSends,
  keySearchesLeft,
  serpKeyLines,
  sharedTotals,
  usagePace
} from './utils/model'

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '#/')
})

const NOW = new Date(2026, 9, 19, 14, 0)

const CLIENTS = {
  assistClient: createMockAssistClient(),
  usageClient: createMockUsageClient()
}

function key(patch: Partial<ApiKeyMetadata>): ApiKeyMetadata {
  return {
    id: 'k',
    provider: 'serpapi',
    name: 'My plan',
    keychainRef: 'ref',
    hint: 'ab12',
    rotationOrder: 1,
    cap: null,
    on: true,
    projectIds: [],
    state: 'ok',
    lastReason: null,
    serpapiUsage: { used: 1240, planLimit: 5000, plan: 'Developer' },
    usedThisMonth: 1240,
    ...patch
  }
}

const KEYS: ApiKeyMetadata[] = [
  key({ id: 'mine' }),
  key({
    id: 'backup',
    name: 'Backup',
    rotationOrder: 2,
    serpapiUsage: { used: 18, planLimit: 250, plan: null },
    usedThisMonth: 18
  }),
  key({
    id: 'client',
    name: 'Acme key',
    rotationOrder: 3,
    projectIds: ['acme'],
    cap: 1000,
    serpapiUsage: { used: 312, planLimit: 5000, plan: null },
    usedThisMonth: 312,
    state: 'warning',
    lastReason: 'rate_limited'
  }),
  key({ id: 'jina', provider: 'jina', name: 'Jina', serpapiUsage: null }),
  key({ id: 'claude-api', provider: 'anthropic', name: 'My key', serpapiUsage: null })
]

const LEFT = 3760 + 232 + 688

const OVERVIEW: ConnectionsOverview = {
  serpapiRotation: 'in_order',
  keys: KEYS,
  serpapi: 'warning',
  claudeCode: 'ok',
  jina: 'ok',
  youtube: 'off',
  claudeCheckup: {
    binaryPath: '/usr/local/bin/claude',
    version: '2.1.0',
    login: 'logged_in',
    plan: 'Claude Max',
    roundTrip: 'ok',
    durationMs: 900,
    resolvedModel: null,
    ready: true,
    message: 'Ready',
    nextStep: null,
    rows: {
      binary: { state: 'ok', detail: 'Found' },
      login: { state: 'ok', detail: 'Logged in' },
      roundTrip: { state: 'ok', detail: 'Answered' }
    }
  } as ConnectionsOverview['claudeCheckup'],
  searchesLeft: LEFT,
  issueCount: 1
}

const CAPSULE: StatusCapsule = {
  searchesLeft: LEFT,
  issueCount: 1,
  serpapi: 'warning',
  claudeCode: 'ok',
  jina: 'ok',
  youtube: 'off'
}

const QUEUE: QueueStatus = {
  state: 'running',
  running: 6,
  waiting: 8,
  claudeConcurrency: 2,
  claudeInFlight: 1,
  trayRunning: true,
  headlessJob: false,
  nextRunAt: '2026-10-20T09:00:00.000Z',
  pagesDue: 14,
  keys: [],
  projects: [
    {
      projectId: 'textbolt',
      name: 'TextBolt',
      used: 1258,
      cap: null,
      capRule: 'pause',
      dedicatedKeyId: null,
      paused: false
    },
    {
      projectId: 'acme',
      name: 'Acme Clinics',
      used: 312,
      cap: 1000,
      capRule: 'notify',
      dedicatedKeyId: 'client',
      paused: false
    }
  ]
}

const EMAIL: EmailSettings = {
  mode: 'smtp',
  accounts: [
    {
      id: 'gmail',
      provider: 'gmail',
      fromName: 'Me',
      fromAddress: 'you@textbolt.com',
      replyTo: null,
      host: 'smtp.gmail.com',
      port: 587,
      security: 'starttls',
      username: 'you',
      keychainRef: 'ref',
      isDefault: true,
      lastTestAt: '2026-10-01T09:00:00.000Z',
      lastTestOk: true,
      lastTestMessage: null,
      lastTestNextStep: null,
      usedFor: []
    }
  ]
}

function delivery(patch: Partial<DeliveryRecord>): DeliveryRecord {
  return {
    id: 'd',
    scheduleId: 's',
    at: '2026-10-10T09:00:00.000Z',
    trigger: 'weekly',
    projectId: 'textbolt',
    recipients: ['you@textbolt.com'],
    outcome: 'sent',
    ok: true,
    reason: null,
    nextStep: null,
    occurrenceKey: 'k',
    ...patch
  }
}

const DELIVERIES: DeliveryRecord[] = [
  delivery({ id: 'old-fail', at: '2026-10-01T09:00:00.000Z', outcome: 'failed', ok: false }),
  delivery({ id: 'sent' }),
  delivery({
    id: 'fail',
    at: '2026-10-12T09:00:00.000Z',
    trigger: 'after_check',
    outcome: 'failed',
    ok: false,
    reason: 'SMTP sign-in failed'
  }),
  delivery({ id: 'test', at: '2026-10-15T09:00:00.000Z', trigger: 'account_test' })
]

function job(patch: Partial<CheckJob>): CheckJob {
  return {
    id: 'job',
    projectId: 'textbolt',
    pageIds: ['pricing'],
    marketIds: null,
    promptIds: null,
    status: 'running',
    startedAt: '2026-10-19T12:00:00.000Z',
    finishedAt: null,
    done: 4,
    total: 20,
    searchesUsed: 9,
    searchesMax: 80,
    brandSearchesMax: 0,
    monthUsed: null,
    monthLimit: null,
    runIds: [],
    markets: [],
    steps: [],
    message: null,
    nextStep: null,
    ...patch
  }
}

const JOBS: CheckJob[] = [
  job({ id: 'j1' }),
  job({ id: 'j2', projectId: 'acme', pageIds: ['clinic', 'about'] }),
  job({ id: 'j3', status: 'finished' })
]

function duePage(pageId: string, projectId = 'textbolt'): DueList['pages'][number] {
  return {
    projectId,
    pageId,
    label: `/${pageId}`,
    title: null,
    url: `https://textbolt.com/${pageId}`,
    marketIds: ['us'],
    dueAt: '2026-10-19T09:00:00.000Z',
    intervalDays: 14,
    reason: 'scheduled',
    promptIds: null
  }
}

const DUE: DueList = {
  day: '2026-10-19',
  pages: [duePage('pricing'), duePage('features'), duePage('clinic', 'acme')]
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
    },
    {
      id: 'acme',
      name: 'Acme Clinics',
      slug: 'acme',
      domain: 'acme.com',
      dbPath: '/tmp/a.db',
      clientName: 'Acme',
      status: 'active'
    }
  ]
}

function usageRow(
  projectId: string,
  name: string,
  searches: number,
  sharedSearches: number,
  dedicatedKeyId: string | null
): ProjectUsageReport['projects'][number] {
  return {
    projectId,
    name,
    clientName: null,
    status: 'active',
    source: 'shared',
    searches,
    sharedSearches,
    cap: null,
    capRule: 'pause',
    allowance: null,
    dedicatedKeyId,
    sharePercent: null,
    claudeCalls: 12,
    claudeLabel: 'Claude Code'
  }
}

const USAGE: ProjectUsageReport = {
  month: '2026-10',
  projects: [
    usageRow('textbolt', 'TextBolt', 1258, 1258, null),
    usageRow('acme', 'Acme Clinics', 312, 0, 'client')
  ],
  sharedUsed: 1258,
  sharedCapacity: 5250,
  unassigned: null,
  dedicatedUsed: 312,
  claudeCalls: 24
}

function source(overrides: Partial<StatusSource> = {}): StatusSource & {
  pauses: string[]
  push: (queue: QueueStatus) => void
} {
  const pauses: string[] = []
  const listeners: ((queue: QueueStatus) => void)[] = []
  return {
    pauses,
    push: (queue) => listeners.forEach((listener) => listener(queue)),
    'status:getCapsule': async () => CAPSULE,
    'connections:getOverview': async () => OVERVIEW,
    'settings:get': async () =>
      ({
        settings: { claudeProvider: 'claude-code', jinaMode: 'fallback' },
        dataDirectory: '/tmp'
      }) as Awaited<ReturnType<StatusSource['settings:get']>>,
    'queue:getStatus': async () => QUEUE,
    'queue:pause': async (request) => {
      pauses.push(request.scope)
      return { ...QUEUE, state: request.scope === 'all' ? 'paused_all' : 'paused_today' }
    },
    'queue:resume': async () => {
      pauses.push('resume')
      return QUEUE
    },
    'queue:status': (listener) => {
      listeners.push(listener)
      return () => undefined
    },
    'email:getSettings': async () => EMAIL,
    'deliveries:list': async () => DELIVERIES,
    'checks:listActive': async () => JOBS,
    'schedule:listDue': async () => DUE,
    'projectSettings:usage': async () => USAGE,
    'projects:list': async () => PROJECTS,
    ...overrides
  }
}

/** Opens a Status tab and returns the region named `region` on it. */
function openTab(
  view: ReturnType<typeof render>,
  tab: string | RegExp,
  region: string
): HTMLElement {
  fireEvent.click(view.getByRole('tab', { name: tab }))
  return view.getByRole('region', { name: region })
}

describe('status model', () => {
  it('sums per-key searches left to the capsule number', () => {
    const lefts = KEYS.map(keySearchesLeft).filter((value): value is number => value !== null)
    expect(lefts.reduce((sum, value) => sum + value, 0)).toBe(CAPSULE.searchesLeft)
    expect(keySearchesLeft(key({ state: 'unchecked' }))).toBeNull()
    expect(keySearchesLeft(key({ on: false }))).toBeNull()
    const lines = serpKeyLines(KEYS)
    expect(lines.map((line) => line.name)).toEqual(['My plan', 'Backup', 'Acme key'])
    expect(sharedTotals(lines)).toEqual({ used: 1258, limit: 5250 })
  })

  it('projects the month at the current pace', () => {
    expect(usagePace(QUEUE, NOW)).toMatchObject({
      used: 1570,
      dayOfMonth: 19,
      daysInMonth: 31,
      projected: Math.round((1570 / 19) * 31)
    })
  })

  it('keeps only report failures after the last sent report', () => {
    expect(failedSends(DELIVERIES).map((record) => record.id)).toEqual(['fail'])
    expect(emailState(EMAIL.accounts, DELIVERIES)).toBe('warning')
    expect(emailState(EMAIL.accounts, [delivery({})])).toBe('ok')
    expect(emailState([], [])).toBe('off')
  })
})

describe('StatusScreen', () => {
  it('shows each connection, the queue, email, and project usage', async () => {
    const view = render(<StatusScreen {...CLIENTS} source={source()} now={NOW} />)
    const summary = await view.findByRole('region', { name: 'Summary' })
    expect(within(summary).getByText(LEFT.toLocaleString('en-US'))).toBeTruthy()
    // One summary row per service; the keys themselves are on the Connections screen.
    const services = view.getByRole('grid', { name: 'Connections' })
    const serp = within(services).getByRole('link', { name: 'SerpApi' })
    expect(serp.getAttribute('href')).toBe('#/connections?tab=serpapi')
    expect(
      within(services).getByRole('button', {
        name: '1,570 of 6,250 searches used this month (CiteFox caps and SerpApi accounts): show each key'
      })
    ).toBeTruthy()
    expect(services.textContent).toContain('resets Nov 1')
    expect(services.textContent).toContain('Last problem: SerpApi returned 429')
    expect(services.textContent).not.toContain('Client key · Acme Clinics')
    for (const [name, tab] of [
      ['Claude', 'claude'],
      ['Jina Reader', 'jina'],
      ['YouTube Data API', 'youtube']
    ] as const) {
      expect(within(services).getByRole('link', { name }).getAttribute('href')).toBe(
        `#/connections?tab=${tab}`
      )
    }
    expect(view.getByRole('link', { name: 'Manage in Connections' })).toBeTruthy()
    const claudeUsage = view.getByRole('region', { name: 'Calls and tokens' })
    expect(
      await within(claudeUsage).findByText(
        'CiteFox AI calls today 31 · tokens this month 1.3M in / 196.4k out'
      )
    ).toBeTruthy()
    const connections = await axe.run(view.container, { rules: { region: { enabled: false } } })
    expect(connections.violations).toEqual([])
    const email = openTab(view, 'Email', 'Email')
    expect(within(email).getByText(/After-check email failed/)).toBeTruthy()
    expect(within(email).getByRole('link', { name: 'Fix in Email setup' })).toBeTruthy()
    const checks = openTab(view, 'Checks', 'Checks')
    expect(within(checks).getByText(/Tray running · background job off/)).toBeTruthy()
    const usage = openTab(view, /^Usage/, "This month's searches by project")
    expect(within(usage).getByText('312 of 1,000')).toBeTruthy()
    expect(within(usage).getByText('1,258 · no cap')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'AI actions' }))
    expect(view.getByRole('menuitem', { name: /Explain my usage/ })).toBeTruthy()
    expect(view.getByRole('menuitem', { name: /Explain these errors/ })).toBeTruthy()
    fireEvent.keyDown(view.getByRole('menuitem', { name: /Explain my usage/ }), { key: 'Escape' })
    const result = await axe.run(view.container, { rules: { region: { enabled: false } } })
    expect(result.violations).toEqual([])
  })

  it('explains usage in place without a project', async () => {
    const view = render(<StatusScreen {...CLIENTS} source={source()} now={NOW} />)
    fireEvent.click(await view.findByRole('button', { name: 'AI actions' }))
    fireEvent.click(view.getByRole('menuitem', { name: /Explain my usage/ }))
    const panel = await view.findByRole('region', { name: 'Explain my usage' })
    expect(await within(panel).findByText(/about 66 a day/)).toBeTruthy()
    expect(within(panel).getByText(/no searches/)).toBeTruthy()
  })

  it('keeps the tab in the URL and opens it from a link', async () => {
    window.history.replaceState(null, '', '#/status')
    const first = render(<StatusScreen {...CLIENTS} source={source()} now={NOW} />)
    fireEvent.click(await first.findByRole('tab', { name: 'Checks' }))
    expect(window.location.hash).toBe('#/status?tab=checks')
    fireEvent.click(first.getByRole('tab', { name: 'Connections' }))
    expect(window.location.hash).toBe('#/status')
    cleanup()
    window.history.replaceState(null, '', '#/status?tab=email')
    const again = render(<StatusScreen {...CLIENTS} source={source()} now={NOW} />)
    const email = await again.findByRole('tab', { name: 'Email' })
    expect(email.getAttribute('aria-selected')).toBe('true')
  })

  it('pauses and resumes checks and follows queue pushes', async () => {
    const fake = source()
    const view = render(<StatusScreen {...CLIENTS} source={fake} now={NOW} />)
    fireEvent.click(await view.findByRole('tab', { name: 'Checks' }))
    fireEvent.click(await view.findByRole('button', { name: 'Pause all checks' }))
    expect(await view.findByText('All checks paused until you resume.')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Resume checks' }))
    await waitFor(() => expect(view.getByRole('button', { name: 'Pause for today' })).toBeTruthy())
    expect(fake.pauses).toEqual(['all', 'resume'])
    fake.push({ ...QUEUE, running: 0, waiting: 0 })
    const summary = view.getByRole('region', { name: 'Summary' })
    expect(await within(summary).findByText('0 waiting')).toBeTruthy()
  })

  it('names a channel that failed and still draws the rest', async () => {
    const view = render(
      <StatusScreen
        {...CLIENTS}
        source={source({
          'email:getSettings': async () => {
            throw new Error("Error invoking remote method 'email:getSettings': Error: Disk is full")
          }
        })}
        now={NOW}
      />
    )
    const alert = await view.findByRole('alert')
    expect(alert.textContent).toBe('Email: Disk is full')
    expect(view.getByRole('grid', { name: 'Connections' })).toBeTruthy()
    expect(view.queryByRole('region', { name: 'Email' })).toBeNull()
  })
})

describe('status capsule', () => {
  it('links to the Status screen and marks itself current there', () => {
    const view = render(
      <CapsuleButton
        capsule={CAPSULE}
        keys={KEYS}
        checkup={null}
        jinaMode={null}
        open
        onOpenChange={() => undefined}
        current
      />
    )
    const pill = view.getByRole('button', { name: /searches left/ })
    expect(pill.getAttribute('aria-current')).toBe('page')
    const dialog = view.getByRole('dialog', { name: 'Credits and connections' })
    expect(within(dialog).getByRole('link', { name: 'Open Status' }).getAttribute('href')).toBe(
      '#/status'
    )
  })
})

function figureOf(button: HTMLElement): number {
  const figure = button.querySelector('[data-nfr-figure]')
  return Number((figure?.textContent ?? button.textContent ?? '').replace(/[^0-9]/g, ''))
}

function drawerRows(): HTMLElement[] {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"].drill-drawer')
  if (!dialog) throw new Error('drawer is not open')
  return Array.from(dialog.querySelectorAll<HTMLElement>('[data-drill-row]'))
}

describe('status popover drill-downs', () => {
  function popover(
    onOpenChange: (open: boolean) => void = () => undefined
  ): ReturnType<typeof render> {
    return render(
      <div>
        <button type="button">Elsewhere</button>
        <CapsuleButton
          capsule={CAPSULE}
          keys={KEYS}
          checkup={null}
          jinaMode={null}
          open
          onOpenChange={onOpenChange}
        />
      </div>
    )
  }

  it('closes on a route change, a press outside and Escape (top bar popover)', () => {
    const changes: boolean[] = []
    const view = popover((open) => changes.push(open))
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(changes).toEqual([false])
    fireEvent.mouseDown(view.getByRole('button', { name: 'Elsewhere' }))
    expect(changes).toEqual([false, false])
    fireEvent.keyDown(view.getByRole('dialog', { name: 'Credits and connections' }), {
      key: 'Escape'
    })
    expect(changes).toEqual([false, false, false])
  })

  it('adds up every SerpApi key, like Status and Settings', () => {
    const view = popover()
    const dialog = view.getByRole('dialog', { name: 'Credits and connections' })
    const summary = serpUsageSummary(KEYS)
    expect(summary).toEqual({
      used: 1570,
      limit: 6250,
      left: LEFT,
      counted: 3,
      keys: 3,
      citefoxOnly: false,
      accountOnly: false,
      plan: { used: 1570, limit: 10250 }
    })
    expect(
      within(dialog).getByRole('img', {
        name: '1,570 of 6,250 searches used this month (CiteFox caps and SerpApi accounts)'
      })
    ).toBeTruthy()
    expect(within(dialog).getByText(LEFT.toLocaleString('en-US'))).toBeTruthy()
    const keys = within(dialog).getByRole('list', { name: 'SerpApi keys' })
    expect(within(keys).getAllByRole('link')).toHaveLength(3)
  })

  it('keeps CiteFox’s budget apart from a shared SerpApi account (live run)', () => {
    // The key is shared with other traffic: SerpApi reports 161,522 of 250,000 for the
    // whole account. CiteFox's budget is 60 and CiteFox counted 52, so 8 are left.
    const live = key({
      id: 'live',
      name: 'SerpApi',
      cap: 60,
      usedThisMonth: 52,
      serpapiUsage: { used: 161_522, planLimit: 250_000, plan: 'Volume Plan' }
    })
    const capsule = { ...CAPSULE, searchesLeft: 8 }
    const view = render(
      <CapsuleButton
        capsule={capsule}
        keys={[live]}
        checkup={null}
        jinaMode={null}
        open
        onOpenChange={() => undefined}
      />
    )
    const dialog = view.getByRole('dialog', { name: 'Credits and connections' })
    expect(
      within(dialog).getByRole('img', { name: '52 of 60 searches used by CiteFox this month' })
    ).toBeTruthy()
    expect(dialog.textContent).toContain(
      'SerpApi plan: 161,522 of 250,000 used this month, other tools on the key included'
    )
    expect(dialog.textContent).not.toContain('161,522 of 60')
    expect(keySearchesLeft(live)).toBe(8)
  })

  it('closes when a link or chip opens another screen, and on an outside press', () => {
    const calls: boolean[] = []
    const view = popover((open) => calls.push(open))
    const dialog = view.getByRole('dialog', { name: 'Credits and connections' })
    fireEvent.click(within(dialog).getByRole('link', { name: /^My plan: / }))
    fireEvent.click(within(dialog).getByRole('link', { name: 'All connections' }))
    fireEvent.click(within(dialog).getByRole('link', { name: 'Manage keys' }))
    expect(calls).toEqual([false, false, false])
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'SerpApi: Warning. Show on Status' })
    )
    expect(window.location.hash).toBe('#/status')
    fireEvent.mouseDown(within(dialog).getByRole('heading', { name: 'SerpApi' }))
    expect(calls).toHaveLength(4)
    fireEvent.mouseDown(view.getByRole('button', { name: 'Elsewhere' }))
    expect(calls).toHaveLength(5)
  })

  it('opens the issue list from "N issues"', () => {
    window.location.hash = ''
    const view = popover()
    fireEvent.click(view.getByRole('button', { name: '1 issue' }))
    expect(window.location.hash).toBe('#/status')
  })
})

describe('Status drill-downs', () => {
  it('every KPI opens what it counts and the totals match (NFR-14)', async () => {
    const view = render(<StatusScreen {...CLIENTS} source={source()} now={NOW} />)
    const summary = await view.findByRole('region', { name: 'Summary' })

    const issues = await within(summary).findByRole('button', { name: /open issue/ })
    expect(issues.tagName).toBe('BUTTON')
    expect(figureOf(issues)).toBe(CAPSULE.issueCount)
    fireEvent.click(issues)
    expect(drawerRows()).toHaveLength(CAPSULE.issueCount)
    expect(view.getByRole('dialog').textContent).toContain('SerpApi returned 429')
    fireEvent.click(view.getAllByRole('button', { name: 'Close' })[0] as HTMLElement)

    const running = within(summary).getByRole('button', {
      name: /running: show the running checks/
    })
    expect(figureOf(running)).toBe(2)
    fireEvent.click(running)
    expect(drawerRows()).toHaveLength(2)
    fireEvent.click(view.getAllByRole('button', { name: 'Close' })[0] as HTMLElement)

    const due = within(summary).getByRole('button', { name: /^3 pages due/ })
    expect(figureOf(due)).toBe(DUE.pages.length)
    fireEvent.click(due)
    expect(drawerRows()).toHaveLength(DUE.pages.length)
    fireEvent.click(view.getAllByRole('button', { name: 'Close' })[0] as HTMLElement)

    const left = within(summary).getByRole('button', { name: /searches left/ })
    fireEvent.click(left)
    const dialog = view.getByRole('dialog')
    const lefts = Array.from(dialog.querySelectorAll('[data-drill-row]'))
      .map((row) => row.textContent ?? '')
      .filter((text) => !text.includes('—'))
    expect(lefts).toHaveLength(3)
    expect(dialog.textContent).toContain(`${LEFT.toLocaleString('en-US')} left`)
  })

  it('opens a drawer row with Enter; a page in another project opens through its project route', async () => {
    window.location.hash = ''
    const view = render(<StatusScreen {...CLIENTS} source={source()} now={NOW} />)
    const summary = await view.findByRole('region', { name: 'Summary' })
    fireEvent.click(within(summary).getByRole('button', { name: /^3 pages due/ }))
    const rows = drawerRows()
    fireEvent.keyDown(rows[0] as HTMLElement, { key: 'Enter' })
    expect(window.location.hash).toBe('#/pages/pricing/results')
    // The new route has no drawer: it closes when the route change lands.
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    fireEvent.click(within(summary).getByRole('button', { name: /^3 pages due/ }))
    fireEvent.keyDown(drawerRows()[2] as HTMLElement, { key: 'Enter' })
    expect(window.location.hash).toBe('#/p/acme/pages/clinic/results')
  })

  it('splits a project count by key', async () => {
    const view = render(<StatusScreen {...CLIENTS} source={source()} now={NOW} />)
    await view.findByRole('grid', { name: 'Connections' })
    const usage = openTab(view, /^Usage/, "This month's searches by project")
    fireEvent.click(within(usage).getByRole('button', { name: /TextBolt searches this month/ }))
    expect(view.getByRole('dialog').textContent).toContain('TextBolt · 1,258 searches this month')
    expect(
      within(usage).getByRole('link', { name: 'TextBolt: open Project settings' })
    ).toBeTruthy()
    expect(within(usage).getByRole('link', { name: 'Acme Clinics: open Projects' })).toBeTruthy()
  })

  it('lists sent reports and failed sends with their reasons', async () => {
    const view = render(<StatusScreen {...CLIENTS} source={source()} now={NOW} />)
    fireEvent.click(await view.findByRole('tab', { name: 'Email' }))
    const email = await view.findByRole('region', { name: 'Email' })
    const failed = within(email).getByRole('button', { name: /failed send/ })
    expect(figureOf(failed)).toBe(1)
    fireEvent.click(failed)
    expect(drawerRows()).toHaveLength(1)
    fireEvent.click(view.getAllByRole('button', { name: 'Close' })[0] as HTMLElement)
    const sent = within(email).getByRole('button', { name: /report/ })
    expect(figureOf(sent)).toBe(1)
    expect(
      within(email).getByRole('link', { name: /you@textbolt\.com.*edit in Email setup/ })
    ).toBeTruthy()
    expect(within(email).getByRole('button', { name: 'Copy you@textbolt.com' })).toBeTruthy()
  })

  it('opens the issue list when the popover asks for it', async () => {
    const view = render(<StatusScreen {...CLIENTS} source={source()} now={NOW} />)
    await view.findByRole('region', { name: 'Summary' })
    openStatusAt('issues')
    await waitFor(() => expect(drawerRows()).toHaveLength(CAPSULE.issueCount))
  })
})
