/**
 * Google's confirmed ranking updates, shipped with the app (no network call at
 * runtime). Charts draw each one as a "G" marker so a move on the line can be read
 * against what Google changed. Taken from the Ranking history of Google's Search
 * Status Dashboard and checked against Search Central coverage on 2026-10-30.
 * Only updates whose name and dates could be checked are listed; refresh the list
 * with each app release.
 *
 * Left out on purpose: the February 2026 Discover update (Discover, not Search,
 * so it does not move AI Overviews).
 */

export type GoogleUpdateKind = 'core' | 'spam' | 'helpful' | 'reviews' | 'other'

export interface GoogleUpdate {
  id: string
  name: string
  kind: GoogleUpdateKind
  /** `yyyy-mm-dd`, the day Google said the rollout started (US Pacific). */
  startedOn: string
  /** `yyyy-mm-dd`, the day Google marked it complete. Null while it is rolling out. */
  finishedOn: string | null
  /** One plain line on what it does. */
  description: string
  /** Google's own page for it. */
  url: string
}

/** The Ranking page of Google's Search Status Dashboard. */
export const GOOGLE_STATUS_URL =
  'https://status.search.google.com/products/rGHU1u87FJnkP6W2GwMi/history'

const CORE = 'A broad change to how Google ranks results across all sites.'
const SPAM = 'Targets pages that break Google’s spam policies.'

/** Oldest first. */
export const GOOGLE_UPDATES: readonly GoogleUpdate[] = [
  {
    id: '2024-03-core',
    name: 'March 2024 core update',
    kind: 'core',
    startedOn: '2024-03-05',
    finishedOn: '2024-04-19',
    description: `${CORE} It folded the helpful content system into core ranking.`,
    url: GOOGLE_STATUS_URL
  },
  {
    id: '2024-03-spam',
    name: 'March 2024 spam update',
    kind: 'spam',
    startedOn: '2024-03-05',
    finishedOn: '2024-03-20',
    description: SPAM,
    url: GOOGLE_STATUS_URL
  },
  {
    id: '2024-06-spam',
    name: 'June 2024 spam update',
    kind: 'spam',
    startedOn: '2024-06-20',
    finishedOn: '2024-06-27',
    description: SPAM,
    url: GOOGLE_STATUS_URL
  },
  {
    id: '2024-08-core',
    name: 'August 2024 core update',
    kind: 'core',
    startedOn: '2024-08-15',
    finishedOn: '2024-09-03',
    description: CORE,
    url: GOOGLE_STATUS_URL
  },
  {
    id: '2024-11-core',
    name: 'November 2024 core update',
    kind: 'core',
    startedOn: '2024-11-11',
    finishedOn: '2024-12-05',
    description: CORE,
    url: GOOGLE_STATUS_URL
  },
  {
    id: '2024-12-core',
    name: 'December 2024 core update',
    kind: 'core',
    startedOn: '2024-12-12',
    finishedOn: '2024-12-18',
    description: CORE,
    url: GOOGLE_STATUS_URL
  },
  {
    id: '2024-12-spam',
    name: 'December 2024 spam update',
    kind: 'spam',
    startedOn: '2024-12-19',
    finishedOn: '2024-12-26',
    description: SPAM,
    url: GOOGLE_STATUS_URL
  },
  {
    id: '2025-03-core',
    name: 'March 2025 core update',
    kind: 'core',
    startedOn: '2025-03-13',
    finishedOn: '2025-03-27',
    description: CORE,
    url: GOOGLE_STATUS_URL
  },
  {
    id: '2025-06-core',
    name: 'June 2025 core update',
    kind: 'core',
    startedOn: '2025-06-30',
    finishedOn: '2025-07-17',
    description: CORE,
    url: GOOGLE_STATUS_URL
  },
  {
    id: '2025-08-spam',
    name: 'August 2025 spam update',
    kind: 'spam',
    startedOn: '2025-08-26',
    finishedOn: '2025-09-22',
    description: SPAM,
    url: GOOGLE_STATUS_URL
  },
  {
    id: '2025-12-core',
    name: 'December 2025 core update',
    kind: 'core',
    startedOn: '2025-12-11',
    finishedOn: '2025-12-29',
    description: CORE,
    url: GOOGLE_STATUS_URL
  },
  {
    id: '2026-03-spam',
    name: 'March 2026 spam update',
    kind: 'spam',
    startedOn: '2026-03-24',
    finishedOn: '2026-03-25',
    description: SPAM,
    url: GOOGLE_STATUS_URL
  },
  {
    id: '2026-03-core',
    name: 'March 2026 core update',
    kind: 'core',
    startedOn: '2026-03-27',
    finishedOn: '2026-04-08',
    description: CORE,
    url: GOOGLE_STATUS_URL
  },
  {
    id: '2026-05-core',
    name: 'May 2026 core update',
    kind: 'core',
    startedOn: '2026-05-21',
    finishedOn: '2026-06-02',
    description: CORE,
    url: GOOGLE_STATUS_URL
  },
  {
    id: '2026-06-spam',
    name: 'June 2026 spam update',
    kind: 'spam',
    startedOn: '2026-06-24',
    finishedOn: '2026-06-26',
    description: SPAM,
    url: GOOGLE_STATUS_URL
  },
  {
    id: '2026-08-spam',
    name: 'August 2026 spam update',
    kind: 'spam',
    startedOn: '2026-08-18',
    finishedOn: '2026-08-21',
    description: SPAM,
    url: GOOGLE_STATUS_URL
  },
  {
    id: '2026-09-spam',
    name: 'September 2026 spam update',
    kind: 'spam',
    startedOn: '2026-09-24',
    finishedOn: '2026-10-08',
    description: SPAM,
    url: GOOGLE_STATUS_URL
  }
]
