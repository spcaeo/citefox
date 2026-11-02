/**
 * Main's invoke handlers. Each area module returns the handlers for its spec
 * records (`IpcHandlersFor<typeof …Channels>`). This file composes them into the
 * full `IpcHandlerMap`, so an invoke with no handler fails typecheck here.
 */

import type { IpcHandlerMap } from '@shared/ipc'
import { bindEmailIpcHandlers, bindReportIpcHandlers } from '../email/engine-email'
import { createCheckEngine } from '../engine/checks/engine'
import { scheduledReportPayload } from '../headless/due-reports'
import { bindExportIpcHandlers } from '../export/ipc'
import { sleep } from '../providers/timeout'
import { bindScheduleQueueTray } from '../scheduler/ipc'
import { createPermissionConsentStore, permissionsFilePath } from '../permissions/consent'
import { createPermissionsService } from '../permissions/service'
import { memoryPermissionSystem } from '../permissions/system'
import { listApiKeys, readOnboardingFinished } from '../storage/records'
import { createAlertRulesService } from '../alerts/service'
import { emailServiceSenders, withAlertRules } from '../alerts/runtime'
import { alertRuleHandlers } from './alerts'
import { allPagesHandlers } from './allpages'
import { appHandlers } from './app'
import { accountHandlers, defaultAccountServices } from './account'
import { assistHandlers } from './assist'
import { checksHandlers } from './checks'
import { topicClustersHandlers } from './topicClusters'
import { topicsHandlers } from './topics'
import { communitiesHandlers } from './communities'
import { competitorsHandlers } from './competitors'
import { faviconsHandlers } from './favicons'
import { connectionsHandlers, runCheckup } from './connections'
import { fixesHandlers } from './fixes'
import { fixLoopHandlers } from './fixLoop'
import { helpFillHandlers } from './helpfill'
import { historyHandlers } from './history'
import { pageChangesHandlers } from './page-changes'
import { projectRulesHandlers } from './project-rules'
import { importerHandlers } from './importer'
import { gridHandlers } from './grid'
import { guideHandlers } from './guide'
import { withGuideSignals } from '../guide/signals'
import { guard, toContext, type IpcHandlerDeps } from './context'
import { keysHandlers, presentKeys } from './keys'
import { onboardingHandlers } from './onboarding'
import { productsHandlers } from './products'
import { enginesHandlers } from './engines'
import { pagesHandlers } from './pages'
import { permissionsHandlers } from './permissions'
import { playgroundHandlers } from './playground'
import { projectsHandlers } from './projects'
import { projectSettingsHandlers } from './projectSettings'
import { promptsHandlers } from './prompts'
import { questionsHandlers } from './questions'
import { scheduleHandlers } from './schedule'
import { searchHandlers } from './search'
import { structureHandlers } from './structure'
import { sentimentHandlers } from './sentiment'
import { startHandlers } from './start'
import { setupHandlers } from './setup'
import { createSetupRunner } from '../setup-runner/runner'
import { recordSetupFailedNotice } from '../setup-runner/notice'
import { clearFirstCheckForPages } from '../setup-runner/first-check'
import { withSetupKicks } from '../setup-runner/kicks'
import { templatesHandlers } from './templates'
import { transferHandlers } from './transfer'
import { visibilityHandlers } from './visibility'
import { metricsHandlers } from './metrics'

export type { IpcHandlerDeps }

/** Marker for channels the engine has not implemented. */
export const NOT_IMPLEMENTED = 'Not implemented'

