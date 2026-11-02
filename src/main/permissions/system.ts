/**
 * The OS pieces "What CiteFox needs" reads and asks for. `electron-system.ts`
 * is the only implementation that touches Electron or the OS; tests pass
 * {@link memoryPermissionSystem}, which never shows a prompt or writes a file.
 */
export interface PermissionSystem {
  /** `process.platform`, or the platform a test pretends to be. */
  platform: string
  /**
   * The "Test as a new user" profile: background checks and the login item are
   * not available, because both are shared by name with the real install.
   */
  testProfile?: boolean
  notifications: {
    supported(): boolean
    /** Shows one test notification. `failed` when the system refused it. */
    test(): Promise<'shown' | 'failed'>
  }
  loginItem: {
    /** False in a development or e2e build, which must never add itself. */
    supported: boolean
    enabled(): boolean
    set(openAtLogin: boolean): void
  }
}

export function memoryPermissionSystem(
  input: {
    platform?: string
    notificationsSupported?: boolean
    notificationResult?: 'shown' | 'failed'
    loginItemSupported?: boolean
    loginItemEnabled?: boolean
  } = {}
): PermissionSystem & { notificationsShown: number } {
  let enabled = input.loginItemEnabled ?? false
  const system = {
    platform: input.platform ?? 'linux',
    notificationsShown: 0,
    notifications: {
      supported: () => input.notificationsSupported ?? true,
      test: (): Promise<'shown' | 'failed'> => {
        const result = input.notificationResult ?? 'shown'
        if (result === 'shown') system.notificationsShown += 1
        return Promise.resolve(result)
      }
    },
    loginItem: {
      supported: input.loginItemSupported ?? false,
      enabled: () => enabled,
      set(openAtLogin: boolean): void {
        enabled = openAtLogin
      }
    }
  }
  return system
}
