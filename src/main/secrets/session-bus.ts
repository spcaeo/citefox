import { statSync } from 'node:fs'

/**
 * Linux: @napi-rs/keyring reaches the Secret Service over the user's D-Bus
 * session bus, which it finds through DBUS_SESSION_BUS_ADDRESS or
 * XDG_RUNTIME_DIR. cron starts `CiteFox --check-due` with neither, and the
 * keyring then reads every saved key as missing. When both are unset and the
 * logind session bus `/run/user/<uid>/bus` exists, point the process at it.
 * Returns the variables to set; empty when nothing needs to change.
 */
export function sessionBusEnvPatch(input: {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  uid: number | null
  isSocket: (path: string) => boolean
}): Record<string, string> {
  const { platform, env, uid } = input
  if (platform !== 'linux' || uid === null || !Number.isInteger(uid) || uid < 0) return {}
  if (nonEmpty(env.DBUS_SESSION_BUS_ADDRESS) || nonEmpty(env.XDG_RUNTIME_DIR)) return {}
  const runtimeDir = `/run/user/${uid}`
  const bus = `${runtimeDir}/bus`
  if (!input.isSocket(bus)) return {}
  return { XDG_RUNTIME_DIR: runtimeDir, DBUS_SESSION_BUS_ADDRESS: `unix:path=${bus}` }
}

/** Applies {@link sessionBusEnvPatch} to this process. Call before the first keychain access. */
export function applySessionBusEnv(): void {
  Object.assign(
    process.env,
    sessionBusEnvPatch({
      platform: process.platform,
      env: process.env,
      uid: typeof process.getuid === 'function' ? process.getuid() : null,
      isSocket
    })
  )
}

function nonEmpty(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== ''
}

function isSocket(path: string): boolean {
  try {
    return statSync(path).isSocket()
  } catch {
    return false
  }
}
