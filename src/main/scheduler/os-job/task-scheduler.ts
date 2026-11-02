import { NEXT_STEP, failureDetail, succeeded, twoDigits, validateSpec } from './shared'
import { OsJobError } from './types'
import type { CommandRunner, OsJobInstaller, OsJobSpec } from './types'

export const TASK_NAME = 'CiteFox\\CheckDue'

/** schtasks rejects a /TR value longer than this. */
export const MAX_TASK_RUN_LENGTH = 261

/**
 * Quotes one argument for a CreateProcess command line (the MSVCRT/CommandLineToArgvW rules).
 * Double quotes are refused, so the only escaping needed is doubling trailing backslashes inside
 * a quoted argument, which would otherwise escape the closing quote.
 */
export function quoteWindowsArgument(value: string): string {
  if (value.includes('"')) {
    throw new OsJobError(
      `CiteFox could not set up the background check: a path or argument contains a double quote ("), which Windows Task Scheduler cannot run safely. Reinstall CiteFox in a folder without quotes in its name.`
    )
  }
  if (value !== '' && !/[\s]/.test(value)) return value
  return `"${value.replace(/(\\+)$/, '$1$1')}"`
}

/** The single /TR string, e.g. `"C:\Program Files\CiteFox\CiteFox.exe" --check-due`. */
export function windowsCommandLine(parts: readonly string[]): string {
  return parts.map(quoteWindowsArgument).join(' ')
}

export function createTaskArgs(spec: OsJobSpec): string[] {
  const command = windowsCommandLine([spec.program, ...spec.args])
  if (command.length > MAX_TASK_RUN_LENGTH) {
    throw new OsJobError(
      `CiteFox could not set up the background check: its program path is longer than Windows Task Scheduler allows (${MAX_TASK_RUN_LENGTH} characters). Install CiteFox in a shorter folder path, then try again.`
    )
  }
  return [
    '/Create',
    '/SC',
    'HOURLY',
    '/MO',
    '1',
    '/ST',
    `00:${twoDigits(spec.minute)}`,
    '/TN',
    TASK_NAME,
    '/TR',
    command,
    '/F'
  ]
}

/** Windows: an hourly task in the CiteFox folder of Task Scheduler. */
export function taskSchedulerInstaller(input: { runner: CommandRunner }): OsJobInstaller {
  const { runner } = input
  const isRegistered = (): boolean =>
    succeeded(runner.run('schtasks', ['/Query', '/TN', TASK_NAME]))

  return {
    kind: 'task_scheduler',

    install(spec: OsJobSpec): void {
      validateSpec(spec, 'win32')
      // Task Scheduler cannot redirect output, so logDirectory is not used here; a headless run
      // writes its own logs.
      const args = createTaskArgs(spec)
      // /F replaces an existing task in one step, so a failure leaves the old state untouched.
      const result = runner.run('schtasks', args)
      if (!succeeded(result)) {
        throw new OsJobError(
          `Windows Task Scheduler did not accept CiteFox's background check (schtasks: ${failureDetail(result)}). Nothing was installed. ${NEXT_STEP}`
        )
      }
    },

    remove(): void {
      // A missing task makes /Delete fail; that is fine as long as it is gone afterwards.
      const result = runner.run('schtasks', ['/Delete', '/TN', TASK_NAME, '/F'])
      if (isRegistered()) {
        throw new OsJobError(
          `CiteFox could not remove its background check from Windows Task Scheduler (schtasks: ${failureDetail(result)}). Open Task Scheduler and delete the task "${TASK_NAME}", then turn the setting off again.`
        )
      }
    },

    isInstalled(): boolean {
      return isRegistered()
    }
  }
}
