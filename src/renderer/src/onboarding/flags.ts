/**
 * How the renderer picks its data clients.
 *
 * The real preload API is the default everywhere, dev included. The in-memory
 * mock runs only when `localStorage['citefox.client']` is `mock` and mocks are
 * allowed: a Vite dev build, or a build made with `VITE_CITEFOX_E2E_MOCKS=1`
 * for the e2e suite. A release build ignores the flag.
 *
 * The scenario and pace keys are read by the mock only. They are not secrets.
 */
export const CLIENT_MODE_STORAGE_KEY = 'citefox.client'
export const MOCK_SCENARIO_STORAGE_KEY = 'citefox.mock.scenario'
export const MOCK_PACE_STORAGE_KEY = 'citefox.mock.pace'
/** The mock's onboarding draft, so a mock run survives a relaunch like the real one. */
export const MOCK_DRAFT_STORAGE_KEY = 'citefox.mock.onboardingDraft'
/** `textbolt` loads the sample catalog. Anything else, including unset, stays empty. */
export const MOCK_CATALOG_STORAGE_KEY = 'citefox.mock.catalog'
/**
 * `1` starts the mock as if onboarding was finished a moment ago: the TextBolt project with
 * no pages yet, a working SerpApi key and a passed Claude checkup. E2E specs about other
 * screens use it to skip the setup wizard (tests/e2e/onboarded.ts).
 */
export const MOCK_ONBOARDED_STORAGE_KEY = 'citefox.mock.onboarded'

export type ClientMode = 'ipc' | 'mock'

/**
 * True in a Vite dev build and in the e2e build. False in a release build.
 *
 * A guard around `import()` must repeat this expression inline. Vite replaces
 * the `import.meta.env` values before the bundler scans for chunks, so only
 * the inline form keeps a mock chunk out of the release build. A call to this
 * function still emits the chunk.
 */
export function mocksAllowed(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_CITEFOX_E2E_MOCKS === '1'
}

export function resolveClientMode(input: {
  mocksAllowed: boolean
  stored: string | null
}): ClientMode {
  return input.mocksAllowed && input.stored === 'mock' ? 'mock' : 'ipc'
}

/** The mode for this window, from the build and the stored flag. */
export function currentClientMode(): ClientMode {
  return resolveClientMode({ mocksAllowed: mocksAllowed(), stored: readStoredClientMode() })
}

export function readStoredClientMode(): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(CLIENT_MODE_STORAGE_KEY)
}
