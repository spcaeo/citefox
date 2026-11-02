import { execFileSync } from 'node:child_process'
import type { AppBuild } from '@shared/ipc'
import { validBuildNumber } from '@shared/release-line'

/**
 * Set by electron-vite's `define` (electron.vite.config.ts) when the main
 * bundle is built. Vitest does not define it.
 */
declare const __CITEFOX_BUILD__:
  { commit: string | null; number?: number; builtAt: string } | undefined

/** When this process started: the fallback build time for a run that was not bundled. */
const STARTED_AT = new Date().toISOString()

const COMMIT = /^[0-9a-f]{4,40}$/

/** `git rev-list --count HEAD` for a development run; null when git cannot say. */
function gitCommitCount(cwd: string): number | null {
  try {
    const out = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      timeout: 2_000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    return /^\d+$/.test(out) ? validBuildNumber(Number(out)) : null
  } catch {
    return null
  }
}

/**
 * Which build is running, for the header and bug reports. A bundled build
 * reports the commit and time it was built from; a unit test or other
 * unbundled run reports no commit and the time it started.
 */
export function appBuild(
  injected: unknown = typeof __CITEFOX_BUILD__ === 'undefined' ? undefined : __CITEFOX_BUILD__
): AppBuild {
  if (typeof injected !== 'object' || injected === null)
    return { commit: null, number: null, builtAt: STARTED_AT }
  const { commit, number, builtAt } = injected as Record<string, unknown>
  return {
    commit: typeof commit === 'string' && COMMIT.test(commit) ? commit : null,
    number: validBuildNumber(number),
    builtAt:
      typeof builtAt === 'string' && !Number.isNaN(Date.parse(builtAt)) ? builtAt : STARTED_AT
  }
}

/**
 * A development run (scripts/try.sh, `npm run dev`) restarts on every main
 * change, but the bundled commit is fixed when electron-vite first loads its
 * config. Read the checkout's commit at start so the header names the code
 * that is actually running; fall back to the bundled value.
 */
export function devAppBuild(
  appPath: string,
  readCommit: (cwd: string) => string = (cwd) =>
    execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      timeout: 2_000,
      stdio: ['ignore', 'pipe', 'ignore']
    }),
  readCount: (cwd: string) => number | null = gitCommitCount
): AppBuild {
  const bundled = appBuild()
  try {
    const commit = readCommit(appPath).trim()
    return COMMIT.test(commit)
      ? { commit, number: readCount(appPath) ?? bundled.number ?? null, builtAt: STARTED_AT }
      : bundled
  } catch {
    return bundled
  }
}
