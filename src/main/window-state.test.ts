import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  clampWindowBounds,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  defaultWindowBounds,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  nextSavedBounds,
  readWindowState,
  writeWindowState,
  type DisplayWorkArea,
  type WindowBounds
} from './window-state'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const desktop: DisplayWorkArea = { id: 1, x: 0, y: 0, width: 1920, height: 1080 }
const laptop: DisplayWorkArea = { id: 2, x: 1920, y: 0, width: 1440, height: 900 }
const tiny: DisplayWorkArea = { id: 3, x: 0, y: 0, width: 800, height: 600 }

describe('window state', () => {
  test('defaults to 1280x820 centered, with a 1024x700 minimum when the display allows', () => {
    expect(DEFAULT_WINDOW_WIDTH).toBe(1280)
    expect(DEFAULT_WINDOW_HEIGHT).toBe(820)
    expect(MIN_WINDOW_WIDTH).toBe(1024)
    expect(MIN_WINDOW_HEIGHT).toBe(700)
    expect(defaultWindowBounds(desktop)).toEqual({
      x: 320,
      y: 130,
      width: 1280,
      height: 820,
      maximized: false
    })
    expect(defaultWindowBounds(tiny)).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      maximized: false
    })
  })

  test('restores a visible window and clamps one that sits off every display', () => {
    const visible: WindowBounds = { x: 40, y: 50, width: 1400, height: 900, maximized: false }
    expect(clampWindowBounds(visible, [desktop, laptop])).toEqual(visible)

    const offscreen: WindowBounds = {
      x: -5000,
      y: 200,
      width: 1280,
      height: 820,
      maximized: true
    }
    expect(clampWindowBounds(offscreen, [desktop, laptop])).toEqual({
      ...defaultWindowBounds(desktop),
      maximized: true
    })

    const tooWide: WindowBounds = { x: 10, y: 10, width: 4000, height: 400, maximized: false }
    expect(clampWindowBounds(tooWide, [desktop])).toEqual({
      x: 0,
      y: 10,
      width: 1920,
      height: 700,
      maximized: false
    })

    const hangingOff: WindowBounds = { x: 1800, y: 40, width: 1280, height: 820, maximized: false }
    expect(clampWindowBounds(hangingOff, [desktop]).x).toBe(640)
  })

  test('saves the normal bounds while maximized and restores them from disk', () => {
    const normal: WindowBounds = { x: 12, y: 24, width: 1280, height: 820, maximized: false }
    const maximized = nextSavedBounds(normal, { x: 0, y: 0, width: 1920, height: 1080 }, true)
    expect(maximized).toEqual({ ...normal, maximized: true })
    const restored = nextSavedBounds(maximized, { x: 12, y: 24, width: 1100, height: 760 }, false)
    expect(restored).toEqual({ x: 12, y: 24, width: 1100, height: 760, maximized: false })

    const directory = mkdtempSync(join(tmpdir(), 'citefox-window-'))
    directories.push(directory)
    const file = join(directory, 'window-state.json')
    writeWindowState(file, maximized)
    expect(readWindowState(file)).toEqual(maximized)
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)

    writeFileSync(file, '{')
    expect(readWindowState(file)).toBeNull()
    writeFileSync(file, `${JSON.stringify({ ...normal, note: 'sk-ant-api03-abcdefghijklmnop' })}\n`)
    expect(readWindowState(file)).toBeNull()
    expect(readFileSync(file, 'utf8')).toContain('sk-ant-api03-abcdefghijklmnop')
  })
})
