import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * "Test as a new user": a second CiteFox on its own data folder and its own
 * keychain service. It never installs the background job or the login item,
 * which the real install shares by name with every profile.
 */

/** Command-line switch the test profile is started with (`--citefox-test-profile`). */
export const TEST_PROFILE_SWITCH = 'citefox-test-profile'

/** Folder under Electron's `appData`, next to the real `CiteFox` folder. */
export const TEST_PROFILE_FOLDER = 'CiteFox Test Profile'

/** Written by a running test profile so the real window can tell it is open. */
export const TEST_PROFILE_RUNNING_FILE = 'citefox-test-profile.pid'

export function isTestProfileLaunch(argv: readonly string[]): boolean {
  return argv.includes(`--${TEST_PROFILE_SWITCH}`)
}

export function testProfileDataDir(appData: string): string {
  return join(appData, TEST_PROFILE_FOLDER)
}

/**
 * Arguments for the spawned test window. An unpackaged run passes the app
 * folder first, as `electron .` does.
 */
export function testProfileLaunchArgs(input: {
  isPackaged: boolean
  appPath: string
  dataDir: string
}): string[] {
  return [
    ...(input.isPackaged ? [] : [input.appPath]),
    `--user-data-dir=${input.dataDir}`,
    `--${TEST_PROFILE_SWITCH}`
  ]
}

/** Called by the test profile once it holds its single-instance lock. */
export function markTestProfileRunning(dataDir: string, pid: number): void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  writeFileSync(join(dataDir, TEST_PROFILE_RUNNING_FILE), `${pid}\n`, { mode: 0o600 })
}

/** Called on quit. Leaves a file another process wrote alone. */
export function clearTestProfileRunning(dataDir: string, pid: number): void {
  if (readRunningPid(dataDir) === pid) {
    rmSync(join(dataDir, TEST_PROFILE_RUNNING_FILE), { force: true })
  }
}

/**
 * True while a test profile process is alive. A file left by a crash names a
 * process that is gone, so it reads as closed.
 */
export function testProfileRunning(
  dataDir: string,
  isAlive: (pid: number) => boolean = processAlive
): boolean {
  const pid = readRunningPid(dataDir)
  return pid !== null && isAlive(pid)
}

function readRunningPid(dataDir: string): number | null {
  const file = join(dataDir, TEST_PROFILE_RUNNING_FILE)
  if (!existsSync(file)) return null
  try {
    const pid = Number(readFileSync(file, 'utf8').trim())
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

/** Signal 0 checks that the process exists without touching it. */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    // EPERM: it exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
