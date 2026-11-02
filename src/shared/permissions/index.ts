/**
 * "What CiteFox needs" (owner feedback #2): one pure mapping from saved state to
 * the checklist, shared by main (real inputs) and the dev and e2e mock (fake
 * inputs), so both show the same words. Nothing here reads the keychain, the
 * OS job, or the system: the caller passes what it already knows.
 */

import { serpKeyAllowance, type ApiKeyMetadata, type JinaMode } from '../domain'
import type {
  PermissionItem,
  PermissionPlatform,
  PermissionsSnapshot,
  PermissionState
} from '../ipc'
import { claudeItem, claudeStatus, type ClaudeInputs } from './claude'

export {
  CLAUDE_CHECKUP_FRESH_MS,
  claudeItem,
  claudeProblem,
  claudeStatus,
  friendlyModel,
  type ClaudeInputs
} from './claude'

export interface PermissionInputs extends ClaudeInputs {
  jinaMode: JinaMode
  keychain: {
    /** Saved secrets (API keys and email passwords). */
    stored: number
    /** ISO-8601 UTC of the last "Check access now". Null when never run. */
    checkedAt: string | null
    /** Secrets that last check could not read. */
    failed: number
  }
  notifications: {
    supported: boolean
    /** The user turned them on here (on macOS that showed the system prompt). */
    asked: boolean
    /** How the last test notification went. Null when none was sent. */
    lastResult: 'shown' | 'failed' | null
  }
  background: { supported: boolean; installed: boolean }
  loginItem: { supported: boolean; enabled: boolean }
  /** "Test as a new user": background checks and the login item belong to the real install. */
  testProfile?: boolean
  autoExport: { enabled: number; unusable: number }
  email: { accounts: number }
}

/** Background checks and the login item in the "Test as a new user" profile. */
export const TEST_PROFILE_UNAVAILABLE = 'Not available in a test profile'

/** `process.platform` folded to the four the checklist words differ for. */
export function permissionPlatform(platform: string): PermissionPlatform {
  if (platform === 'darwin' || platform === 'win32' || platform === 'linux') return platform
  return 'other'
}

export function buildPermissionsSnapshot(input: PermissionInputs): PermissionsSnapshot {
  const items: PermissionItem[] = [
    claudeItem(input),
    serpapiItem(input.keys),
    keychainItem(input),
    jinaItem(input.keys, input.jinaMode),
    notificationsItem(input),
    backgroundItem(input),
    loginItem(input),
    exportFolderItem(input),
    emailItem(input)
  ]
  return {
    platform: input.platform,
    items,
    claude: claudeStatus(input),
    requiredOpen: items.filter((item) => item.need === 'required' && !isReady(item.state)).length,
    readyCount: items.filter((item) => isReady(item.state)).length,
    checkedAt: input.now
  }
}

export function isReady(state: PermissionState): boolean {
  return state === 'ok' || state === 'not_needed'
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
}

function firstKey(keys: readonly ApiKeyMetadata[], provider: string): ApiKeyMetadata | null {
  const on = keys.filter((key) => key.provider === provider && key.on)
  return on.find((key) => key.state === 'ok') ?? on[0] ?? null
}

function reasonText(key: ApiKeyMetadata): string {
  if (key.lastReason === 'rejected') return 'Key rejected'
  if (key.lastReason === 'out_of_searches') return 'Out of searches this month'
  if (key.lastReason === 'rate_limited') return 'Rate limited'
  if (key.lastReason === 'timeout') return 'Test timed out'
  return 'Needs attention'
}

function serpapiItem(keys: readonly ApiKeyMetadata[]): PermissionItem {
  const key = firstKey(keys, 'serpapi')
  const base = {
    id: 'serpapi' as const,
    title: 'SerpApi key',
    purpose: 'Runs the Google searches that show AI Overviews. Each check uses searches.',
    need: 'required' as const,
    checks: [],
    osPrompt: null
  }
  if (key === null) {
    return {
      ...base,
      state: 'action',
      statusLabel: 'No key yet',
      detail: 'Paste a key from serpapi.com. It is saved in your keychain.',
      action: { kind: 'setup', label: 'Add key' }
    }
  }
  if (key.state === 'unchecked') {
    return {
      ...base,
      state: 'unchecked',
      statusLabel: 'Saved, not tested',
      detail: null,
      action: { kind: 'setup', label: 'Test key' }
    }
  }
  if (key.state !== 'ok') {
    return {
      ...base,
      state: 'action',
      statusLabel: reasonText(key),
      detail: 'Open Connections to test the key or add another one.',
      action: { kind: 'setup', label: 'Fix key' }
    }
  }
  let left: number | null = null
  for (const item of keys) {
    if (item.provider !== 'serpapi' || !item.on || item.state !== 'ok') continue
    const allowance = serpKeyAllowance(item)
    if (allowance !== null) left = (left ?? 0) + allowance.left
  }
  return {
    ...base,
    state: 'ok',
    statusLabel: left === null ? 'Works' : `Works · ${count(left, 'search', 'searches')} left`,
    detail: key.serpapiUsage?.plan ? `Plan: ${key.serpapiUsage.plan}` : null,
    action: null
  }
}

