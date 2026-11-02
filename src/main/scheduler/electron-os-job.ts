import { homedir } from 'node:os'
import { app } from 'electron'
import type { Logger } from '../logging/logger'
import { checkDueJobSpec, createOsJobInstaller } from './os-job'
import { createOsJobControl, memoryOsJobControl, type OsJobControl } from './os-job-control'

/**
 * The SCH-1 OS job for this app. A packaged app installs the real
 * LaunchAgent, scheduled task, or systemd timer. A development or e2e run
 * (`app.isPackaged` false) uses an in-memory job so it never touches the OS,
 * unless `CITEFOX_OS_JOB=1` is set to test the real job against the dev build.
 * The test profile ("Test as a new user") always uses the in-memory job: the
 * real one's name (app.citefox.checkdue) is shared with the real install.
 */
export function createAppOsJobControl(
  logger?: Pick<Logger, 'error'>,
  options: { testProfile?: boolean } = {}
): OsJobControl {
  if (options.testProfile === true) return memoryOsJobControl()
  if (!app.isPackaged && process.env.CITEFOX_OS_JOB !== '1') return memoryOsJobControl()
  return createOsJobControl({
    installer: createOsJobInstaller({
      platform: process.platform,
      home: homedir(),
      uid: typeof process.getuid === 'function' ? process.getuid() : null,
      env: process.env
    }),
    specFor: (dailyCheckTime) =>
      checkDueJobSpec({
        execPath: process.execPath,
        appPath: app.getAppPath(),
        isPackaged: app.isPackaged,
        logDirectory: app.getPath('logs'),
        dailyCheckTime,
        appImage: process.platform === 'linux' ? process.env.APPIMAGE : undefined,
        platform: process.platform,
        userDataDir: app.commandLine.hasSwitch('user-data-dir') ? app.getPath('userData') : null
      }),
    logger
  })
}
