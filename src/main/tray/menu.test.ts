import type { QueueStatus, TrayLastCheck, TrayMenu } from '@shared/domain'
import { describe, expect, test, vi } from 'vitest'
import { TRAY_ICON_PNG, TRAY_ICON_PNG_2X } from './icon'
import { buildTrayMenu, lastCheckLabel, msUntilNextLocalDay, resultsHash, statusLine } from './menu'
import type { TrayMenuActions } from './menu'

const NOON = Date.parse('2026-04-20T12:00:00.000Z')

describe('tray menu', () => {
  test('the running menu matches the mockup wording and the scheduler count', () => {
    const actions = fakeActions()
    const built = buildTrayMenu({
      menu: menu({
        pagesDueToday: 14,
        pagesWaiting: 2,
        lastChecks: [
          check('alerts', 'Text alerts for business', 50, 12),
          check('bulk', 'Bulk SMS pricing', 31, -4)
        ]
      }),
      status: queue({ state: 'running', waiting: 9, pagesDue: 1 }),
      actions
    })
    expect(built.tooltip).toBe('Running · 14 pages due today')
    expect(labels(built.items)).toEqual([
      'CiteFox',
      'Running · 14 pages due today',
      '',
      'Last checks',
      'Text alerts for business  50  +12',
      'Bulk SMS pricing  31  \u22124',
      '',
      'Open CiteFox',
      'Ask CiteFox…',
      'Check due pages now',
      'Pause checks for today',
      'Settings…',
      '',
      'Quit CiteFox'
    ])
    expect(built.items.find((item) => item.id === 'brand')?.enabled).toBe(false)
    expect(built.items.find((item) => item.id === 'status')?.enabled).toBe(true)
    click(built.items, 'status')
    expect(actions.openDue).toHaveBeenCalledOnce()
    click(built.items, 'open')
    click(built.items, 'ask')
    click(built.items, 'check-due')
    click(built.items, 'pause')
    click(built.items, 'settings')
    click(built.items, 'quit')
    click(built.items, 'last-0')
    expect(actions.open).toHaveBeenCalledOnce()
    expect(actions.ask).toHaveBeenCalledOnce()
    expect(actions.checkDue).toHaveBeenCalledOnce()
    expect(actions.pauseToday).toHaveBeenCalledOnce()
    expect(actions.resume).not.toHaveBeenCalled()
    expect(actions.settings).toHaveBeenCalledOnce()
    expect(actions.quit).toHaveBeenCalledOnce()
    expect(actions.openCheck).toHaveBeenCalledWith(expect.objectContaining({ pageId: 'alerts' }))
  })

  test('pause for today uses the queue waiting count and offers resume', () => {
    const actions = fakeActions()
    const built = buildTrayMenu({
      menu: menu({ pausedToday: true, pagesDueToday: 14, pagesWaiting: 9 }),
      status: queue({ state: 'paused_today', waiting: 1 }),
      actions
    })
    expect(built.tooltip).toBe('Paused for today · 1 page waiting')
    expect(built.items.find((item) => item.id === 'pause')?.label).toBe('Resume checks')
    click(built.items, 'pause')
    expect(actions.resume).toHaveBeenCalledOnce()
    expect(actions.pauseToday).not.toHaveBeenCalled()
  })

  test('pause all is labeled Paused and still resumes', () => {
    const built = buildTrayMenu({
      menu: menu({ pagesWaiting: 4 }),
      status: queue({ state: 'paused_all', waiting: 2 }),
      actions: fakeActions()
    })
    expect(statusLine(menu(), queue({ state: 'paused_all', waiting: 2 }))).toBe(
      'Paused · 2 pages waiting'
    )
    expect(built.tooltip).toBe('Paused · 2 pages waiting')
    expect(built.items.find((item) => item.id === 'pause')?.label).toBe('Resume checks')
  })

  test('an empty last-checks list and a missing score stay readable', () => {
    const built = buildTrayMenu({
      menu: menu({
        pagesDueToday: 0,
        lastChecks: [check('new', 'New page', null, null)]
      }),
      status: queue({ state: 'running' }),
      actions: fakeActions()
    })
    expect(built.tooltip).toBe('Running · 0 pages due today')
    expect(built.items.find((item) => item.id === 'last-empty')).toBeUndefined()
    expect(lastCheckLabel(check('new', 'New page', null, null))).toBe('New page  No score yet')
    expect(built.items.find((item) => item.id === 'last-0')?.label).toBe('New page  No score yet')
    const empty = buildTrayMenu({
      menu: menu({ pagesDueToday: 1 }),
      status: queue(),
      actions: fakeActions()
    })
    expect(empty.tooltip).toBe('Running · 1 page due today')
    expect(empty.items.find((item) => item.id === 'last-empty')?.label).toBe('No finished checks')
    expect(empty.items.find((item) => item.id === 'last-empty')?.enabled).toBe(false)
  })

  test('a flat change is 0 and the results hash is the renderer page route', () => {
    expect(lastCheckLabel(check('p', 'Alerts', 10, 0))).toBe('Alerts  10  0')
    expect(resultsHash('a/b')).toBe('#/pages/a%2Fb/results')
  })

  test('the next due pass waits until the next local midnight', () => {
    expect(msUntilNextLocalDay(NOON, 'UTC')).toBe(12 * 60 * 60 * 1000)
    expect(msUntilNextLocalDay(NOON, 'America/New_York')).toBe(16 * 60 * 60 * 1000)
    expect(msUntilNextLocalDay(Date.parse('2026-04-21T00:00:00.000Z'), 'UTC')).toBe(
      24 * 60 * 60 * 1000
    )
  })

  test('the tray icon is a 16px PNG with a 32px @2x copy', () => {
    for (const [png, px] of [
      [TRAY_ICON_PNG, 16],
      [TRAY_ICON_PNG_2X, 32]
    ] as const) {
      const bytes = Buffer.from(png)
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      // IHDR width and height.
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([px, px])
    }
  })
})

function fakeActions(): TrayMenuActions {
  return {
    open: vi.fn(),
    ask: vi.fn(),
    checkDue: vi.fn(),
    pauseToday: vi.fn(),
    resume: vi.fn(),
    settings: vi.fn(),
    quit: vi.fn(),
    openCheck: vi.fn(),
    openDue: vi.fn(),
    openNotices: vi.fn()
  }
}

function click(items: readonly { id: string; click?: () => void }[], id: string): void {
  const found = items.find((item) => item.id === id)
  if (found?.click === undefined) throw new Error(`missing click for ${id}`)
  found.click()
}

function labels(items: readonly { label: string }[]): string[] {
  return items.map((item) => item.label)
}

function menu(patch: Partial<TrayMenu> = {}): TrayMenu {
  return {
    pausedToday: false,
    pagesDueToday: 0,
    pagesWaiting: 0,
    lastChecks: [],
    ...patch
  }
}

function queue(patch: Partial<QueueStatus> = {}): QueueStatus {
  return {
    state: 'running',
    running: 0,
    waiting: 0,
    claudeConcurrency: 1,
    claudeInFlight: 0,
    trayRunning: false,
    headlessJob: false,
    nextRunAt: null,
    pagesDue: 0,
    keys: [],
    projects: [],
    ...patch
  }
}

function check(
  pageId: string,
  label: string,
  score: number | null,
  change: number | null
): TrayLastCheck {
  return {
    projectId: 'proj-1',
    pageId,
    label,
    score,
    change,
    finishedAt: '2026-04-20T08:00:00.000Z'
  }
}
