import { describe, expect, test } from 'vitest'
import type {
  AlertSettings,
  ApiKeyMetadata,
  AppSettings,
  BuyerProfile,
  CoverageMatrix,
  DeliveryRecord,
  EmailAccount,
  GenerationTemplate,
  PageResults,
  ProjectScoreSummary,
  PromptSetView,
  ReportScheduleListItem
} from '../domain'
import {
  assertIpcAllowListComplete,
  callIpcHandler,
  createCiteFoxApi,
  IPC_CHANNELS,
  IPC_EVENT_CHANNELS,
  IPC_INVOKE_CHANNELS,
  isClaudeCheckupPhase,
  isClaudeCheckupProgressState,
  isClaudeCheckupRowState,
  isIpcChannel,
  isIpcEventChannel,
  isIpcInvokeChannel,
  type AddApiKeyRequest,
  type AppInfo,
  type AppSettingsSnapshot,
  type CheckProgress,
  type ClaudeCheckupProgress,
  type ClaudeCheckupResult,
  type ConnectionsOverview,
  type DeleteReportScheduleResult,
  type FillFromWebsiteProgress,
  type FillFromWebsiteResult,
  type KeyTestResult,
  type OnboardingState,
  type OpenTerminalResult,
  type PageReadProgress,
  type PageReadResult,
  type PlaygroundAioResult,
  type PlaygroundRunResult,
  type ProjectDetail,
  type RemoveKeyResult,
  type ReplaceKeyRequest,
  type StatusCapsule,
  type TemplateUsage,
  type TrayLine
} from './index'
import { handlersReturning } from './test-fixtures'

type NestedKey<T> = T extends readonly (infer Item)[]
  ? NestedKey<Item>
  : T extends object
    ? {
        [K in keyof T]-?: K extends string ? K | NestedKey<NonNullable<T[K]>> : never
      }[keyof T]
    : never

type IpcResponse =
  | AppInfo
  | AppSettings
  | AppSettingsSnapshot
  | BuyerProfile
  | ClaudeCheckupProgress
  | ClaudeCheckupResult
  | ConnectionsOverview
  | FillFromWebsiteProgress
  | FillFromWebsiteResult
  | CoverageMatrix
  | KeyTestResult
  | PlaygroundRunResult
  | readonly PlaygroundRunResult[]
  | PlaygroundAioResult
  | GenerationTemplate
  | readonly GenerationTemplate[]
  | TemplateUsage
  | OnboardingState
  | OpenTerminalResult
  | PageReadProgress
  | PageReadResult
  | ProjectDetail
  | PromptSetView
  | RemoveKeyResult
  | StatusCapsule
  | TrayLine
  | ApiKeyMetadata
  | CheckProgress
  | PageResults
  | ProjectScoreSummary
  | EmailAccount
  | AlertSettings
  | ReportScheduleListItem
  | DeleteReportScheduleResult
  | DeliveryRecord

type SecretField = Extract<
  NestedKey<IpcResponse>,
  'secret' | 'password' | 'token' | 'apiKey' | 'suppliedText' | 'bodyText' | 'rawHtml'
>

/** Compile error if a response type grows a secret field. */
const responseHasNoSecret: [SecretField] extends [never] ? true : never = true

const overview: ConnectionsOverview = {
  serpapiRotation: 'in_order',
  keys: [],
  serpapi: 'off',
  claudeCode: 'off',
  jina: 'off',
  youtube: 'off',
  claudeCheckup: null,
  searchesLeft: null,
  issueCount: 0
}

