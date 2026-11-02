import { launchdInstaller } from './launchd'
import { spawnCommandRunner } from './runner'
import { validateSpec } from './shared'
import { systemdInstaller } from './systemd'
import { taskSchedulerInstaller } from './task-scheduler'
import { OsJobError } from './types'
import type { CommandRunner, OsJobInstaller, OsJobKind, OsJobSpec } from './types'

export type { CommandResult, CommandRunner, OsJobInstaller, OsJobKind, OsJobSpec } from './types'
export { OsJobError } from './types'
export { spawnCommandRunner, COMMAND_TIMEOUT_MS } from './runner'
export {
  checkDueJobSpec,
  validateSpec,
  CHECK_DUE_LOG,
  CHECK_DUE_ERROR_LOG,
  LINUX_HEADLESS_SWITCHES
} from './shared'
export { LAUNCHD_LABEL, launchAgentPlist, launchAgentPlistPath, launchdInstaller } from './launchd'
export {
  TASK_NAME,
  createTaskArgs,
  taskSchedulerInstaller,
  windowsCommandLine
} from './task-scheduler'
export {
  SYSTEMD_SERVICE,
  SYSTEMD_TIMER,
  systemdInstaller,
  systemdServiceUnit,
  systemdTimerUnit,
  systemdUserUnitDirectory
} from './systemd'
export { CRON_MARKER, cronInstaller, cronLine } from './cron'

export interface CreateOsJobInstallerInput {
  platform: NodeJS.Platform
  /** The user's home directory (`os.homedir()`); tests pass a temp directory. */
  home: string
  /** `process.getuid()` on macOS/Linux, null on Windows. */
  uid: number | null
  env?: Record<string, string | undefined>
  runner?: CommandRunner
}

/** The installer for this platform. Nothing touches the OS until a method is called. */
export function createOsJobInstaller(input: CreateOsJobInstallerInput): OsJobInstaller {
  const runner = input.runner ?? spawnCommandRunner()
  switch (input.platform) {
    case 'darwin':
      return launchdInstaller({ home: input.home, uid: input.uid, runner })
    case 'win32':
      return taskSchedulerInstaller({ runner })
    case 'linux':
      return systemdInstaller({ home: input.home, env: input.env, runner })
    default:
      return unsupportedOsJobInstaller(input.platform)
  }
}

export function unsupportedOsJobInstaller(platform: string): OsJobInstaller {
  return {
    kind: 'unsupported',
    install(): void {
      throw new OsJobError(
        `Checking while CiteFox is closed is not available on this system (${platform}). Leave CiteFox open and it will check on schedule while it runs.`
      )
    },
    remove(): void {
      // Nothing can have been installed.
    },
    isInstalled(): boolean {
      return false
    }
  }
}

/** In-memory installer for tests and e2e: install stores the spec, remove clears it. */
export function memoryOsJobInstaller(
  kind: OsJobKind = 'launchd'
): OsJobInstaller & { spec: OsJobSpec | null } {
  const installer = {
    kind,
    spec: null as OsJobSpec | null,
    install(spec: OsJobSpec): void {
      validateSpec(spec)
      installer.spec = { ...spec, args: [...spec.args] }
    },
    remove(): void {
      installer.spec = null
    },
    isInstalled(): boolean {
      return installer.spec !== null
    }
  }
  return installer
}
