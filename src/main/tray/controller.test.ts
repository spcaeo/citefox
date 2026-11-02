import type { CheckDueResult } from '@shared/domain'
import type { CheckFinishedNotice } from '@shared/ipc'
import { describe, expect, test } from 'vitest'
import { desktopNoticeFor } from '../email/compose'
import { passSummaryCopy, WALL_CLOCK_TICK_MS } from './controller'
import { trayNoticeCopy } from './menu'
import { createRig, finished, flush, lastCheck, menu, queue } from './controller.test-helper'

describe('tray controller', () => {
  test('startup marks the tray running, applies login, and waits for the next wall-clock tick after the due pass', async () => {
    const rig = createRig()
    await flush()
    expect(rig.calls.setRunning).toHaveBeenCalledWith(true)
    expect(rig.calls.checkDue).toHaveBeenCalledTimes(1)
    expect(rig.host.login.length).toBeGreaterThan(0)
    expect(rig.host.login.every((open) => open)).toBe(true)
    expect(rig.sleeps).toEqual([WALL_CLOCK_TICK_MS])
    expect(rig.host.icon.tooltip).toBe('Running · 14 pages due today')
    rig.stop()
  })

  test('opening the menu rebuilds the status line from the queue and the schedule', async () => {
    const rig = createRig()
    await flush()
    rig.state.menu = menu({ pagesDueToday: 2, pagesWaiting: 9 })
    rig.state.status = queue({ state: 'paused_today', waiting: 3 })
    rig.state.schedule = { ...rig.state.schedule, startAtLogin: false }
    rig.host.icon.open()
    expect(rig.host.icon.tooltip).toBe('Paused for today · 3 pages waiting')
    expect(rig.host.icon.menu.find((item) => item.id === 'pause')?.label).toBe('Resume checks')
    expect(rig.host.login.at(-1)).toBe(false)
    rig.stop()
  })

  test('each menu action calls the queue, the window, or quit', async () => {
    const rig = createRig({
      menu: menu({
        pagesDueToday: 14,
        pagesWaiting: 4,
        lastChecks: [lastCheck()]
      })
    })
    await flush()
    rig.calls.checkDue.mockClear()
    rig.host.icon.click('open')
    expect(rig.host.wins[0]?.shown).toBe(1)
    expect(rig.host.wins[0]?.focused).toBe(1)
    expect(rig.host.wins[0]?.hashes).toEqual([])

    rig.host.icon.click('ask')
    expect(rig.host.wins[0]?.hashes).toEqual(['#/ask'])
    rig.host.icon.click('settings')
    expect(rig.host.wins[0]?.hashes).toEqual(['#/ask', '#/settings'])
    rig.host.icon.click('last-0')
    expect(rig.host.wins[0]?.hashes.at(-1)).toBe('#/pages/page-1/results')

    rig.host.icon.click('pause')
    expect(rig.calls.pause).toHaveBeenCalledWith({ scope: 'today' })
    expect(rig.host.icon.tooltip).toBe('Paused for today · 4 pages waiting')

    rig.host.icon.click('pause')
    expect(rig.calls.resume).toHaveBeenCalledOnce()

    rig.host.icon.click('check-due')
    await flush()
    expect(rig.calls.checkDue).toHaveBeenCalledTimes(1)

    rig.host.icon.click('quit')
    expect(rig.host.quits).toBe(1)
    expect(rig.host.wins[0]?.requestClose()).toBe(false)
    rig.stop()
  })

  test('a second due pass waits while the first is still running', async () => {
    let release: (result: CheckDueResult) => void = () => undefined
    const rig = createRig({
      checkDue: () =>
        new Promise((resolve) => {
          release = resolve
        })
    })
    await flush()
    expect(rig.calls.checkDue).toHaveBeenCalledTimes(1)
    rig.host.icon.click('check-due')
    expect(rig.calls.checkDue).toHaveBeenCalledTimes(1)
    release({ started: true, jobIds: [], pages: 0 })
    await flush()
    expect(rig.sleeps).toEqual([WALL_CLOCK_TICK_MS])
    rig.stop()
  })

  test('pause all does not start a pass until Resume checks', async () => {
    const rig = createRig({ status: queue({ state: 'paused_all', waiting: 2 }) })
    await flush()
    expect(rig.calls.checkDue).not.toHaveBeenCalled()
    expect(rig.host.icon.tooltip).toBe('Paused · 2 pages waiting')
    rig.host.icon.click('pause')
    await flush()
    expect(rig.calls.resume).toHaveBeenCalledOnce()
    expect(rig.calls.checkDue).toHaveBeenCalledTimes(1)
    rig.stop()
  })

  test('with autoDue off the loop starts no due pass, but Check due pages now still runs one', async () => {
    const rig = createRig({ autoDue: false, resolveSleeps: true })
    await flush()
    expect(rig.calls.checkDue).not.toHaveBeenCalled()
    expect(rig.sleeps.length).toBeGreaterThan(0)
    rig.host.icon.click('check-due')
    await flush()
    expect(rig.calls.checkDue).toHaveBeenCalledTimes(1)
    rig.stop()
  })

  test('a failed due pass is logged and the loop still waits for the next tick', async () => {
    const rig = createRig()
    rig.calls.checkDue.mockRejectedValueOnce(new Error('cap'))
    await flush()
    expect(rig.logger.error).toHaveBeenCalledWith(
      'CiteFox could not run due checks',
      expect.any(Error)
    )
    expect(rig.sleeps).toEqual([WALL_CLOCK_TICK_MS])
    rig.stop()
  })

  test('closing the window hides it until quit', async () => {
    const rig = createRig()
    const win = rig.host.wins[0]
    if (win === undefined) throw new Error('missing window')
    expect(win.requestClose()).toBe(true)
    expect(win.hidden).toBe(true)
    rig.host.activate()
    expect(win.hidden).toBe(false)
    expect(win.focused).toBeGreaterThan(0)
    expect(rig.host.created).toBe(0)
    rig.host.quit()
    expect(win.requestClose()).toBe(false)
    rig.stop()
  })

  test('Open CiteFox creates a window when none is open', async () => {
    const rig = createRig({ windows: false })
    rig.host.icon.click('open')
    await flush()
    expect(rig.host.created).toBe(1)
    expect(rig.host.wins[0]?.shown).toBe(1)
    rig.host.activate()
    expect(rig.host.created).toBe(1)
    rig.stop()
  })

  test('a finished check shows the desktop notice and View results opens the page', async () => {
    const rig = createRig()
    const notice = finished()
    const copy = trayNoticeCopy(notice)
    rig.tray.notifyCheckFinished(notice)
    expect(copy).toEqual({
      title: 'Check finished: Text alerts for business',
      body: 'Cited in 3 of 8 AI Overviews (+1). Visibility score 50 (+12). The page changed since the last check.'
    })
    expect(rig.host.notifications).toEqual([
      expect.objectContaining({
        title: copy.title,
        body: copy.body,
        action: 'View results'
      })
    ])
    rig.host.notifications[0]?.onClick()
    expect(rig.host.wins[0]?.hashes.at(-1)).toBe('#/pages/page-1/results')
    rig.stop()
  })

  test('a notice the mockup does not cover uses desktopNoticeFor', () => {
    const rig = createRig()
    const notice = finished({ score: null, scoreChange: null, contentChanged: false })
    rig.tray.notifyCheckFinished(notice)
    expect(rig.host.notifications[0]?.body).toBe(desktopNoticeFor(notice).body)
    rig.stop()
  })

  test('a login launch hides the first show and a manual launch leaves it visible', () => {
    const login = createRig({ launchedAtLogin: true })
    const first = login.host.wins[0]
    first?.show()
    expect(first?.hidden).toBe(true)
    first?.show()
    expect(first?.hidden).toBe(false)
    login.stop()

    const manual = createRig()
    const shown = manual.host.wins[0]
    shown?.show()
    expect(shown?.hidden).toBe(false)
    manual.stop()
  })

  test('an alert opens its hash and respects the project desktop toggle', () => {
    const alert = {
      projectId: 'proj-1',
      title: 'TextBolt reached its search cap',
      body: '100 of 100 searches used.',
      action: 'Open',
      hash: '#/status'
    }
    const rig = createRig()
    rig.tray.notifyAlert(alert)
    expect(rig.host.notifications).toEqual([
      expect.objectContaining({ title: alert.title, body: alert.body, action: 'Open' })
    ])
    rig.host.notifications[0]?.onClick()
    expect(rig.host.wins[0]?.hashes.at(-1)).toBe('#/status')
    rig.stop()

    const off = createRig({ allowDesktop: () => false })
    off.tray.notifyAlert(alert)
    off.tray.notifyAlert({ ...alert, projectId: null })
    expect(off.host.notifications).toHaveLength(1)
    off.stop()
  })

  test('a project with desktop notifications off does not notify', async () => {
    const rig = createRig({ allowDesktop: () => false })
    rig.tray.notifyCheckFinished(finished())
    expect(rig.host.notifications).toEqual([])
    rig.stop()
  })

  test('a notification lookup failure does not notify', async () => {
    const rig = createRig({
      allowDesktop: () => {
        throw new Error('no alerts')
      }
    })
    rig.tray.notifyCheckFinished(finished())
    expect(rig.host.notifications).toEqual([])
    expect(rig.logger.error).toHaveBeenCalledWith(
      'CiteFox could not read notification settings',
      expect.any(Error)
    )
    rig.stop()
  })

  test('a missing tray icon does not mark CiteFox running or swallow the close button', async () => {
    const rig = createRig({ failCreate: true })
    await flush()
    expect(rig.calls.setRunning).not.toHaveBeenCalled()
    expect(rig.calls.checkDue).not.toHaveBeenCalled()
    expect(rig.logger.error).toHaveBeenCalledWith(
      'CiteFox could not create the tray',
      expect.any(Error)
    )
    expect(rig.host.wins[0]?.requestClose()).toBe(false)
    rig.tray.notifyCheckFinished(finished())
    expect(rig.host.notifications).toHaveLength(1)
    rig.stop()
  })

  test('a last check in another project opens through its project route, without a reload', async () => {
    const active = { id: 'proj-2' as string | null }
    const rig = createRig({
      menu: menu({ pagesDueToday: 3, pagesWaiting: 0, lastChecks: [lastCheck()] }),
      activeProject: active
    })
    await flush()
    rig.host.icon.click('last-0')
    await flush()
    expect(active.id).toBe('proj-1')
    // The window switches to the project and opens the page in one step.
    expect(rig.host.wins[0]?.hashes).toEqual(['#/p/proj-1/pages/page-1/results'])

    // Already open: the plain route.
    rig.host.icon.click('last-0')
    await flush()
    expect(rig.host.wins[0]?.hashes.at(-1)).toBe('#/pages/page-1/results')

    // A notice from another project opens the same way.
    active.id = 'proj-9'
    rig.tray.notifyCheckFinished(finished())
    rig.host.notifications.at(-1)?.onClick()
    await flush()
    expect(active.id).toBe(finished().projectId)
    expect(rig.host.wins[0]?.hashes.at(-1)).toBe(
      `#/p/${finished().projectId}/pages/${finished().pageId}/results`
    )
    rig.stop()
  })

  test('the status line opens the pages due, and a new window opens the project route too', async () => {
    const active = { id: 'proj-2' as string | null }
    const rig = createRig({
      windows: false,
      menu: menu({ pagesDueToday: 3, pagesWaiting: 0, lastChecks: [lastCheck()] }),
      activeProject: active
    })
    await flush()
    rig.host.icon.click('last-0')
    await flush()
    expect(active.id).toBe('proj-1')
    expect(rig.host.wins[0]?.hashes).toEqual(['#/p/proj-1/pages/page-1/results'])
    rig.host.icon.click('status')
    await flush()
    expect(rig.host.wins[0]?.hashes.at(-1)).toBe('#/check')
    rig.stop()
  })

  test('open notices add a "decisions waiting" item that opens Status', async () => {
    const notices = { open: 2 }
    const rig = createRig({ notices })
    await flush()
    expect(rig.host.icon.menu.find((entry) => entry.id === 'notices')?.label).toBe(
      '2 decisions waiting for you…'
    )
    rig.host.icon.click('notices')
    await flush()
    expect(rig.host.wins[0]?.hashes.at(-1)).toBe('#/status')
    notices.open = 0
    rig.host.icon.open()
    expect(rig.host.icon.menu.find((entry) => entry.id === 'notices')).toBeUndefined()
    rig.stop()
  })
})

describe('pass summary copy', () => {
  test('agrees in number with the counts', () => {
    const notice = (pageCited: number): CheckFinishedNotice =>
      ({ pageCited }) as unknown as CheckFinishedNotice
    expect(passSummaryCopy([notice(1), notice(0)])).toEqual({
      title: 'CiteFox checked 2 pages',
      body: "1 of 2 pages is cited in AI Overviews. Open CiteFox to see each page's results."
    })
    expect(passSummaryCopy([notice(0)]).title).toBe('CiteFox checked 1 page')
  })
})