const CONTRACT_CHANNELS = [
  'app:getInfo',
  'account:get',
  'account:save',
  'updates:get',
  'updates:check',
  'updates:dismiss',
  'app:resetKeepKeys',
  'app:openTestProfile',
  'connections:getOverview',
  'onboarding:getState',
  'onboarding:saveProfile',
  'onboarding:finish',
  'onboarding:getDraft',
  'onboarding:saveDraft',
  'onboarding:sectionEstimate',
  'onboarding:sectionPrompt',
  'onboarding:sectionRun',
  'onboarding:sectionRead',
  'onboarding:finishSetup',
  'onboarding:rowFill',
  'keys:add',
  'keys:test',
  'keys:rename',
  'keys:setOn',
  'keys:setCap',
  'keys:replace',
  'keys:update',
  'keys:reorder',
  'keys:list',
  'keys:remove',
  'claudeCode:runCheckup',
  'claudeCode:getCheckup',
  'claudeCode:openTerminal',
  'claudeCode:getPause',
  'settings:get',
  'settings:update',
  'settings:exportAllData',
  'settings:openDataFolder',
  'settings:revealPath',
  'status:getCapsule',
  'permissions:list',
  'permissions:request',
  'projects:list',
  'projects:get',
  'projects:create',
  'projects:update',
  'projects:switch',
  'projects:fillFromWebsite',
  'projects:checkCompanyDomain',
  'projects:searchProductCompetitors',
  'connections:activity',
  'connections:activityLog',
  'connections:projectClaude',
  'projectSettings:get',
  'projectSettings:update',
  'projectSettings:duplicate',
  'projectSettings:delete',
  'projectSettings:findCompetitors',
  'projectSettings:usage',
  'projectSettings:markets',
  'projectSettings:addMarket',
  'projectSettings:removeMarket',
  'projectSettings:restoreMarket',
  'projectSettings:setDefaultMarket',
  'pages:list',
  'pages:get',
  'pages:add',
  'pages:update',
  'pages:remove',
  'pages:search',
  'pages:pin',
  'pages:unpin',
  'pages:pinned',
  'pages:readStart',
  'pages:getRead',
  'buyerProfile:get',
  'buyerProfile:generate',
  'buyerProfile:update',
  'prompts:list',
  'prompts:listSets',
  'prompts:setActive',
  'prompts:generate',
  'prompts:add',
  'prompts:edit',
  'prompts:remove',
  'prompts:setEnabled',
  'prompts:reorder',
  'prompts:save',
  'prompts:discard',
  'prompts:reword',
  'prompts:versions',
  'questions:list',
  'questions:update',
  'questions:get',
  'questions:edit',
  'questions:restore',
  'search:questions',
  'prompts:addQuestions',
  'prompts:textRules',
  'prompts:addTargets',
  'prompts:googleQuestions',
  'gaps:get',
  'gaps:generate',
  'gaps:setDone',
  'gaps:redo',
  'gaps:getStates',
  'gaps:updateDraft',
  'gaps:setStatus',
  'coverage:list',
  'coverage:get',
  'templates:list',
  'templates:get',
  'templates:create',
  'templates:update',
  'templates:reset',
  'templates:delete',
  'templates:restore',
  'templates:setDefault',
  'templates:usage',
  'templates:usageDetail',
  'templates:steps',
  'templates:saveOverride',
  'templates:resetOverride',
  'templates:resetToShipped',
  'templates:versions',
  'templates:try',
  'playground:run',
  'playground:checkAio',
  'playground:saveToProject',
  'engines:get',
  'engines:set',
  'engines:page',
  'engines:setPage',
  'engines:estimate',
  'engines:question',
  'engines:summary',
  'engines:spend',
  'products:get',
  'products:page',
  'products:save',
  'products:saveFill',
  'products:setPage',
  'products:fillEstimate',
  'products:fillRow',
  'competitors:overview',
  'competitors:sortSites',
  'competitors:list',
  'competitors:save',
  'competitors:remove',
  'competitors:merge',
  'competitors:restore',
  'competitors:setSiteKind',
  'competitors:siteTypes',
  'competitors:setSiteType',
  'competitors:saveSiteTypeDef',
  'competitors:removeSiteTypeDef',
  'favicons:get',
  'import:pickFile',
  'import:read',
  'helpfill:estimate',
  'helpfill:prompt',
  'helpfill:read',
  'helpfill:describe',
  'helpfill:setupEstimate',
  'helpfill:setupPrompt',
  'helpfill:setupRead',
  'import:preview',
  'import:validate',
  'import:commit',
  'import:undo',
  'import:template',
  'import:getDraft',
  'import:saveDraft',
  'import:clearDraft',
  'tray:getLine',
  'checks:start',
  'checks:cancel',
  'checks:get',
  'checks:listActive',
  'checks:getPrompt',
  'checks:notCited',
  'results:get',
  'results:history',
  'scores:listProjects',
  'scores:listPages',
  'sentiment:get',
  'sentiment:generateBrandPrompts',
  'sentiment:saveBrandPrompts',
  'sentiment:listFacts',
  'sentiment:addFact',
  'sentiment:deleteFact',
  'sentiment:reread',
  'schedule:getApp',
  'schedule:updateApp',
  'schedule:getProject',
  'schedule:updateProject',
  'schedule:listDue',
  'queue:getStatus',
  'queue:pause',
  'queue:resume',
  'queue:checkDue',
  'tray:getMenu',
  'email:getSettings',
  'email:setMode',
  'email:saveAccount',
  'email:removeAccount',
  'email:test',
  'alerts:get',
  'alerts:update',
  'alerts:testSlack',
  'alerts:listRules',
  'alerts:saveRule',
  'alerts:deleteRule',
  'alerts:setRuleStatus',
  'alerts:dryRun',
  'alerts:listLog',
  'reports:list',
  'reports:save',
  'reports:setStatus',
  'reports:sendTest',
  'reports:delete',
  'reports:sendNow',
  'deliveries:list',
  'deliveries:resend',
  'reports:metrics',
  'reports:download',
  'reports:review',
  'reports:getBranding',
  'reports:setBranding',
  'reports:getSender',
  'reports:setSender',
  'exports:preview',
  'exports:start',
  'exports:getAuto',
  'exports:setAuto',
  'exports:chooseAutoFolder',
  'exports:reveal',
  'fixes:list',
  'fixes:listProject',
  'fixes:preview',
  'fixes:create',
  'fixes:runFollowUp',
  'fixes:delete',
  'fixes:update',
  'fixes:restore',
  'fixes:ledger',
  'fixes:setOwner',
  'fixes:setKind',
  'fixes:indexPreview',
  'fixes:checkIndex',
  'fixes:suggestAnchors',
  'fixes:lostGround',
  'fixes:saveRecoveryPlan',
  'fixes:searches',
  'fixes:pageFixCount',
  'fixes:briefs',
  'fixes:saveBrief',
  'fixes:draftPageEdit',
  'fixes:pageEdit',
  'fixes:savePageEditHtml',
  'fixes:draftOwnerWhy',
  'fixes:ownerWhy',
  'history:list',
  'history:listProject',
  'history:compare',
  'history:addNote',
  'history:updateNote',
  'history:deleteNote',
  'history:delete',
  'pageChanges:list',
  'pageChanges:versions',
  'pageChanges:diff',
  'pageChanges:dismiss',
  'pageChanges:restore',
  'projectRules:list',
  'projectRules:save',
  'projectRules:delete',
  'tracking:changes',
  'communities:get',
  'communities:checkThreads',
  'communities:refreshVideos',
  'communities:getSettings',
  'communities:setSettings',
  'videos:get',
  'videos:writeBrief',
  'videos:update',
  'videos:markSent',
  'videos:track',
  'videos:export',
  'sitemaps:get',
  'sitemaps:discover',
  'sitemaps:add',
  'sitemaps:remove',
  'sitemaps:setIncluded',
  'sitemaps:setRules',
  'sitemaps:sync',
  'import:candidates',
  'import:parseUrls',
  'import:estimate',
  'import:claudePick',
  'import:track',
  'structure:get',
  'structure:clusterPages',
  'structure:recluster',
  'structure:undoClusters',
  'structure:renameCluster',
  'structure:mergeClusters',
  'structure:movePage',
  'structure:movePages',
  'structure:createCluster',
  'structure:deleteCluster',
  'structure:splitCluster',
  'structure:setPageRole',
  'structure:trackCluster',
  'structure:setSilo',
  'structure:createGroup',
  'structure:renameGroup',
  'structure:deleteGroup',
  'structure:setGroupPages',
  'structure:groupPages',
  'structure:listMemberships',
  'structure:clusterSummary',
  'structure:suggestLinks',
  'grid:listViews',
  'grid:saveView',
  'grid:deleteView',
  'grid:exportCsv',
  'grid:getScreenView',
  'grid:setScreenView',
  'grid:getSummaryBoard',
  'grid:setSummaryBoard',
  'guide:get',
  'guide:update',
  'guide:signal',
  'guide:restart',
  'allpages:list',
  'allpages:citations',
  'allpages:citedPages',
  'allpages:estimate',
  'allpages:run',
  'allpages:pointHere',
  'allpages:undoPoint',
  'allpages:merge',
  'allpages:undoMerge',
  'allpages:trackUrl',
  'allpages:undoTrack',
  'allpages:ignoreUrl',
  'visibility:overview',
  'assist:describe',
  'assist:run',
  'llm:usage',
  'llm:calls',
  'ask:question',
  'ask:filter',
  'ask:options',
  'assistant:ask',
  'setup:status',
  'setup:page',
  'setup:start',
  'setup:stop',
  'setup:checkWhenReady',
  'setup:retry',
  'setup:pause',
  'setup:setRate',
  'notices:list',
  'notices:resolve',
  'claudeCode:checkupProgress',
  'claudeCode:pauseChanged',
  'pages:readProgress',
  'projects:fillProgress',
  'checks:progress',
  'checks:finished',
  'results:changed',
  'guide:changed',
  'queue:status',
  'exports:progress',
  'sitemaps:syncFinished',
  'sentiment:updated',
  'setup:progress',
  'notices:changed',
  'topics:list',
  'topics:update',
  'topics:describeStep',
  'topics:suggestedStart',
  'topics:listDrafts',
  'topics:createDraft',
  'topics:getDraft',
  'topics:updateDraft',
  'topics:discardDraft',
  'topics:discoverSeed',
  'topics:writeProfile',
  'topics:discoverProfileSection',
  'topics:rewriteSection',
  'topics:generateQuestions',
  'topics:discoverStageQuestions',
  'topics:findJourneyGaps',
  'topics:rewriteQuestion',
  'topics:discoverTerms',
  'topics:generateKeywords',
  'topics:suggestMissingGroups',
  'topics:mergeNearDuplicates',
  'topics:keywordSummary',
  'topics:readCsvColumns',
  'topics:importQuestions',
  'topics:cleanupWithClaude',
  'topics:readCompetitorPage',
  'topics:competitorQuestions',
  'topics:pageCandidates',
  'topics:matchPages',
  'topics:setTarget',
  'topics:draftPageBrief',
  'topics:targetSuggestions',
  'topics:suggestTarget',
  'topics:matchTracked',
  'topics:estimate',
  'topics:start',
  'topics:results',
  'topics:whyNotCited',
  'topics:explainCitation',
  'topics:draftFix',
  'topics:topicSummary',
  'topics:moveQuestions',
  'topics:setQuestionStage',
  'topics:merge',
  'topics:split',
  'topics:createTopics',
  'topics:createFromDraft',
  'topics:suggestTopics',
  'topics:sortQuestions',
  'topics:suggestName',
  'topics:createEmpty',
  'topics:duplicate',
  'topics:folders',
  'topics:createFolder',
  'topics:renameFolder',
  'topics:deleteFolder',
  'topics:moveToFolder',
  'topics:progress',
  'assist:progress',
  'start:homework',
  'start:get',
  'start:suggestUrls',
  'start:progress',
  'start:stop',
  'start:begin',
  'start:status',
  'start:edit',
  'start:undo',
  'start:edits',
  'start:changed',
  'settings:themeChanged',
  'transfer:projectSummary',
  'transfer:exportProject',
  'transfer:pickProject',
  'transfer:projectPreview',
  'transfer:importProject',
  'transfer:exportSettings',
  'transfer:pickSettings',
  'transfer:settingsPreview',
  'transfer:applySettings',
  'transfer:menu',
  'diagnostics:build',
  'diagnostics:send',
  'diagnostics:save',
  'diagnostics:reveal-logs',
  'diagnostics:open-mail',
  'diagnostics:menu'
] as const

