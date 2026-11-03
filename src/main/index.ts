import type { CheckFinishedNotice, CheckProgress, ResultsChanged } from '@shared/ipc'
import { DEFAULT_THEME } from '@shared/domain'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { createCheckEngine, createCheckRunner, resumeInterruptedChecks } from './engine/checks'
import type { CapStopEvent } from './engine/checks/cap-stop'
import {
  CHECK_DUE_EXIT_ERROR,
  CHECK_DUE_EXIT_OK,
  acquirePrimaryInstance,
  createCheckDueLaunchRequest,
  createHeadlessReportsPort,
  deliverDueScheduledReports,
  finishCheckDuePass,
  focusExistingWindow,
  handleSecondInstance,
  isCheckDueFlag,
  noteCheckDueActivate,
  noteCheckDueSecondInstance,
  runCheckDueCommand,
  shouldSkipForRunningInstance,
  startDueReportLoop
} from './headless'
import {
  appLogFilePath,
  createLogger,
  createRotatingFileSink,
  teeSinks,
  writeLogToConsole
} from './logging'
import { offerMoveToApplications } from './move-to-applications'
import { installProcessGuards } from './process-guards'
import { createFetchHttpTransport, createSpawnCommandTransport } from './providers'
import { createFsBinaryProbe, fakeAiOnlyRoots } from './providers/claude/binary'
import { onClaudeCodePauseChange } from './providers/claude/shared-gate'
import { sleep } from './providers/timeout'
import {
  appSecretRegistry,
  createAppSecretStore,
  devSecretsFile,
  keychainServiceFor
} from './secrets'
import { applySessionBusEnv } from './secrets/session-bus'
import type { EngineHost } from './engine/host'
import { openCheckClaude, openProjectClaude } from './engine/claude'
import { claudeSummaryWriter } from './email/summary-writer'
import { configureDiagnosticsShell, revealLogFile } from './diagnostics'
import { configureDataFolderReveal } from './export/data-folder'
import { configureAutoExportFolderDialog } from './export/auto/ipc'
import { runAutoExports } from './export/auto/run'
import { createAutoExportTracker } from './export/auto/tracker'
import { configureExportReveal, configureExportSaveDialog } from './export/ipc'
import { configureReviewPdfPrinter } from './export/review/download'
import { printHtmlToPdf } from './export/review/pdf-window'
import { configureImportDialogs } from './import/service'
import { configureTransferDialogs } from './project-transfer/dialogs'
import { createIpcHandlers } from './handlers'
import { startAccountRuntime } from './account/runtime'
import { offlineSlackTransport } from './alerts/offline-slack'
import { emailServiceSenders, withAlertRules } from './alerts/runtime'
import { createAlertRulesService } from './alerts/service'
import { startAlertDigestTimer } from './scheduler/digest-timer'
import { openEngineEmail, setEngineEmailTestPorts } from './email/engine-email'
import { e2eSitemapFetch, startSitemapSyncLoop, structureRuntimeFor } from './structure/sync-loop'
import { e2eTopicDns, e2eTopicSiteReader } from './topics/e2e-site'
import { broadcastIpcEvent, registerIpcHandlers } from './ipc'
import { bindScheduleQueueTray } from './scheduler/ipc'
import { createAppOsJobControl } from './scheduler/electron-os-job'
import { guardResumingPages } from './scheduler/resume-guard'
import { installMainTray } from './tray/electron-host'
import { listOpenNotices } from './storage/notices'
import { installContentGuards } from './security'
import { openBackgroundPass } from './headless/background-pass'
import { capAlertFromStop, capEmail, createCapAlertHandler } from './notices/cap-alert'
import { setupRunnerDisabled, type SetupRunner } from './setup-runner/runner'
import { openAppStorage, type AppStorage } from './storage/app-storage'
import {
  listApiKeys,
  readActiveProjectId,
  readOnboardingFinished,
  writeActiveProjectId
} from './storage/records'
import {
  createPermissionConsentStore,
  notificationsAllowed,
  permissionsFilePath
} from './permissions/consent'
import { electronPermissionSystem } from './permissions/electron-system'
import { startupErrorBox } from './startup-error'
import { createMainWindow } from './window'
import { app, BrowserWindow, dialog, Menu, nativeTheme, session, shell } from 'electron'
import { appMenuTemplate } from './app-menu'
import { createThemeController } from './theme'
import { backgroundTestMode } from './background-mode'
import { devUserDataDir } from './dev-user-data'
import { appBuild, devAppBuild } from './build-info'
import { makeAppInfo } from './app-info'
import { createElectronAppTools } from './app-tools/electron'
import { performPendingReset, type ResetOutcome } from './reset/perform'
import { resetPending } from './reset/marker'
import {
  clearTestProfileRunning,
  isTestProfileLaunch,
  markTestProfileRunning
} from './test-profile/profile'

