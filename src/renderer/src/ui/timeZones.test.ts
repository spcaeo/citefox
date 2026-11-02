import { describe, expect, it } from 'vitest'
import {
  isTimeZone,
  listTimeZones,
  offsetLabel,
  searchZones,
  zoneLabel,
  zoneOffsetMinutes,
  zoneOptions
} from './timeZones'

/** A summer instant (London on BST, Kolkata never changes). */
const JULY = new Date('2026-07-01T12:00:00Z')
const JANUARY = new Date('2026-01-15T12:00:00Z')

describe('time zones', () => {
  it('lists UTC first and only real zones', () => {
    const zones = listTimeZones()
    expect(zones[0]).toBe('UTC')
    expect(zones).toContain('Europe/London')
    expect(new Set(zones).size).toBe(zones.length)
    expect(isTimeZone('Europe/London')).toBe(true)
    expect(isTimeZone('Mars/Olympus')).toBe(false)
  })

  it('reads the offset at a given instant, daylight saving included', () => {
    expect(zoneOffsetMinutes('Europe/London', JULY)).toBe(60)
    expect(zoneOffsetMinutes('Europe/London', JANUARY)).toBe(0)
    expect(zoneOffsetMinutes('Asia/Kolkata', JULY)).toBe(330)
    expect(zoneOffsetMinutes('America/New_York', JANUARY)).toBe(-300)
  })

  it('labels a zone with its current offset', () => {
    expect(offsetLabel(0)).toBe('UTC')
    expect(offsetLabel(60)).toBe('UTC+1')
    expect(offsetLabel(330)).toBe('UTC+5:30')
    expect(offsetLabel(-300)).toBe('UTC−5')
    expect(zoneLabel('Europe/London', JULY)).toBe('Europe/London · UTC+1')
  })

  it('searches by city, region and offset', () => {
    const options = zoneOptions(['UTC', 'Europe/London', 'Asia/Kolkata', 'America/New_York'], JULY)
    expect(searchZones(options, 'london').map((zone) => zone.zone)).toEqual(['Europe/London'])
    expect(searchZones(options, 'new york').map((zone) => zone.zone)).toEqual(['America/New_York'])
    expect(searchZones(options, '+5:30').map((zone) => zone.zone)).toEqual(['Asia/Kolkata'])
    expect(searchZones(options, '')).toHaveLength(4)
  })
})
