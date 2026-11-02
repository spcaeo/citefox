import { chmodSync, existsSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { containsSecret } from './logging/redact'
import { atomicWriteFile } from './storage/atomic-file'

export const DEFAULT_WINDOW_WIDTH = 1280
export const DEFAULT_WINDOW_HEIGHT = 820
export const MIN_WINDOW_WIDTH = 1024
export const MIN_WINDOW_HEIGHT = 700

const VISIBLE_MARGIN = 32

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

/** A display work area in desktop coordinates. */
export interface DisplayWorkArea {
  id: number
  x: number
  y: number
  width: number
  height: number
}

export function defaultWindowBounds(display: DisplayWorkArea): WindowBounds {
  const width = fitSize(DEFAULT_WINDOW_WIDTH, MIN_WINDOW_WIDTH, display.width)
  const height = fitSize(DEFAULT_WINDOW_HEIGHT, MIN_WINDOW_HEIGHT, display.height)
  return {
    x: display.x + Math.max(0, Math.floor((display.width - width) / 2)),
    y: display.y + Math.max(0, Math.floor((display.height - height) / 2)),
    width,
    height,
    maximized: false
  }
}

/**
 * Keep a saved window on a visible display. A window that does not overlap
 * any work area by a title-bar margin is placed on the first display.
 * Size is clamped to that display and does not drop below the minimum unless
 * the display itself is smaller.
 */
export function clampWindowBounds(
  saved: WindowBounds,
  displays: readonly DisplayWorkArea[]
): WindowBounds {
  const primary = displays[0]
  if (primary === undefined || !isFiniteBounds(saved)) {
    if (primary === undefined) {
      return {
        x: 0,
        y: 0,
        width: DEFAULT_WINDOW_WIDTH,
        height: DEFAULT_WINDOW_HEIGHT,
        maximized: false
      }
    }
    return defaultWindowBounds(primary)
  }
  const home =
    displays.find((display) => overlapArea(saved, display) >= VISIBLE_MARGIN * VISIBLE_MARGIN) ??
    null
  if (home === null) {
    return { ...defaultWindowBounds(primary), maximized: saved.maximized }
  }
  const width = fitSize(saved.width, MIN_WINDOW_WIDTH, home.width)
  const height = fitSize(saved.height, MIN_WINDOW_HEIGHT, home.height)
  const maxX = home.x + Math.max(0, home.width - width)
  const maxY = home.y + Math.max(0, home.height - height)
  const x = Math.min(Math.max(saved.x, home.x), maxX)
  const y = Math.min(Math.max(saved.y, home.y), maxY)
  return { x, y, width, height, maximized: saved.maximized }
}

/**
 * While maximized, keep the last normal bounds and only flip the flag.
 * A restore or a resize while not maximized replaces the bounds.
 */
export function nextSavedBounds(
  previous: WindowBounds,
  current: Pick<WindowBounds, 'x' | 'y' | 'width' | 'height'>,
  maximized: boolean
): WindowBounds {
  if (maximized) return { ...previous, maximized: true }
  return {
    x: current.x,
    y: current.y,
    width: current.width,
    height: current.height,
    maximized: false
  }
}

/** Missing, corrupt, or secret-shaped files are ignored so the window uses defaults. */
export function readWindowState(filePath: string): WindowBounds | null {
  if (!existsSync(filePath)) return null
  let text: string
  try {
    text = readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
  if (containsSecret(text)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  for (const key of Object.keys(parsed)) {
    if (key !== 'x' && key !== 'y' && key !== 'width' && key !== 'height' && key !== 'maximized') {
      return null
    }
  }
  if (
    !isInteger(parsed.x) ||
    !isInteger(parsed.y) ||
    !isInteger(parsed.width) ||
    !isInteger(parsed.height) ||
    typeof parsed.maximized !== 'boolean'
  ) {
    return null
  }
  if (parsed.width < 1 || parsed.height < 1) return null
  return {
    x: parsed.x,
    y: parsed.y,
    width: parsed.width,
    height: parsed.height,
    maximized: parsed.maximized
  }
}

export function writeWindowState(filePath: string, bounds: WindowBounds): void {
  const json = `${JSON.stringify(
    {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized: bounds.maximized
    },
    null,
    2
  )}\n`
  if (containsSecret(json)) return
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 })
  atomicWriteFile(filePath, json)
  if (process.platform !== 'win32') chmodSync(filePath, 0o600)
}

function fitSize(preferred: number, min: number, available: number): number {
  if (!Number.isFinite(available) || available <= 0) return preferred
  const capped = Math.min(preferred, available)
  return Math.max(capped, Math.min(min, available))
}

function overlapArea(bounds: WindowBounds, display: DisplayWorkArea): number {
  const left = Math.max(bounds.x, display.x)
  const top = Math.max(bounds.y, display.y)
  const right = Math.min(bounds.x + bounds.width, display.x + display.width)
  const bottom = Math.min(bounds.y + bounds.height, display.y + display.height)
  const width = right - left
  const height = bottom - top
  if (width <= 0 || height <= 0) return 0
  return width * height
}

function isFiniteBounds(bounds: WindowBounds): boolean {
  return (
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width > 0 &&
    bounds.height > 0
  )
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