/** "Test as a new user": started with `--citefox-test-profile` on its own data folder. */
const testProfile = isTestProfileLaunch(process.argv)

const appInfo = makeAppInfo(
  app.isPackaged ? appBuild() : devAppBuild(app.getAppPath()),
  testProfile
)

// Linux: a cron-started --check-due has no session bus variables, so the keychain would read nothing.
applySessionBusEnv()
app.setName(appInfo.name)
// Development only: CITEFOX_USER_DATA runs a second copy on its own data folder.
// The test profile inherits the variable but keeps its own --user-data-dir.
const devUserData = testProfile ? null : devUserDataDir(app.isPackaged)
if (devUserData !== null) app.setPath('userData', devUserData)
// Test runs (unpackaged, CITEFOX_E2E_BACKGROUND=1) never take focus or the menu bar.
if (backgroundTestMode(app.isPackaged) && process.platform === 'darwin') {
  app.setActivationPolicy('accessory')
}
// Must match electron-builder appId so Windows notifications attach to the Start menu shortcut.
app.setAppUserModelId('app.citefox.desktop')

/** `<userData>/logs/citefox.log`, rotated at 5 MB with 3 files kept. GUI and `--check-due` share it. */
const logFile = appLogFilePath(app.getPath('userData'))
const logger = createLogger({
  secrets: () => appSecretRegistry().list(),
  write: teeSinks(writeLogToConsole, createRotatingFileSink({ file: logFile }))
})
// Nothing that fails in the background may vanish. A `--check-due` run ends with its error code.
installProcessGuards(process, logger, () => {
  if (isCheckDueFlag(process.argv)) app.exit(CHECK_DUE_EXIT_ERROR)
})
let storage: AppStorage | undefined
let host: EngineHost | undefined
/** FR-19.2 scheduled sitemap sync; stopped on quit. */
let stopSitemapSync: (() => void) | undefined
/** Stops the hourly account tick (ping and queued registration). */
let stopAccount: (() => void) | undefined
/** FR-23.7 weekly and monthly reports while the app runs; stopped on quit. */
let stopReportLoop: (() => void) | undefined
/** Daily alert digests (Alerts & schedules › Alert rules) on a wall-clock tick; stopped on quit. */
let stopDigestTimer: (() => void) | undefined
/** Closes the email host the alert senders opened for themselves (headless, early alerts). */
let closeAlertSenders: (() => void) | undefined
/** FR-20.6 background page setup; stopped on quit. */
let setupRunner: SetupRunner | undefined
/** Set once the GUI has opened its first window; before that a new window would race startup. */
let windowsReady = false
/** Set while the first window loads the renderer. */
let loadingFirstWindow = false
let quitting = false

app.on('before-quit', () => {
  quitting = true
})

/**
 * Quitting or closing the window while the renderer is still loading rejects
 * `loadFile` (ERR_FAILED / ERR_ABORTED). That is not a failed start.
 */