function jinaItem(keys: readonly ApiKeyMetadata[], mode: JinaMode): PermissionItem {
  const key = firstKey(keys, 'jina')
  const base = {
    id: 'jina' as const,
    title: 'Jina Reader',
    purpose: 'Reads a page when a normal fetch is blocked. Works without a key at lower limits.',
    need: 'optional' as const,
    checks: [],
    osPrompt: null
  }
  if (mode === 'never') {
    return {
      ...base,
      state: 'not_needed',
      statusLabel: 'Turned off',
      detail: null,
      action: null
    }
  }
  if (key === null) {
    return {
      ...base,
      state: 'off',
      statusLabel: 'No key · reads without one',
      detail: null,
      action: { kind: 'setup', label: 'Add key' }
    }
  }
  if (key.state === 'ok') {
    return { ...base, state: 'ok', statusLabel: 'Key works', detail: null, action: null }
  }
  return {
    ...base,
    state: key.state === 'unchecked' ? 'unchecked' : 'action',
    statusLabel: key.state === 'unchecked' ? 'Saved, not tested' : reasonText(key),
    detail: 'Without a working key, Jina still reads pages at lower limits.',
    action: { kind: 'setup', label: 'Open Connections' }
  }
}

const KEYCHAIN_NAME: Readonly<Record<PermissionPlatform, string>> = {
  darwin: 'macOS Keychain',
  win32: 'Windows Credential Manager',
  linux: 'System keyring',
  other: 'System keychain'
}

function keychainPrompt(platform: PermissionPlatform): string | null {
  if (platform === 'darwin') {
    return 'macOS may ask: “CiteFox wants to use your confidential information stored in “CiteFox” in your keychain.” Type your Mac login password and choose Always Allow, so it does not ask again before each check. CiteFox is not yet signed by an identified developer, so macOS can ask once more after an update.'
  }
  if (platform === 'linux') {
    return 'Your keyring may ask you to unlock it. Unlock it so CiteFox can read your keys.'
  }
  return null
}

function keychainItem(input: PermissionInputs): PermissionItem {
  const { stored, checkedAt, failed } = input.keychain
  const base = {
    id: 'keychain' as const,
    title: KEYCHAIN_NAME[input.platform],
    purpose: 'Holds your API keys and email passwords. CiteFox never writes them to a file.',
    need: 'required' as const,
    checks: [],
    osPrompt: keychainPrompt(input.platform)
  }
  if (stored === 0) {
    return {
      ...base,
      state: 'ok',
      statusLabel: 'Ready · nothing saved yet',
      detail:
        input.platform === 'darwin' ? 'macOS may ask once when CiteFox first reads a key.' : null,
      action: null
    }
  }
  if (checkedAt !== null && failed > 0) {
    return {
      ...base,
      state: 'action',
      statusLabel: `Could not read ${count(failed, 'key')}`,
      detail:
        'Choose Always Allow when asked, or paste the key again in Connections if it was removed.',
      action: { kind: 'request', label: 'Check again' }
    }
  }
  if (checkedAt !== null) {
    return {
      ...base,
      state: 'ok',
      statusLabel: `Access allowed · ${count(stored, 'secret')}`,
      detail: null,
      action: { kind: 'request', label: 'Check again' }
    }
  }
  return {
    ...base,
    state: 'unchecked',
    statusLabel: `${count(stored, 'secret')} saved · access not checked`,
    detail: 'Check now, so any system prompt shows while you are here rather than mid-check.',
    action: { kind: 'request', label: 'Check access now' }
  }
}

function notificationsItem(input: PermissionInputs): PermissionItem {
  const { supported, asked, lastResult } = input.notifications
  const darwin = input.platform === 'darwin'
  const base = {
    id: 'notifications' as const,
    title: 'Notifications',
    purpose:
      'Tells you when a check finishes or needs a decision, even while the window is closed.',
    need: 'optional' as const,
    checks: [],
    osPrompt: darwin
      ? 'macOS will ask: “CiteFox would like to send you notifications.” Choose Allow. You can change it later in System Settings › Notifications.'
      : null
  }
  if (!supported) {
    return {
      ...base,
      state: 'not_needed',
      statusLabel: 'Not available on this computer',
      detail: null,
      osPrompt: null,
      action: null
    }
  }
  if (lastResult === 'failed') {
    return {
      ...base,
      state: 'action',
      statusLabel: 'Blocked by the system',
      detail: darwin
        ? 'Turn them on in System Settings › Notifications › CiteFox, then try again.'
        : 'Turn notifications on for CiteFox in your system settings, then try again.',
      action: { kind: 'request', label: 'Try again' }
    }
  }
  if (asked) {
    return {
      ...base,
      state: 'ok',
      statusLabel: 'On',
      detail: darwin ? 'Not seeing them? Check System Settings › Notifications › CiteFox.' : null,
      action: { kind: 'request', label: 'Send a test' }
    }
  }
  if (!darwin) {
    return {
      ...base,
      state: 'not_needed',
      statusLabel: 'On · no permission needed',
      detail: null,
      action: { kind: 'request', label: 'Send a test' }
    }
  }
  return {
    ...base,
    state: 'off',
    statusLabel: 'Not turned on',
    detail: 'CiteFox shows nothing on your desktop until you turn this on.',
    action: { kind: 'request', label: 'Turn on' }
  }
}