export function createIpcHandlers(deps: IpcHandlerDeps): IpcHandlerMap {
  const ctx = toContext(deps)
  deps.onHost?.(ctx)
  const alertRules = createAlertRulesService({
    storage: ctx.storage,
    logger: ctx.logger,
    now: ctx.now,
    createId: ctx.createId,
    senders: deps.alertSenders ?? emailServiceSenders(ctx.storage, () => undefined)
  })
  // Production passes an engine it already wrapped (main/index.ts); this one is for tests.
  const checks =
    deps.checkEngine ??
    withAlertRules(
      createCheckEngine({
        storage: ctx.storage,
        secrets: ctx.secrets,
        logger: ctx.logger,
        http: ctx.http,
        now: ctx.now,
        createId: ctx.createId,
        emitProgress: (event) => deps.emit('checks:progress', event),
        emitFinished: (event) => deps.emit('checks:finished', event),
        emitResultsChanged: (event) => deps.emit('results:changed', event),
        knownSecrets: ctx.knownSecrets,
        sleep,
        ...(deps.beforeCheckRequest !== undefined ? { beforeRequest: deps.beforeCheckRequest } : {})
      }),
      alertRules
    )
  const scheduleQueueTray =
    deps.scheduleQueueTray ??
    bindScheduleQueueTray({
      now: ctx.now,
      emit: (status) => {
        deps.emit('queue:status', status)
      },
      claudeConcurrency: () => deps.storage.readSettings().claudeConcurrency,
      keys: () => listApiKeys(deps.storage.db),
      storage: deps.storage
    })
  const setupRunner = createSetupRunner({
    host: ctx,
    emit: (progress) => deps.emit('setup:progress', progress),
    emitAssistProgress: (progress) => deps.emit('assist:progress', progress),
    // "Check automatically when ready": the same path as Start first check.
    startFirstCheck: (projectId, pageId) => {
      checks
        .start({ projectId, pageIds: [pageId], marketIds: null, promptIds: null })
        .catch((error: unknown) => {
          ctx.logger.warn('the automatic first check did not start', {
            message: error instanceof Error ? error.message : 'failed'
          })
        })
    },
    onGaveUp: (failure) => {
      recordSetupFailedNotice(
        { storage: ctx.storage, logger: ctx.logger, now: ctx.now },
        failure,
        ctx.knownSecrets()
      )
    },
    ...deps.setupRunner
  })
  deps.onSetupRunner?.(setupRunner)
  const permissions = createPermissionsService({
    storage: ctx.storage,
    secrets: ctx.secrets,
    now: ctx.now,
    system: deps.permissionSystem ?? memoryPermissionSystem({ platform: process.platform }),
    consent:
      deps.permissionConsent ??
      createPermissionConsentStore({
        filePath: permissionsFilePath(ctx.storage.paths.root),
        existingInstall: () => readOnboardingFinished(ctx.storage.db)
      }),
    keys: () => presentKeys(ctx, listApiKeys(ctx.storage.db)),
    schedule: scheduleQueueTray.schedule,
    runCheckup: () => runCheckup(ctx, { binaryPath: null }),
    logger: ctx.logger
  })
  return withGuideSignals(withSetupKicks(composeHandlers(), setupRunner, ctx), ctx)

  function composeHandlers(): IpcHandlerMap {
    return {
      ...appHandlers(ctx),
      ...accountHandlers(ctx, deps.accountServices ?? defaultAccountServices(ctx)),
      ...connectionsHandlers(ctx),
      ...onboardingHandlers(ctx, checks),
      ...keysHandlers(ctx),
      ...projectsHandlers(ctx),
      ...projectSettingsHandlers(ctx),
      ...pagesHandlers(ctx, setupRunner),
      ...promptsHandlers(ctx),
      ...questionsHandlers(ctx),
      ...searchHandlers(ctx),
      ...templatesHandlers(ctx),
      ...playgroundHandlers(ctx),
      ...assistHandlers(ctx),
      ...checksHandlers(ctx, checks, (projectId, pageIds) =>
        clearFirstCheckForPages(ctx, projectId, pageIds)
      ),
      ...fixesHandlers(ctx, checks),
      ...fixLoopHandlers(ctx),
      ...historyHandlers(ctx),
      ...pageChangesHandlers(ctx),
      ...projectRulesHandlers(ctx),
      ...communitiesHandlers(ctx, deps.communities),
      ...gridHandlers(ctx),
      ...guideHandlers(ctx),
      ...allPagesHandlers(ctx, checks),
      ...scheduleHandlers(ctx, scheduleQueueTray),
      ...structureHandlers(ctx, {
        ...(deps.sitemapFetch !== undefined ? { sitemapFetch: deps.sitemapFetch } : {}),
        ...(deps.rereadPage !== undefined ? { reread: deps.rereadPage } : {})
      }),
      ...startHandlers(
        ctx,
        {
          ...(deps.sitemapFetch !== undefined ? { sitemapFetch: deps.sitemapFetch } : {}),
          ...(deps.rereadPage !== undefined ? { reread: deps.rereadPage } : {})
        },
        checks,
        deps.startAutopilotOff === true
      ),
      ...sentimentHandlers(ctx),
      ...topicsHandlers(ctx, checks),
      ...topicClustersHandlers(ctx, checks),
      ...productsHandlers(ctx),
      ...enginesHandlers(ctx),
      ...importerHandlers(ctx),
      ...helpFillHandlers(ctx),
      ...transferHandlers(ctx, scheduleQueueTray.schedule),
      ...visibilityHandlers(ctx),
      ...metricsHandlers(ctx),
      ...competitorsHandlers(ctx),
      ...faviconsHandlers(ctx, deps),
      ...setupHandlers(ctx, setupRunner),
      ...permissionsHandlers(ctx, permissions),
      ...bindEmailIpcHandlers(ctx.email, (channel, run) => guard(channel, ctx, run)),
      ...alertRuleHandlers(ctx, alertRules),
      ...bindReportIpcHandlers(ctx.email, (channel, run) => guard(channel, ctx, run), {
        payloadFor: (schedule) =>
          scheduledReportPayload(ctx.storage, schedule, ctx.email.clock.now(), {
            logger: ctx.logger,
            redacted: ctx.knownSecrets()
          })
      }),
      ...bindExportIpcHandlers(
        {
          storage: ctx.storage,
          emitProgress: (event) => {
            deps.emit('exports:progress', event)
          },
          now: ctx.now,
          createId: ctx.createId,
          knownSecrets: ctx.knownSecrets,
          logger: ctx.logger
        },
        (channel, run) => guard(channel, ctx, run)
      )
    }
  }
}
