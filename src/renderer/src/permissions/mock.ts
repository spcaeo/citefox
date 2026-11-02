import type { PermissionId, PermissionRequestResult, PermissionsSnapshot } from '@shared/ipc'
import { isRequestablePermission } from '@shared/ipc'
import { buildPermissionsSnapshot, type PermissionInputs } from '@shared/permissions'
import type { OnboardingClient } from '../onboarding/client'
import type { PermissionsClient } from './client'

/**
 * Dev and e2e stand-in for `permissions:*`, built on the window's onboarding
 * mock (keys, settings, checkup) so both show the same state. It pretends to be
 * a Mac, so the system-prompt explanations show. Nothing touches the OS.
 */
export function createMockPermissionsClient(
  onboarding: OnboardingClient,
  options: { now?: () => Date; platform?: PermissionInputs['platform'] } = {}
): PermissionsClient {
  const now = options.now ?? ((): Date => new Date())
  const state = {
    checkupAt: null as string | null,
    seenCheckup: false,
    notifications: false,
    background: false,
    loginItem: false,
    keychainCheckedAt: null as string | null,
    keychainFailed: 0
  }

  async function snapshot(): Promise<PermissionsSnapshot> {
    const [overview, settings] = await Promise.all([
      onboarding.getOverview(),
      onboarding.getSettings()
    ])
    if (overview.claudeCheckup !== null && !state.seenCheckup) {
      state.seenCheckup = true
      state.checkupAt = now().toISOString()
    }
    return buildPermissionsSnapshot({
      platform: options.platform ?? 'darwin',
      now: now().toISOString(),
      claudeProvider: settings.settings.claudeProvider,
      claudeModel: settings.settings.claudeModel,
      checkup: overview.claudeCheckup,
      checkupAt: overview.claudeCheckup ? state.checkupAt : null,
      keys: overview.keys,
      jinaMode: settings.settings.jinaMode,
      keychain: {
        stored: overview.keys.length,
        checkedAt: state.keychainCheckedAt,
        failed: state.keychainFailed
      },
      notifications: {
        supported: true,
        asked: state.notifications,
        lastResult: state.notifications ? 'shown' : null
      },
      background: { supported: true, installed: state.background },
      loginItem: { supported: true, enabled: state.loginItem },
      autoExport: { enabled: 0, unusable: 0 },
      email: { accounts: 0 }
    })
  }

  async function run(id: PermissionId): Promise<{ ok: boolean; message: string }> {
    if (id === 'claude') {
      const result = await onboarding.runCheckup({ binaryPath: null })
      state.seenCheckup = true
      state.checkupAt = now().toISOString()
      return {
        ok: result.ready,
        message: [result.message, result.ready ? null : result.nextStep].filter(Boolean).join(' ')
      }
    }
    if (id === 'keychain') {
      const overview = await onboarding.getOverview()
      state.keychainCheckedAt = now().toISOString()
      state.keychainFailed = 0
      const count = overview.keys.length
      return {
        ok: true,
        message:
          count === 1
            ? 'CiteFox can read the saved secret.'
            : `CiteFox can read all ${count} saved secrets.`
      }
    }
    if (id === 'notifications') {
      state.notifications = true
      return { ok: true, message: 'Notifications are on. A test note was sent.' }
    }
    if (id === 'background') {
      state.background = true
      return { ok: true, message: 'Background checks are on. CiteFox checks due pages hourly.' }
    }
    state.loginItem = true
    return { ok: true, message: 'CiteFox now opens at login.' }
  }

  return {
    list: snapshot,
    async request(request): Promise<PermissionRequestResult> {
      if (!isRequestablePermission(request.id)) {
        throw new Error(
          "Error invoking remote method 'permissions:request': IpcRequestError: permissions:request: Set this up on its own screen."
        )
      }
      const outcome = await run(request.id)
      return { snapshot: await snapshot(), ...outcome }
    },
    onCheckupProgress: (listener) => onboarding.onCheckupProgress(listener)
  }
}