function backgroundPrompt(platform: PermissionPlatform): { detail: string; prompt: string | null } {
  if (platform === 'darwin') {
    return {
      detail: 'Adds a LaunchAgent (app.citefox.checkdue) that starts CiteFox hidden once an hour.',
      prompt:
        'macOS will show “Background Items Added” for CiteFox. Nothing to approve; you can turn it off in System Settings › General › Login Items.'
    }
  }
  if (platform === 'win32') {
    return {
      detail: 'Adds a Task Scheduler task, CiteFox\\CheckDue, that runs hourly.',
      prompt: null
    }
  }
  return { detail: 'Adds a systemd user timer (or a crontab line) that runs hourly.', prompt: null }
}

function backgroundItem(input: PermissionInputs): PermissionItem {
  const words = backgroundPrompt(input.platform)
  const base = {
    id: 'background' as const,
    title: 'Background checks',
    purpose: 'Runs due checks every hour while CiteFox is closed.',
    need: 'optional' as const,
    checks: [],
    osPrompt: words.prompt
  }
  if (input.testProfile === true || !input.background.supported) {
    return {
      ...base,
      state: 'not_needed',
      statusLabel:
        input.testProfile === true ? TEST_PROFILE_UNAVAILABLE : 'Not available on this computer',
      detail: null,
      osPrompt: null,
      action: null
    }
  }
  if (input.background.installed) {
    return { ...base, state: 'ok', statusLabel: 'On · hourly', detail: words.detail, action: null }
  }
  return {
    ...base,
    state: 'off',
    statusLabel: 'Off',
    detail: `${words.detail} Checks still run while CiteFox is open.`,
    action: { kind: 'request', label: 'Turn on' }
  }
}

function loginItem(input: PermissionInputs): PermissionItem {
  const darwin = input.platform === 'darwin'
  const base = {
    id: 'loginItem' as const,
    title: 'Open at login',
    purpose: 'Starts CiteFox in the menu bar when you log in, so scheduled checks run on time.',
    need: 'optional' as const,
    checks: [],
    osPrompt: darwin
      ? 'macOS will show “Login Item Added” for CiteFox. You can remove it in System Settings › General › Login Items.'
      : null
  }
  if (input.testProfile === true || !input.loginItem.supported) {
    return {
      ...base,
      state: 'not_needed',
      statusLabel:
        input.testProfile === true ? TEST_PROFILE_UNAVAILABLE : 'Only in the installed app',
      detail: null,
      osPrompt: null,
      action: null
    }
  }
  if (input.loginItem.enabled) {
    return { ...base, state: 'ok', statusLabel: 'On', detail: null, action: null }
  }
  return {
    ...base,
    state: 'off',
    statusLabel: 'Off',
    detail: 'CiteFox does not add itself until you turn this on.',
    action: { kind: 'request', label: 'Turn on' }
  }
}

function exportFolderItem(input: PermissionInputs): PermissionItem {
  const { enabled, unusable } = input.autoExport
  const base = {
    id: 'exportFolder' as const,
    title: 'Folder for automatic exports',
    purpose: 'Writes report files to a folder you pick, after scheduled checks.',
    need: 'if_used' as const,
    checks: [],
    osPrompt:
      input.platform === 'darwin'
        ? 'If the folder is in Desktop, Documents or Downloads, macOS asks once to let CiteFox use it. Choose Allow.'
        : null
  }
  if (enabled === 0) {
    return {
      ...base,
      state: 'not_needed',
      statusLabel: 'Not used',
      detail: 'Turn it on from Export a report.',
      action: null
    }
  }
  if (unusable > 0) {
    return {
      ...base,
      state: 'action',
      statusLabel: `${count(unusable, 'folder')} missing or not writable`,
      detail: 'Pick the folder again on Export a report.',
      action: { kind: 'setup', label: 'Open Export' }
    }
  }
  return {
    ...base,
    state: 'ok',
    statusLabel: `On · ${count(enabled, 'folder')}`,
    detail: null,
    action: null
  }
}

function emailItem(input: PermissionInputs): PermissionItem {
  const accounts = input.email.accounts
  const base = {
    id: 'email' as const,
    title: 'Email (SMTP)',
    purpose: 'Sends scheduled reports and alerts from your own mail account.',
    need: 'if_used' as const,
    checks: [],
    osPrompt: null
  }
  if (accounts === 0) {
    return {
      ...base,
      state: 'not_needed',
      statusLabel: 'Not set up',
      detail: 'The password is saved in your keychain when you add an account.',
      action: { kind: 'setup', label: 'Set up' }
    }
  }
  return {
    ...base,
    state: 'ok',
    statusLabel: count(accounts, 'account'),
    detail: null,
    action: null
  }
}
