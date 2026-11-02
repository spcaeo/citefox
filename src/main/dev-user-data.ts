import path from 'node:path'

/**
 * Development only. Points the app's data folder (`userData`) somewhere else, so a
 * second copy run from source does not share the "CiteFox Dev" data, its
 * single-instance lock, or its window state. A packaged app ignores it.
 */
export const USER_DATA_ENV = 'CITEFOX_USER_DATA'

/** The folder to use as `userData`, or null to keep the default. Always absolute. */
export function devUserDataDir(
  isPackaged: boolean,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  if (isPackaged) return null
  const dir = env[USER_DATA_ENV]?.trim()
  return dir ? path.resolve(dir) : null
}
