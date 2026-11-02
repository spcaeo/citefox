/**
 * The release line every CiteFox window shows in its footer (owner rule,
 * 2026-11-02): `v0.12.0 · build 1424 · Nov 2, 2026 8:49 AM EST`.
 *
 * - the version is package.json's, bumped on purpose;
 * - the build number only goes up (the git commit count, stamped by
 *   electron.vite.config.ts through scripts/build-number.ts);
 * - the build time is always in the owner's zone, America/Toronto (EST/EDT),
 *   whatever zone the computer is in.
 */

export const RELEASE_TIME_ZONE = 'America/Toronto'

export interface ReleaseFacts {
  version: string
  /** The stamped build number, or null when the run was not bundled. */
  number?: number | null
  /** ISO 8601 build time, or null/absent when unknown. */
  builtAt?: string | null
}

const FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: RELEASE_TIME_ZONE,
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZoneName: 'short'
})

/** "Nov 2, 2026 8:49 AM EST" in Toronto time; null for a missing or broken time. */
export function releaseTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const parts = FORMAT.formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? ''
  return `${part('month')} ${part('day')}, ${part('year')} ${part('hour')}:${part('minute')} ${part('dayPeriod')} ${part('timeZoneName')}`
}

/** A real build number (a positive whole number), else null. */
export function validBuildNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

/** `v0.12.0 · build 1424 · Nov 2, 2026 8:49 AM EST`; parts the build does not know are left out. */
export function releaseLine(facts: ReleaseFacts): string {
  const number = validBuildNumber(facts.number)
  return [`v${facts.version}`, number ? `build ${number}` : null, releaseTime(facts.builtAt)]
    .filter(Boolean)
    .join(' · ')
}
