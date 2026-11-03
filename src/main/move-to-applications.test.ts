import { describe, expect, test, vi, type Mock } from 'vitest'
import { offerMoveToApplications, type MoveableApp } from './move-to-applications'

function fakeApp(over: Partial<MoveableApp> = {}): MoveableApp & {
  inApplications: ReturnType<typeof vi.fn>
  move: ReturnType<typeof vi.fn>
} {
  const inApplications = vi.fn(() => false)
  const move = vi.fn(() => true)
  return {
    isPackaged: true,
    isInApplicationsFolder: inApplications,
    moveToApplicationsFolder: move,
    inApplications,
    move,
    ...over
  }
}
type Spy = Mock<(message: string, extra?: unknown) => void>
const logger = (): { info: Spy; error: Spy } => ({
  info: vi.fn(),
  error: vi.fn()
})

describe('offerMoveToApplications', () => {
  test('a packaged Mac app outside Applications asks, and tells startup to stop when it moves', () => {
    const app = fakeApp()
    const log = logger()
    expect(offerMoveToApplications(app, { platform: 'darwin', headless: false, logger: log })).toBe(
      true
    )
    expect(app.move).toHaveBeenCalledTimes(1)
    expect(log.info).toHaveBeenCalled()
  })

  test('keeps starting when the person says "Do Not Move"', () => {
    const app = fakeApp()
    app.move.mockReturnValue(false)
    expect(
      offerMoveToApplications(app, { platform: 'darwin', headless: false, logger: logger() })
    ).toBe(false)
  })

  test('does nothing when the app is already in Applications', () => {
    const app = fakeApp()
    app.inApplications.mockReturnValue(true)
    expect(
      offerMoveToApplications(app, { platform: 'darwin', headless: false, logger: logger() })
    ).toBe(false)
    expect(app.move).not.toHaveBeenCalled()
  })

  test.each([
    ['another system', { platform: 'win32' as const }, {}],
    ['a development run', { platform: 'darwin' as const }, { isPackaged: false }],
    ['a background --check-due run', { platform: 'darwin' as const, headless: true }, {}],
    [
      'the opt-out variable',
      { platform: 'darwin' as const, env: { CITEFOX_NO_MOVE_PROMPT: '1' } },
      {}
    ]
  ])('never asks on %s', (_name, options, appOver) => {
    const app = fakeApp(appOver)
    const result = offerMoveToApplications(app, { headless: false, logger: logger(), ...options })
    expect(result).toBe(false)
    expect(app.move).not.toHaveBeenCalled()
  })

  test('a failed move is logged and startup goes on', () => {
    const app = fakeApp()
    app.move.mockImplementation(() => {
      throw new Error('read-only volume')
    })
    const log = logger()
    expect(offerMoveToApplications(app, { platform: 'darwin', headless: false, logger: log })).toBe(
      false
    )
    expect(log.error).toHaveBeenCalled()
  })
})
