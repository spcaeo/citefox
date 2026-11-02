import type { ApiKeyMetadata } from '@shared/domain'
import type {
  AddApiKeyRequest,
  AppInfo,
  AppResetResult,
  AppSettingsPatch,
  AppSettingsSnapshot,
  CiteFoxApi,
  ClaudeCheckupProgress,
  ExportAllDataResult,
  KeyIdRequest,
  KeyTestResult,
  OnboardingDraft,
  OnboardingState,
  OpenDataFolderResult,
  OpenTerminalResult,
  OpenTestProfileRequest,
  OpenTestProfileResult,
  RemoveKeyResult,
  RenameKeyRequest,
  ReplaceKeyRequest,
  RunClaudeCheckupRequest,
  SaveProfileRequest,
  SetKeyCapRequest,
  SetKeyOnRequest,
  StatusCapsule
} from '@shared/ipc'
import type { SiteReadClient } from '../fill/types'
import type { OnboardingCheckupResult, OnboardingConnections } from './claudeLogin'

export {
  CLIENT_MODE_STORAGE_KEY,
  MOCK_PACE_STORAGE_KEY,
  MOCK_SCENARIO_STORAGE_KEY,
  readStoredClientMode,
  resolveClientMode
} from './flags'
export type { ClientMode } from './flags'

/**
 * The slice of {@link CiteFoxApi} the onboarding screens call.
 * Method names are local. Argument and result types are the IPC contract.
 */
export interface OnboardingClient extends SiteReadClient {
  getInfo(): Promise<AppInfo>
  /** Build menu: back to the first run, keeping the API keys; the app restarts on success. */
  resetKeepKeys(): Promise<AppResetResult>
  /** Build menu: "Test as a new user" opens the separate test profile window. */
  openTestProfile(request: OpenTestProfileRequest): Promise<OpenTestProfileResult>
  getState(): Promise<OnboardingState>
  saveProfile(request: SaveProfileRequest): Promise<OnboardingState>
  finish(): Promise<OnboardingState>
  /** The unfinished onboarding kept across restarts, or null. Never holds a secret. */
  getDraft(): Promise<OnboardingDraft | null>
  saveDraft(draft: OnboardingDraft): Promise<{ saved: boolean }>
  getOverview(): Promise<OnboardingConnections>
  addKey(request: AddApiKeyRequest): Promise<ApiKeyMetadata>
  testKey(request: KeyIdRequest): Promise<KeyTestResult>
  replaceKey(request: ReplaceKeyRequest): Promise<ApiKeyMetadata>
  renameKey(request: RenameKeyRequest): Promise<ApiKeyMetadata>
  setKeyOn(request: SetKeyOnRequest): Promise<ApiKeyMetadata>
  setKeyCap(request: SetKeyCapRequest): Promise<ApiKeyMetadata>
  removeKey(request: KeyIdRequest): Promise<RemoveKeyResult>
  getCapsule(): Promise<StatusCapsule>
  runCheckup(request: RunClaudeCheckupRequest): Promise<OnboardingCheckupResult>
  getCheckup(): Promise<OnboardingCheckupResult | null>
  openTerminal(): Promise<OpenTerminalResult>
  onCheckupProgress(listener: (payload: ClaudeCheckupProgress) => void): () => void
  getSettings(): Promise<AppSettingsSnapshot>
  updateSettings(patch: AppSettingsPatch): Promise<AppSettingsSnapshot>
  /** Settings → Data. Main asks where to save; the renderer never sends a path. */
  exportAllData(): Promise<ExportAllDataResult>
  openDataFolder(): Promise<OpenDataFolderResult>
}

function requireApi(): CiteFoxApi {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}

export function createIpcOnboardingClient(): OnboardingClient {
  return {
    getInfo: () => requireApi()['app:getInfo'](),
    resetKeepKeys: () => requireApi()['app:resetKeepKeys'](),
    openTestProfile: (request) => requireApi()['app:openTestProfile'](request),
    fillFromWebsite: (request) => requireApi()['projects:fillFromWebsite'](request),
    onFillProgress: (listener) => requireApi()['projects:fillProgress'](listener),
    checkCompanyDomain: (request) => requireApi()['projects:checkCompanyDomain'](request),
    searchProductCompetitors: (request) =>
      requireApi()['projects:searchProductCompetitors'](request),
    getState: () => requireApi()['onboarding:getState'](),
    saveProfile: (request) => requireApi()['onboarding:saveProfile'](request),
    finish: () => requireApi()['onboarding:finish'](),
    getDraft: () => requireApi()['onboarding:getDraft'](),
    saveDraft: (draft) => requireApi()['onboarding:saveDraft'](draft),
    getOverview: () => requireApi()['connections:getOverview'](),
    addKey: (request) => requireApi()['keys:add'](request),
    testKey: (request) => requireApi()['keys:test'](request),
    replaceKey: (request) => requireApi()['keys:replace'](request),
    renameKey: (request) => requireApi()['keys:rename'](request),
    setKeyOn: (request) => requireApi()['keys:setOn'](request),
    setKeyCap: (request) => requireApi()['keys:setCap'](request),
    removeKey: (request) => requireApi()['keys:remove'](request),
    getCapsule: () => requireApi()['status:getCapsule'](),
    runCheckup: (request) => requireApi()['claudeCode:runCheckup'](request),
    getCheckup: () => requireApi()['claudeCode:getCheckup'](),
    openTerminal: () => requireApi()['claudeCode:openTerminal'](),
    onCheckupProgress: (listener) => requireApi()['claudeCode:checkupProgress'](listener),
    getSettings: () => requireApi()['settings:get'](),
    updateSettings: (patch) => requireApi()['settings:update'](patch),
    exportAllData: () => requireApi()['settings:exportAllData'](),
    openDataFolder: () => requireApi()['settings:openDataFolder']()
  }
}
