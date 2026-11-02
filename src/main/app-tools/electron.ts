import { spawn } from 'node:child_process'
import { app } from 'electron'
import { backgroundTestMode } from '../background-mode'
import type { Logger } from '../logging/logger'
import { requestResetKeepKeys } from '../reset/request'
import type { OsJobControl } from '../scheduler/os-job-control'
import { appServiceKeychain } from '../secrets/file-store'
import { TEST_PROFILE_KEYCHAIN_SERVICE } from '../secrets/keychain'
import { openTestProfile } from '../test-profile/open'
import {
  testProfileDataDir,
  testProfileLaunchArgs,
  testProfileRunning
} from '../test-profile/profile'
import { createFakeAppTools } from './fake'
import { appToolsMode, devRestartExitCode } from './index'
import type { AppTools } from './types'

/** Lets the "Reset" answer reach the window before the app closes. */
const RESTART_DELAY_MS = 300

export interface ElectronAppToolsInput {
  logger: Logger
  /** This window is the test profile. */
  testProfile: boolean
  /** The same control the schedule uses, so the reset removes the job it installed. */
  osJob: OsJobControl
  loginItem: { set(openAtLogin: boolean): void }
  /** Stops loops and closes storage, as quitting does. */
  shutdown: () => void
  /** Brings this app's window forward. */
  focusWindow: () => void
}

/**
 * The real testing tools in a packaged app (or with CITEFOX_E2E_APP_TOOLS=real),
 * and the recorded fake in every other unpackaged run (see `index.ts`). A
 * background test run never gets the real ones.
 */
export function createElectronAppTools(input: ElectronAppToolsInput): AppTools {
  const mode = appToolsMode(app.isPackaged)
  if (mode !== 'real' || backgroundTestMode(app.isPackaged)) {
    return createFakeAppTools({ userData: app.getPath('userData'), fail: mode === 'fail' })
  }
  return {
    resetKeepKeys: () =>
      requestResetKeepKeys({
        userData: app.getPath('userData'),
        now: () => new Date(),
        removeBackgroundJob: () => {
          input.osJob.remove()
          if (input.osJob.registered) throw new Error('The background job is still installed')
        },
        turnOffLoginItem: () => input.loginItem.set(false),
        restart: () => {
          setTimeout(() => {
            try {
              input.shutdown()
            } catch (error: unknown) {
              input.logger.error('CiteFox could not close cleanly before the reset', error)
            }
            // scripts/try.sh runs under electron-vite dev, which stops when Electron exits;
            // it sets this code and starts Electron again itself.
            const devRestartCode = devRestartExitCode(app.isPackaged, process.env)
            if (devRestartCode !== null) {
              app.exit(devRestartCode)
              return
            }
            // Same arguments, so a test profile restarts as the test profile.
            app.relaunch()
            app.exit(0)
          }, RESTART_DELAY_MS)
        },
        logger: input.logger
      }),
    openTestProfile: (request) => {
      if (input.testProfile) {
        if (request.fresh) {
          return { ok: false, message: 'Start fresh from your main CiteFox window.' }
        }
        input.focusWindow()
        return { ok: true, alreadyOpen: true }
      }
      const dataDir = testProfileDataDir(app.getPath('appData'))
      return openTestProfile(
        {
          dataDir,
          keychain: appServiceKeychain(app.isPackaged, TEST_PROFILE_KEYCHAIN_SERVICE),
          isRunning: () => testProfileRunning(dataDir),
          launch: () => launchTestProfile(dataDir, input.logger),
          logger: input.logger
        },
        request
      )
    }
  }
}

/** A detached second CiteFox. A running test profile takes the launch through its lock. */
function launchTestProfile(dataDir: string, logger: Logger): void {
  const args = testProfileLaunchArgs({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    dataDir
  })
  const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore' })
  child.on('error', (error) => {
    logger.error('CiteFox could not start the test profile', error)
  })
  child.unref()
}
