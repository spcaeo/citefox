/** Background page setup timings (FR-20.6, SCH-12, LLM-10). */

/** The runner looks for work this often while the app runs (wall clock, like the tray). */
export const SETUP_TICK_MS = 60_000

/** First look after the app starts, so start-up work and the first window go first. */
export const SETUP_FIRST_TICK_MS = 2 * 60_000

/**
 * A page whose first check is held for stagger (SCH-12) is set up from this long
 * before its date, so Claude work is spread over the same days as the checks.
 */
export const STAGGER_LEAD_MS = 24 * 60 * 60_000

/** Tries per page before it fails for good (Retry starts it over). */
export const MAX_SETUP_ATTEMPTS = 4

/** Wait before the next try after attempt 1, 2, 3. */
export const SETUP_BACKOFF_MS: readonly number[] = [15 * 60_000, 60 * 60_000, 4 * 60 * 60_000]

/** "Ask me" holds the project; after a restart its pages try again after this long. */
export const ASK_RETRY_MS = 24 * 60 * 60_000

/** No Claude connection (no key, or a removed key): look again after this long. */
export const MISSING_CONNECTION_RETRY_MS = 60 * 60_000

/** The throttle window for pages per hour. */
export const THROTTLE_WINDOW_MS = 60 * 60_000

/** Most failures `setup:status` lists. */
export const MAX_LISTED_FAILURES = 50
