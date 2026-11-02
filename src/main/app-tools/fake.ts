import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type { OpenTestProfileRequest } from '@shared/ipc'
import { CLOSE_TEST_WINDOW_FIRST } from '../test-profile/open'
import type { AppTools } from './types'

/** One JSON line per call, in the run's data folder, for e2e to read. */
export const E2E_APP_TOOLS_FILE = 'e2e-app-tools.jsonl'

/**
 * Stand-in for test runs (see `index.ts`). It keeps the real answers' rules:
 * the first open reports a new window, later ones `alreadyOpen`, and a fresh
 * start while that pretend window is open is refused.
 */
export function createFakeAppTools(input: {
  userData: string
  fail: boolean
  now?: () => Date
}): AppTools {
  const now = input.now ?? ((): Date => new Date())
  let testWindowOpen = false
  const record = (channel: string, request: OpenTestProfileRequest | null): void => {
    try {
      appendFileSync(
        join(input.userData, E2E_APP_TOOLS_FILE),
        `${JSON.stringify({ channel, request, at: now().toISOString() })}\n`,
        { mode: 0o600 }
      )
    } catch {
      // A test that does not read the file does not care.
    }
  }
  return {
    resetKeepKeys() {
      record('app:resetKeepKeys', null)
      if (input.fail) return { ok: false, message: 'CiteFox could not reset (test run).' }
      return { ok: true }
    },
    openTestProfile(request) {
      record('app:openTestProfile', { fresh: request.fresh })
      if (input.fail) {
        return { ok: false, message: 'CiteFox could not open the test window (test run).' }
      }
      if (request.fresh && testWindowOpen) return { ok: false, message: CLOSE_TEST_WINDOW_FIRST }
      const alreadyOpen = testWindowOpen
      testWindowOpen = true
      return { ok: true, alreadyOpen }
    }
  }
}
