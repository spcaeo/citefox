import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The build number on the release line (src/shared/release-line.ts): it only
 * goes up. It is the git commit count (`git rev-list --count HEAD`); outside
 * git it falls back to a stored counter (`.build-number`, git-ignored) that
 * is bumped on each such build. Every build stores the number it used, so the
 * counter never drops below the last git count.
 */

export const BUILD_COUNTER_FILE = resolve('.build-number')

export function gitCommitCount(cwd = process.cwd()): number | null {
  try {
    const out = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    return /^\d+$/.test(out) && Number(out) > 0 ? Number(out) : null
  } catch {
    return null
  }
}

function readCounter(file: string): number {
  try {
    if (!existsSync(file)) return 0
    const value = Number(readFileSync(file, 'utf8').trim())
    return Number.isInteger(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

/** The number for this build: max(git count, stored), or stored + 1 outside git. */
export function nextBuildNumber(
  options: { count?: () => number | null; file?: string } = {}
): number {
  const file = options.file ?? BUILD_COUNTER_FILE
  const stored = readCounter(file)
  const count = (options.count ?? gitCommitCount)()
  const number = count === null ? stored + 1 : Math.max(count, stored)
  try {
    writeFileSync(file, `${number}\n`)
  } catch {
    // A read-only checkout still builds; the number is just not remembered.
  }
  return number
}