function firstWindowLoadAbandoned(): boolean {
  return loadingFirstWindow && (quitting || liveMainWindow() === undefined)
}

/**
 * Brings the main window forward, including one hidden in the tray. When no
 * window exists (macOS after the last one closed), opens a new one.
 */
function liveMainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed())
}

function showMainWindow(): void {
  const existing = liveMainWindow()
  if (existing !== undefined) {
    focusExistingWindow(existing)
    return
  }
  if (!windowsReady) return
  void createMainWindow({ stateFile: storage?.paths.windowStateFile }).catch((error: unknown) => {
    logger.error('CiteFox could not open its window', error)
  })
}

/**
 * The GUI could not start. Tell the user why, with the log file path, then
 * exit non-zero. Never called in headless `--check-due` mode.
 */
function failStartup(error: unknown): void {
  const box = startupErrorBox(error, {
    logFile,
    userDataDir: app.getPath('userData'),
    secrets: appSecretRegistry().list()
  })
  try {
    dialog.showErrorBox(box.title, box.content)
  } catch (dialogError: unknown) {
    logger.error('CiteFox could not show the startup error', dialogError)
  }
  try {
    storage?.close()
  } catch (closeError: unknown) {
    logger.error('CiteFox could not close storage after a failed start', closeError)
  }
  storage = undefined
  app.exit(1)
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

/** Stops the loops and closes storage. Quitting and the reset restart both call it. */
function shutdown(): void {
  stopReportLoop?.()
  stopReportLoop = undefined
  stopDigestTimer?.()
  stopDigestTimer = undefined
  closeAlertSenders?.()
  closeAlertSenders = undefined
  stopSitemapSync?.()
  stopSitemapSync = undefined
  stopAccount?.()
  stopAccount = undefined
  setupRunner?.stop()
  host?.email.close()
  storage?.close()
  storage = undefined
  if (testProfile) clearTestProfileRunning(app.getPath('userData'), process.pid)
}

app.on('will-quit', shutdown)

/**
 * "Reset CiteFox, keep my keys" asked for a reset before the restart. It runs
 * before storage opens. The window's own web storage goes too, so nothing a
 * screen remembered survives. A failure leaves the data as it was.
 */
async function runPendingReset(): Promise<ResetOutcome> {
  const outcome = performPendingReset({
    userData: app.getPath('userData'),
    now: new Date(),
    logger
  })
  if (outcome.status !== 'done') return outcome
  try {
    await session.defaultSession.clearStorageData({
      storages: ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage']
    })
  } catch (error: unknown) {
    logger.warn('CiteFox could not clear the window storage after a reset', error)
  }
  return outcome
}

/** Says why a requested reset did not happen, once the window is open. */
function reportFailedReset(outcome: ResetOutcome): void {
  if (outcome.status !== 'failed' || backgroundTestMode(app.isPackaged)) return
  void dialog
    .showMessageBox({
      type: 'warning',
      message: 'CiteFox did not reset',
      detail: `${outcome.message} Your projects and settings are as they were.`
    })
    .catch((error: unknown) => {
      logger.error('CiteFox could not show the reset message', error)
    })
}

void app
  .whenReady()
  .then(async () => {
    const headless = isCheckDueFlag(process.argv)
    if (headless && shouldSkipForRunningInstance(app)) {
      app.exit(CHECK_DUE_EXIT_OK)
      return
    }
    // A reset is waiting for the window to start; the background pass leaves the data alone.
    if (headless && resetPending(app.getPath('userData'))) {
      app.exit(CHECK_DUE_EXIT_OK)
      return
    }
    // A copy opened from the .dmg or Downloads offers to move itself into Applications first.
    if (offerMoveToApplications(app, { headless, logger })) return
    if (!headless && !acquirePrimaryInstance(app)) return
    logger.info(
      `CiteFox ${appInfo.version} (${appInfo.build.commit ?? 'no commit'}, built ${appInfo.build.builtAt}) starting${headless ? ' (--check-due)' : ''}${testProfile ? ' as the test profile' : ''} on ${process.platform}-${process.arch}, Electron ${process.versions.electron}`
    )
    if (!headless && testProfile) markTestProfileRunning(app.getPath('userData'), process.pid)
    const resetOutcome: ResetOutcome = headless ? { status: 'none' } : await runPendingReset()

    const launchRequest = createCheckDueLaunchRequest()
    if (headless) {
      app.on('second-instance', (_event, argv) => {
        noteCheckDueSecondInstance(launchRequest, argv)
      })
      // A Dock or Finder open during the headless job arrives as activate on macOS.
      app.on('activate', () => {
        noteCheckDueActivate(launchRequest)
      })
      app.dock?.hide()
    }
    if (!headless) {
      app.on('second-instance', (_event, argv) => {
        if (liveMainWindow() === undefined && !isCheckDueFlag(argv)) {
          showMainWindow()
          return
        }
        handleSecondInstance(argv, liveMainWindow)
      })
    }

    const appStorage = openAppStorage(app.getPath('userData'))
    storage = appStorage
    // Test runs never post to Slack (tests/e2e/launch.ts): an offline transport answers.
    if (!app.isPackaged && process.env.CITEFOX_SLACK === 'off') {
      setEngineEmailTestPorts(appStorage, { webhooks: offlineSlackTransport() })
    }
    // The test profile has its own keychain service, so it never sees a real key.
    // Unpackaged test runs may keep secrets in a file instead (CITEFOX_SECRETS_FILE).
    if (devSecretsFile(app.isPackaged) !== null) {
      logger.warn('CiteFox keeps secrets in a test file, not the keychain (CITEFOX_SECRETS_FILE)')
    }
    const secrets = createAppSecretStore(
      app.isPackaged,
      appSecretRegistry(),
      keychainServiceFor(testProfile)
    )
    const http = createFetchHttpTransport()
    // e2e runs (CITEFOX_E2E_FAKE_AI_ONLY=1) only find the shims, never the real claude or codex.
    const aiOnlyUnder = fakeAiOnlyRoots(app.isPackaged, [tmpdir(), app.getAppPath()])
    const trayReady: { current?: ReturnType<typeof installMainTray> } = {}
    const claudeParts = {
      storage: appStorage,
      secrets,
      logger,
      http,
      command: createSpawnCommandTransport(),
      probe: createFsBinaryProbe(aiOnlyUnder),
      knownSecrets: () => appSecretRegistry().list()
    }
    // FR-11.4 notify rule: one alert path for scheduled and manual checks (desktop, email, notice).
    const onCapAlert = createCapAlertHandler({
      storage: appStorage,
      logger,
      now: () => new Date(),
      desktop: (notice) => trayReady.current?.notifyAlert(notice),
      email: (alert) =>
        host === undefined ? Promise.resolve(null) : capEmail(host.email.service)(alert)
    })
    const deps = {
      storage: appStorage,
      secrets,
      logger,
      http,
      onCapStop: (stop: CapStopEvent) => {
        const alert = capAlertFromStop(stop, new Date())
        if (alert !== null) onCapAlert(alert)
      },
      now: () => new Date(),
      createId: () => randomUUID(),
      emitProgress: (event: CheckProgress) => {
        broadcastIpcEvent('checks:progress', event)
      },
      emitFinished: (event: CheckFinishedNotice) => {
        broadcastIpcEvent('checks:finished', event)
        trayReady.current?.notifyCheckFinished(event)
      },
      // Each saved question, so the topic page, Summary and Questions update while it runs.
      emitResultsChanged: (event: ResultsChanged) => {
        broadcastIpcEvent('results:changed', event)
      },
      claude: openCheckClaude(claudeParts),
      claudeFor: (projectId: string) => openProjectClaude(claudeParts, projectId),
      knownSecrets: () => appSecretRegistry().list(),
      sleep,
      // FR-16.2: brand sentiment is read after each check's reports, off the search path.
      readSentiment: true
    }
    // Alert rules run after every check job (Alerts & schedules › Alert rules), the headless ones too.
    // With no window host (--check-due) the senders open their own, so email and Slack still go out.
    const alertSenders = emailServiceSenders(
      appStorage,
      (notice) =>
        trayReady.current?.notifyAlert({
          projectId: null,
          title: notice.title,
          body: notice.body,
          action: 'Open alert log',
          hash: notice.hash
        }),
      () =>
        openEngineEmail({
          storage: appStorage,
          secrets,
          logger,
          knownSecrets: () => appSecretRegistry().list()
        })
    )
    closeAlertSenders = () => alertSenders.close()
    const alertRules = createAlertRulesService({
      storage: appStorage,
      logger,
      now: deps.now,
      createId: deps.createId,
      senders: alertSenders
    })
    const checkEngine = withAlertRules(createCheckEngine(deps), alertRules)
    const checkRunner = createCheckRunner(deps, checkEngine)

    // FR-22.6: automatic exports run once a pass's scheduled checks and their reports are done.
    const autoExport = createAutoExportTracker(async (checked) => {
      await checkEngine.reportsIdle()
      await runAutoExports(
        {
          storage: appStorage,
          now: deps.now,
          createId: deps.createId,
          knownSecrets: deps.knownSecrets,
          logger
        },
        checked
      )
    }, logger)

    if (headless) {
      let code: number
      // Due sitemap syncs and background page setup run after the checks, in the headless budget.
      const background = openBackgroundPass(claudeParts, {
        shouldStop: () => launchRequest.requested
      })
      try {
        code = await runCheckDueCommand({
          storage: appStorage,
          runner: checkRunner,
          logger,
          reports: createHeadlessReportsPort({
            secrets,
            logger,
            redacted: appSecretRegistry().list(),
            summaryWriter: claudeSummaryWriter(() => openCheckClaude(claudeParts))
          }),
          // Hand off to the window after the running page when the user opens CiteFox.
          shouldStop: () => launchRequest.requested,
          onCapAlert,
          autoExport,
          alerts: alertRules,
          ...(setupRunnerDisabled(app.isPackaged, process.env)
            ? {}
            : { background: () => background.run() })
        })
      } catch (error: unknown) {
        logger.error('CiteFox failed to check due pages', error)
        code = CHECK_DUE_EXIT_ERROR
      } finally {
        // Check reports run after each job's searches. Let them finish before storage closes.
        await checkEngine.reportsIdle()
        background.close()
        alertSenders.close()
        try {
          appStorage.close()
        } catch (error: unknown) {
          logger.error('CiteFox could not close storage after --check-due', error)
        }
        storage = undefined
      }
      finishCheckDuePass(app, process.argv.slice(1), launchRequest, code, logger)
      return
    }

    installContentGuards()
    // Settings › Appearance: nativeTheme, the window background and View › Appearance (main/theme.ts).
    const theme = createThemeController({
      native: nativeTheme,
      windows: () => BrowserWindow.getAllWindows(),
      read: () => appStorage.readSettings().theme ?? DEFAULT_THEME,
      write: (choice) => {
        appStorage.writeSettings({ ...appStorage.readSettings(), theme: choice })
      },
      emit: (choice) => {
        broadcastIpcEvent('settings:themeChanged', { theme: choice })
      },
      onApplied: (choice) => {
        Menu.setApplicationMenu(
          Menu.buildFromTemplate(
            appMenuTemplate({
              appName: appInfo.name,
              platform: process.platform,
              dev: !app.isPackaged,
              theme: choice,
              onTheme: (picked) => {
                try {
                  theme.choose(picked)
                } catch (error: unknown) {
                  logger.error('CiteFox could not save the theme', error)
                }
              },
              onFileCommand: (command) => {
                broadcastIpcEvent('transfer:menu', { command })
              },
              onHelpCommand: (command) => {
                if (command === 'report-problem' || command === 'watch-tour') {
                  broadcastIpcEvent('diagnostics:menu', { command })
                  return
                }
                const shown = revealLogFile(appStorage.paths.root, logFile)
                if (!shown.ok) logger.warn('CiteFox could not show the logs folder', shown)
              }
            })
          )
        )
      }
    })
    theme.start()
    // "What CiteFox needs": shared by its IPC channels and the tray, so a click there takes effect here.
    const permissionConsent = createPermissionConsentStore({
      filePath: permissionsFilePath(appStorage.paths.root),
      existingInstall: () => readOnboardingFinished(appStorage.db)
    })
    // Scheduler wiring: interrupted checks keep their pages busy until resume settles.
    const resuming = guardResumingPages(appStorage, logger)
    const osJob = createAppOsJobControl(logger, { testProfile })
    const permissionSystem = electronPermissionSystem({ testProfile })
    const scheduleQueueTray = bindScheduleQueueTray({
      now: deps.now,
      emit: (status) => {
        broadcastIpcEvent('queue:status', status)
      },
      claudeConcurrency: () => appStorage.readSettings().claudeConcurrency,
      keys: () => listApiKeys(appStorage.db),
      storage: appStorage,
      runner: checkRunner,
      logger,
      loadSecrets: () => appSecretRegistry().list(),
      pageRunning: (projectId, pageId) =>
        checkEngine.pageRunning(projectId, pageId) || resuming.busy(projectId, pageId),
      osJob,
      onCapAlert,
      autoExport
    })
    configureExportSaveDialog((options) => dialog.showSaveDialog(options))
    configureReviewPdfPrinter(printHtmlToPdf)
    // Called on each pick, so an e2e stub of `dialog` applies.
    configureImportDialogs({
      open: (options) => dialog.showOpenDialog(options),
      save: (options) => dialog.showSaveDialog(options)
    })
    configureTransferDialogs(
      {
        open: (options) => dialog.showOpenDialog(options),
        save: (options) => dialog.showSaveDialog(options)
      },
      logger
    )
    configureAutoExportFolderDialog(() =>
      dialog.showOpenDialog({
        title: 'Choose a folder for automatic exports',
        buttonLabel: 'Choose folder',
        properties: ['openDirectory', 'createDirectory']
      })
    )
    configureExportReveal((filePath) => shell.showItemInFolder(filePath))
    configureDataFolderReveal((folderPath) => shell.showItemInFolder(folderPath))
    configureDiagnosticsShell((url) => shell.openExternal(url))
    const sitemapFetch = e2eSitemapFetch(app.isPackaged, process.env)
    const topicSiteReader = e2eTopicSiteReader(app.isPackaged, process.env)
    const topicDns = e2eTopicDns(app.isPackaged, process.env)
    // LLM-10: screens hold "Try again" while Claude Code is paused after a limit.
    onClaudeCodePauseChange((paused) => {
      broadcastIpcEvent('claudeCode:pauseChanged', { paused })
    })
    // "Join CiteFox", the daily ping and the update check (Docs/PRIVACY.md).
    const accountRuntime = startAccountRuntime({
      dataRoot: appStorage.paths.root,
      http,
      appInfo: () => appInfo,
      logger,
      packaged: app.isPackaged
    })
    stopAccount = accountRuntime.stop
    registerIpcHandlers(
      createIpcHandlers({
        appInfo: () => appInfo,
        accountServices: accountRuntime.services,
        storage: appStorage,
        secrets,
        logger,
        http,
        claudeCommand: createSpawnCommandTransport(),
        claudeProbe: createFsBinaryProbe(aiOnlyUnder),
        emitCheckupProgress: (event) => {
          broadcastIpcEvent('claudeCode:checkupProgress', event)
        },
        emitPageReadProgress: (event) => {
          broadcastIpcEvent('pages:readProgress', event)
        },
        emitFillProgress: (event) => {
          broadcastIpcEvent('projects:fillProgress', event)
        },
        emit: (channel, payload) => {
          broadcastIpcEvent(channel, payload)
        },
        knownSecrets: () => appSecretRegistry().list(),
        onThemeChanged: (choice) => {
          theme.changed(choice)
        },
        onHost: (opened) => {
          host = opened
          stopSitemapSync = startSitemapSyncLoop(
            structureRuntimeFor(opened, sitemapFetch !== undefined ? { sitemapFetch } : {})
          )
        },
        ...(sitemapFetch !== undefined ? { sitemapFetch } : {}),
        startAutopilotOff: !app.isPackaged && process.env.CITEFOX_START_AUTOPILOT === 'off',
        // Test runs never fetch site icons from the network (tests/e2e/launch.ts).
        faviconsOff: !app.isPackaged && process.env.CITEFOX_FAVICONS === 'off',
        ...(topicSiteReader !== undefined ? { readWebsitePage: topicSiteReader } : {}),
        ...(topicDns !== undefined ? { pageDns: topicDns } : {}),
        onSetupRunner: (runner) => {
          setupRunner = runner
          if (!setupRunnerDisabled(app.isPackaged, process.env)) runner.start()
        },
        scheduleQueueTray,
        checkEngine,
        permissionSystem,
        permissionConsent,
        appTools: createElectronAppTools({
          logger,
          testProfile,
          osJob,
          loginItem: permissionSystem.loginItem,
          shutdown,
          focusWindow: showMainWindow
        })
      }),
      logger
    )
    trayReady.current = installMainTray({
      schedule: scheduleQueueTray.schedule,
      queue: scheduleQueueTray.queue,
      tray: scheduleQueueTray.tray,
      createWindow: () => createMainWindow({ stateFile: appStorage.paths.windowStateFile }),
      allowDesktop: (projectId) => host?.email.service.getAlerts({ projectId }).desktop === true,
      activeProject: {
        read: () => readActiveProjectId(appStorage.db),
        write: (projectId) => writeActiveProjectId(appStorage.db, projectId)
      },
      notices: { count: () => listOpenNotices(appStorage.db).length },
      consent: {
        loginItem: () => permissionConsent.read().loginItem,
        notifications: () => notificationsAllowed(process.platform, permissionConsent.read())
      },
      logger,
      testProfile,
      // e2e runs (tests/e2e/launch.ts) seed checks on fixed dates: no due pass starts by itself.
      autoDue: app.isPackaged || process.env.CITEFOX_AUTO_CHECKS !== 'off'
    })
    stopDigestTimer = startAlertDigestTimer({
      flush: () => alertRules.flushDueDigests(),
      logger
    })
    stopReportLoop = startDueReportLoop({
      deliver: () =>
        deliverDueScheduledReports({
          storage: appStorage,
          delivery: createHeadlessReportsPort({
            secrets,
            logger,
            redacted: appSecretRegistry().list(),
            summaryWriter: claudeSummaryWriter(() => openCheckClaude(claudeParts))
          }),
          now: () => new Date(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
        }),
      logger
    })
    void resuming.track(resumeInterruptedChecks(checkEngine)).catch((error: unknown) => {
      logger.error('CiteFox failed to resume checks', error)
    })
    loadingFirstWindow = true
    await createMainWindow({ stateFile: appStorage.paths.windowStateFile })
    loadingFirstWindow = false
    windowsReady = true
    reportFailedReset(resetOutcome)

    app.on('activate', showMainWindow)
  })
  .catch((error: unknown) => {
    if (firstWindowLoadAbandoned()) {
      logger.warn('CiteFox closed while its window was loading', error)
      return
    }
    logger.error('CiteFox failed to start', error)
    if (isCheckDueFlag(process.argv)) {
      app.exit(CHECK_DUE_EXIT_ERROR)
      return
    }
    failStartup(error)
  })
