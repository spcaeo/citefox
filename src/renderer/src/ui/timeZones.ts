/**
 * IANA time zones for a picker: the runtime's own list
 * (`Intl.supportedValuesOf('timeZone')`), each with its offset right now, such
 * as "Europe/London · UTC+1". Pure, so the offsets are testable with a fixed date.
 */

/** Used when the runtime cannot list its zones (an old engine, no ICU data). */
const FALLBACK_ZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Toronto',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Amsterdam',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland'
] as const

/** Every zone this computer knows, `UTC` first. */
export function listTimeZones(): string[] {
  let zones: string[]
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    zones = intl.supportedValuesOf?.('timeZone') ?? []
  } catch {
    zones = []
  }
  if (zones.length === 0) zones = [...FALLBACK_ZONES]
  return ['UTC', ...zones.filter((zone) => zone !== 'UTC')]
}

/** True when the runtime can format dates in `zone`. */
export function isTimeZone(zone: string): boolean {
  if (zone.trim() === '') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/** This computer's zone, else `UTC`. */
export function systemTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (zone) return zone
  } catch {
    // Intl throws when the runtime has no locale data.
  }
  return 'UTC'
}

/** Minutes ahead of UTC in `zone` at `at` (negative west of Greenwich). */
export function zoneOffsetMinutes(zone: string, at: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric'
    }).formatToParts(at)
    const pick = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((part) => part.type === type)?.value ?? '0')
    const asUtc = Date.UTC(
      pick('year'),
      pick('month') - 1,
      pick('day'),
      pick('hour') % 24,
      pick('minute'),
      pick('second')
    )
    const whole = Math.floor(at.getTime() / 1000) * 1000
    return Math.round((asUtc - whole) / 60000)
  } catch {
    return 0
  }
}

/** "UTC", "UTC+1", "UTC−3:30" (a real minus sign). */
export function offsetLabel(minutes: number): string {
  if (minutes === 0) return 'UTC'
  const sign = minutes > 0 ? '+' : '−'
  const abs = Math.abs(minutes)
  const hours = Math.floor(abs / 60)
  const rest = abs % 60
  return `UTC${sign}${hours}${rest === 0 ? '' : `:${String(rest).padStart(2, '0')}`}`
}

/** "Europe/London · UTC+1". */
export function zoneLabel(zone: string, at: Date = new Date()): string {
  if (zone === 'UTC') return 'UTC'
  return `${zone} · ${offsetLabel(zoneOffsetMinutes(zone, at))}`
}

export interface ZoneOption {
  zone: string
  label: string
  /** Lowercase words a search matches: the zone with spaces for `_` and `/`, and the offset. */
  hay: string
  offset: number
}

/** Each zone with its label and search text, at one instant. */
export function zoneOptions(zones: readonly string[], at: Date = new Date()): ZoneOption[] {
  return zones.map((zone) => {
    const offset = zoneOffsetMinutes(zone, at)
    const label = zone === 'UTC' ? 'UTC · UTC+0' : `${zone} · ${offsetLabel(offset)}`
    const hay = `${zone.replace(/[/_]/g, ' ')} ${offsetLabel(offset).replace('−', '-')} ${zone}`
    return { zone, label, hay: hay.toLowerCase(), offset }
  })
}

/** Options whose zone or offset has every word of `query` ("london", "utc+1", "new york"). */
export function searchZones(options: readonly ZoneOption[], query: string): ZoneOption[] {
  const words = query.toLowerCase().replace('−', '-').split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...options]
  return options.filter((option) => words.every((word) => option.hay.includes(word)))
}
