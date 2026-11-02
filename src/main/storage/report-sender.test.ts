import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { NO_SENDER } from '@shared/report/review/sender'
import { openFaviconCache } from '../favicons/cache'
import {
  cachedSiteIcon,
  readReportSender,
  reportSenderPath,
  writeReportSender
} from './report-sender'

const dirs: string[] = []
function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'citefox-sender-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('report sender storage (app-wide, beside settings.json)', () => {
  test('no file reads as no branding; a save reads back for every project', () => {
    const dir = root()
    expect(readReportSender(dir)).toEqual(NO_SENDER)
    const saved = writeReportSender(dir, {
      mode: 'agency',
      name: ' Northwind SEO ',
      logo: null,
      website: 'northwindseo.com',
      email: 'hello@northwindseo.com',
      preparedBy: ''
    })
    expect(saved.name).toBe('Northwind SEO')
    expect(readReportSender(dir)).toEqual(saved)
  })

  test('a broken file reads as no branding; back to Just me with nothing typed removes it', () => {
    const dir = root()
    writeFileSync(reportSenderPath(dir), '{not json')
    expect(readReportSender(dir)).toEqual(NO_SENDER)
    writeReportSender(dir, { mode: 'company', name: 'TextBolt' })
    expect(existsSync(reportSenderPath(dir))).toBe(true)
    writeReportSender(dir, { mode: 'none' })
    expect(existsSync(reportSenderPath(dir))).toBe(false)
    expect(readReportSender(dir)).toEqual(NO_SENDER)
  })

  test('the stored site icon, or null', () => {
    const dir = root()
    expect(cachedSiteIcon(dir, 'textbolt.com')).toBeNull()
    const cache = openFaviconCache(join(dir, 'favicons.sqlite'))
    cache.put('textbolt.com', 'data:image/png;base64,AAAA', Date.now())
    cache.close()
    expect(cachedSiteIcon(dir, 'TextBolt.com')).toBe('data:image/png;base64,AAAA')
    expect(cachedSiteIcon(dir, 'other.com')).toBeNull()
  })
})
