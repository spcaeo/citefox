/**
 * The build menu's testing tools: "Reset CiteFox, keep my keys" and "Test as a
 * new user". `electron.ts` does the real thing; `fake.ts` stands in for test runs.
 *
 * CITEFOX_E2E_APP_TOOLS (read only by an unpackaged build; a packaged app ignores it):
 * - unset or `record`: the recorded fake. It never relaunches, moves data, spawns a
 *   window or touches the keychain, and appends each call to
 *   `<userData>/e2e-app-tools.jsonl`. This is the default for every unpackaged run,
 *   so e2e and `npm run dev` can click the menu items safely.
 * - `fail`: the fake answers `ok: false` with a fixed message.
 * - `real`: an unpackaged build does the real reset and opens the real test profile.
 */

export type { AppTools } from './types'

export type AppToolsMode = 'real' | 'record' | 'fail'

export function appToolsMode(
  isPackaged: boolean,
  env: NodeJS.ProcessEnv = process.env
): AppToolsMode {
  if (isPackaged) return 'real'
  const value = env.CITEFOX_E2E_APP_TOOLS
  if (value === 'real') return 'real'
  if (value === 'fail') return 'fail'
  return 'record'
}

/** CITEFOX_DEV_RESTART_EXIT_CODE (unpackaged only): exit with it instead of relaunching. */
export function devRestartExitCode(isPackaged: boolean, env: NodeJS.ProcessEnv): number | null {
  if (isPackaged) return null
  const code = Number(env.CITEFOX_DEV_RESTART_EXIT_CODE)
  return Number.isInteger(code) && code > 0 && code < 256 ? code : null
}

export { createFakeAppTools, E2E_APP_TOOLS_FILE } from './fake'
