import { readFileSync } from 'node:fs'
import { describe, expect, test, vi } from 'vitest'
import { createLogger } from '../logging/logger'
import {
  acquirePrimaryInstance,
  createCheckDueLaunchRequest,
  finishCheckDuePass,
  handleSecondInstance,
  noteCheckDueSecondInstance,
  type CheckDueRelaunchApp,
  type FocusableWindow
} from './index'

describe('single instance', () => {
  test('the lock is refused, so quit is called and the startup continuation does not run', () => {
    const quit = vi.fn()
    const start = vi.fn()
    const granted = acquirePrimaryInstance({
      requestSingleInstanceLock: () => false,
      quit
    })
    if (granted) start()
    expect(granted).toBe(false)
    expect(quit).toHaveBeenCalledTimes(1)
    expect(start).not.toHaveBeenCalled()
  })

  test('the lock is granted, so startup proceeds', () => {
    const quit = vi.fn()
    const start = vi.fn()
    const granted = acquirePrimaryInstance({
      requestSingleInstanceLock: () => true,
      quit
    })
    if (granted) start()
    expect(granted).toBe(true)
    expect(quit).not.toHaveBeenCalled()
    expect(start).toHaveBeenCalledTimes(1)
  })

  test('a second instance with a minimised window gets restore, show and focus', () => {
    const calls: string[] = []
    handleSecondInstance(['citefox'], () => window(true, calls))
    expect(calls).toEqual(['restore', 'show', 'focus'])
  })

  test('a second instance with a visible window gets show and focus', () => {
    const calls: string[] = []
    handleSecondInstance(['citefox'], () => window(false, calls))
    expect(calls).toEqual(['show', 'focus'])
  })

  test('a second instance with no window does nothing and does not throw', () => {
    const getWindow = vi.fn(() => undefined)
    expect(() => handleSecondInstance(['citefox'], getWindow)).not.toThrow()
    expect(getWindow).toHaveBeenCalledTimes(1)
  })

  test('a second instance whose argv has --check-due does not focus', () => {
    const getWindow = vi.fn((): FocusableWindow => {
      throw new Error('focused')
    })
    expect(() => handleSecondInstance(['citefox', '--check-due'], getWindow)).not.toThrow()
    expect(getWindow).not.toHaveBeenCalled()
  })

  test('a normal launch during --check-due relaunches without the flag, before exit', () => {
    const launch = createCheckDueLaunchRequest()
    const app = fakeApp()
    noteCheckDueSecondInstance(launch, ['/usr/bin/citefox'])
    finishCheckDuePass(app, ['citefox', '--check-due'], launch, 2)
    expect(app.relaunch).toHaveBeenCalledTimes(1)
    expect(app.relaunch).toHaveBeenCalledWith({ args: ['citefox'] })
    expect(app.exit).toHaveBeenCalledTimes(1)
    expect(app.exit).toHaveBeenCalledWith(2)
    const relaunchOrder = app.relaunch.mock.invocationCallOrder[0] ?? 0
    const exitOrder = app.exit.mock.invocationCallOrder[0] ?? 0
    expect(relaunchOrder).toBeGreaterThan(0)
    expect(relaunchOrder).toBeLessThan(exitOrder)
  })

  test('does not relaunch when no normal launch was requested', () => {
    const app = fakeApp()
    finishCheckDuePass(app, ['citefox', '--check-due'], createCheckDueLaunchRequest(), 0)
    expect(app.relaunch).not.toHaveBeenCalled()
    expect(app.exit).toHaveBeenCalledWith(0)
  })

  test('a thrown relaunch still exits once with the original pass code', () => {
    const launch = createCheckDueLaunchRequest()
    noteCheckDueSecondInstance(launch, ['citefox'])
    const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz'
    const lines: string[] = []
    const log = createLogger({
      write: (_level, line) => {
        lines.push(line)
      }
    })
    const app = fakeApp()
    app.relaunch.mockImplementation(() => {
      throw new Error(`relaunch failed ${secret}`)
    })
    expect(() => finishCheckDuePass(app, ['citefox', '--check-due'], launch, 2, log)).not.toThrow()
    expect(app.relaunch).toHaveBeenCalledTimes(1)
    expect(app.exit).toHaveBeenCalledTimes(1)
    expect(app.exit).toHaveBeenCalledWith(2)
    const logged = lines.join('\n')
    expect(logged).not.toContain(secret)
    expect(logged).toContain('[REDACTED]')
  })

  test('a second instance that is itself --check-due does not relaunch', () => {
    const launch = createCheckDueLaunchRequest()
    const app = fakeApp()
    noteCheckDueSecondInstance(launch, ['citefox', '--check-due'])
    finishCheckDuePass(app, ['citefox', '--check-due'], launch, 1)
    expect(launch.requested).toBe(false)
    expect(app.relaunch).not.toHaveBeenCalled()
    expect(app.exit).toHaveBeenCalledWith(1)
  })

  test('does not import electron', () => {
    const source = readFileSync(new URL('./single-instance.ts', import.meta.url), 'utf8')
    expect(source.includes("from 'electron'")).toBe(false)
  })
})

function fakeApp(): CheckDueRelaunchApp & {
  relaunch: ReturnType<typeof vi.fn<(options?: { args?: string[] }) => void>>
  exit: ReturnType<typeof vi.fn<(code?: number) => void>>
} {
  return {
    relaunch: vi.fn<(options?: { args?: string[] }) => void>(),
    exit: vi.fn<(code?: number) => void>()
  }
}

function window(minimized: boolean, calls: string[]): FocusableWindow {
  return {
    isMinimized: () => minimized,
    restore: () => {
      calls.push('restore')
    },
    show: () => {
      calls.push('show')
    },
    focus: () => {
      calls.push('focus')
    }
  }
}