const keyMetadata: ApiKeyMetadata = {
  id: 'key-1',
  provider: 'serpapi',
  name: 'Personal',
  keychainRef: 'serpapi/personal',
  hint: 'b1f4',
  rotationOrder: 1,
  cap: 250,
  on: true,
  projectIds: [],
  state: 'ok',
  lastReason: null,
  serpapiUsage: { used: 38, planLimit: 250, plan: 'Developer' }
}

describe('IPC allow-list', () => {
  test('lists the M1, M2, and M3 invokes and the push events', () => {
    expect(assertIpcAllowListComplete()).toBe(true)
    expect(responseHasNoSecret).toBe(true)
    // The allow-list is derived from the area spec records, so compare as a set.
    expect(new Set(IPC_CHANNELS).size).toBe(IPC_CHANNELS.length)
    expect([...IPC_CHANNELS].sort()).toEqual([...CONTRACT_CHANNELS].sort())
    expect([...IPC_INVOKE_CHANNELS, ...IPC_EVENT_CHANNELS]).toEqual([...IPC_CHANNELS])
    expect(isIpcChannel('app:getInfo')).toBe(true)
    expect(isIpcChannel('claudeCode:checkupProgress')).toBe(true)
    expect(isIpcInvokeChannel('keys:add')).toBe(true)
    expect(isIpcInvokeChannel('claudeCode:checkupProgress')).toBe(false)
    expect(isIpcEventChannel('claudeCode:checkupProgress')).toBe(true)
    expect(isIpcEventChannel('keys:add')).toBe(false)
    expect(isIpcChannel('shell:openExternal')).toBe(false)
    expect(isIpcChannel('')).toBe(false)
    expect(isClaudeCheckupPhase('binary')).toBe(true)
    expect(isClaudeCheckupPhase('login')).toBe(true)
    expect(isClaudeCheckupPhase('roundTrip')).toBe(true)
    expect(isClaudeCheckupPhase('plan')).toBe(false)
    expect(isClaudeCheckupRowState('ok')).toBe(true)
    expect(isClaudeCheckupRowState('warning')).toBe(true)
    expect(isClaudeCheckupRowState('skipped')).toBe(true)
    expect(isClaudeCheckupRowState('running')).toBe(false)
    expect(isClaudeCheckupProgressState('running')).toBe(true)
    expect(isClaudeCheckupProgressState('failed')).toBe(false)
  })

  test('the renderer API forwards only allow-listed channels', async () => {
    const seen: string[] = []
    const api = createCiteFoxApi(
      async (channel) => {
        seen.push(channel)
        if (channel === 'app:getInfo') {
          const info: AppInfo = { name: 'CiteFox', version: '0.1.0' }
          return info
        }
        return overview
      },
      () => () => undefined
    )

    expect(Object.keys(api).sort()).toEqual([...IPC_CHANNELS].sort())
    await expect(api['app:getInfo']()).resolves.toEqual({ name: 'CiteFox', version: '0.1.0' })
    await expect(api['connections:getOverview']()).resolves.toEqual(overview)
    expect(seen).toEqual(['app:getInfo', 'connections:getOverview'])
  })

  test('forwards a one-argument request and rejects the wrong arity', async () => {
    const add: AddApiKeyRequest = {
      provider: 'serpapi',
      name: 'Personal',
      secret: 'super-secret-value-b1f4',
      cap: null,
      projectIds: []
    }
    let received: AddApiKeyRequest | undefined
    const handlers = handlersReturning({
      'app:getInfo': () => ({ name: 'CiteFox', version: '0.1.0' }),
      'keys:add': (request) => {
        received = request
        return keyMetadata
      }
    })

    expect(callIpcHandler(handlers, 'keys:add', [add])).toEqual(keyMetadata)
    expect(received).toEqual(add)
    expect(() => callIpcHandler(handlers, 'app:getInfo', ['extra'])).toThrow(/unexpected arguments/)
    expect(() => callIpcHandler(handlers, 'keys:add', [])).toThrow(
      'Blocked IPC channel: keys:add received unexpected arguments'
    )
    expect(() => callIpcHandler(handlers, 'keys:add', [add, 'extra'])).toThrow(
      /unexpected arguments/
    )
  })

  test('subscribes to checkup progress and does not put that event on the invoke path', () => {
    const seen: string[] = []
    const progress: ClaudeCheckupProgress = {
      phase: 'binary',
      state: 'running',
      detail: 'Looking for claude',
      nextStep: null
    }
    const api = createCiteFoxApi(
      async () => {
        throw new Error('invoke should not run')
      },
      (channel, listener) => {
        seen.push(channel)
        listener(progress)
        return () => {
          seen.push(`off:${channel}`)
        }
      }
    )

    const received: ClaudeCheckupProgress[] = []
    const unsubscribe = api['claudeCode:checkupProgress']((payload) => {
      received.push(payload)
    })
    unsubscribe()
    expect(seen).toEqual(['claudeCode:checkupProgress', 'off:claudeCode:checkupProgress'])
    expect(received).toEqual([progress])
  })

  test('results carry a hint and a keychain ref, never a secret', () => {
    const tested: KeyTestResult = {
      key: keyMetadata,
      message: 'Key works. 38 of 250 searches used this month.',
      reason: null
    }
    const replace: ReplaceKeyRequest = { id: 'key-1', secret: 'another-secret-value' }
    const serialized = JSON.stringify({ overview, tested, keyMetadata })
    expect(serialized).not.toMatch(/secret|password|api[_-]?key|token/i)
    expect(tested.key.hint).toBe('b1f4')
    expect(tested.key.keychainRef).toBe('serpapi/personal')
    expect(replace.secret).toContain('secret')
    expect(Object.hasOwn(tested.key, 'secret')).toBe(false)
    expect(Object.hasOwn(tested, 'secret')).toBe(false)
  })
})
