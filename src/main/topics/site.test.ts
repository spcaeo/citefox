import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { EngineHost } from '../engine/host'
import type { SqliteDatabase } from '../storage/database'
import { closeProjectDatabase, createProjectDatabase } from '../storage/project-files'
import {
  isListingUrl,
  relevantExcerpt,
  scoreCandidates,
  type EvidenceCandidate
} from './evidence-pick'
import { cachedSiteReads, KEY_PAGE_PATHS, readSite, topicEvidence } from './site'

const NOW = new Date('2026-10-22T12:00:00.000Z')

const SITE: Record<string, { title: string; text: string }> = {
  'https://textbolt.com/': {
    title: 'TextBolt · Email to text',
    text: '# Email to text for business alerts\n\nTextBolt turns any email into a normal text message for staff who are away from a desk.'
  },
  'https://textbolt.com/pricing': {
    title: 'Pricing',
    text: '# Pricing\n\nPlans start at $29 a month for small teams that send alerts by email.'
  },
  'https://textbolt.com/faq': {
    title: 'FAQ',
    text: '# FAQ\n\n## What happens when a carrier gateway shuts down?\n\nAT&T shut down its email-to-text gateway in 2025.'
  },
  'https://textbolt.com/use-case/alarm-system-text-alerts/': {
    title: 'Alarm system text alerts',
    text: [
      '[Home](https://textbolt.com/) [Pricing](https://textbolt.com/pricing) [Login](https://textbolt.com/login)',
      '# Alarm system text alerts',
      'Most alarm panels and alarm monitoring software can send an email when a sensor trips. Point that email at TextBolt and every on-call phone gets a text within seconds.',
      '## Works with Honeywell and DSC panels',
      'Set the panel notification address once; no app for staff to install.'
    ].join('\n\n')
  },
  'https://textbolt.com/blog/alarm-facility-text-alerts/': {
    title: 'Alarm facility text alerts',
    text: '# Alarm facility text alerts\n\nFacilities teams send building alarm emails to phones as texts so nobody misses a freezer or flood alarm overnight.'
  }
}

const directories: string[] = []
const databases: SqliteDatabase[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeProjectDatabase(db)
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function setup(): { db: SqliteDatabase; host: EngineHost; reads: string[] } {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-topic-evidence-'))
  directories.push(directory)
  const db = createProjectDatabase(directory, 'textbolt')
  databases.push(db)
  const reads: string[] = []
  const host = {
    now: () => NOW,
    readWebsitePage: async (url: string) => {
      reads.push(url)
      return SITE[url] ?? null
    }
  } as unknown as EngineHost
  return { db, host, reads }
}

function candidate(url: string, title: string | null = null): EvidenceCandidate {
  return { url, title, outline: [], tracked: false }
}

const SITEMAP: EvidenceCandidate[] = [
  candidate('https://textbolt.com/use-case/alarm-system-text-alerts/'),
  candidate('https://textbolt.com/blog/alarm-facility-text-alerts/'),
  candidate('https://textbolt.com/use-case/weather-text-alerts/'),
  candidate('https://textbolt.com/use-case/server-monitoring-text-alerts/'),
  candidate('https://textbolt.com/use-case/emergency-text-alerts/'),
  candidate('https://textbolt.com/blog/send-sms-from-outlook/'),
  candidate('https://textbolt.com/integration/outlook-email-to-text/'),
  candidate('https://textbolt.com/use-case/dispatch-text-notifications/'),
  candidate('https://textbolt.com/tag/alarm/'),
  candidate('https://textbolt.com/blog/')
]

describe('scoreCandidates (which pages are about the topic)', () => {
  test('rare words pick the pages; words every page has never pick one alone', () => {
    // "email" is rare in these URLs, but the homepage says the business is email to text.
    const generic = ['TextBolt · Email to text']
    const ranked = scoreCandidates(SITEMAP, {
      seed: 'email to text for alarm systems',
      terms: [],
      generic
    })
    expect(ranked.map((item) => item.candidate.url)).toEqual([
      'https://textbolt.com/use-case/alarm-system-text-alerts/',
      'https://textbolt.com/blog/alarm-facility-text-alerts/'
    ])
    expect(ranked[0]?.matched).toContain('alarm')
  })

  test('another topic picks its own pages', () => {
    const ranked = scoreCandidates(SITEMAP, { seed: 'send text alerts from Outlook', terms: [] })
    expect(
      ranked
        .map((item) => item.candidate.url)
        .slice(0, 2)
        .sort()
    ).toEqual([
      'https://textbolt.com/blog/send-sms-from-outlook/',
      'https://textbolt.com/integration/outlook-email-to-text/'
    ])
  })

  test('listing pages and the homepage are never evidence on their own', () => {
    expect(isListingUrl('https://textbolt.com/')).toBe(true)
    expect(isListingUrl('https://textbolt.com/blog/')).toBe(true)
    expect(isListingUrl('https://textbolt.com/tag/alarm/')).toBe(true)
    expect(isListingUrl('https://textbolt.com/blog/page/2/')).toBe(true)
    expect(isListingUrl('https://textbolt.com/use-case/alarm-system-text-alerts/')).toBe(false)
  })
})

describe('relevantExcerpt', () => {
  test('drops menus and keeps the paragraphs about the topic, links as text', () => {
    const page = SITE['https://textbolt.com/use-case/alarm-system-text-alerts/']?.text ?? ''
    const excerpt = relevantExcerpt(page, { seed: 'alarm systems', terms: [] }, 400)
    expect(excerpt).not.toContain('Login')
    expect(excerpt).toContain('Most alarm panels')
    expect(excerpt.length).toBeLessThanOrEqual(400)
  })
})

describe('topicEvidence (Docs/PROMPT-AUDIT.md, P3 item 0)', () => {
  test('the topic’s own pages first, then the homepage and key pages, read once', async () => {
    const { db, host, reads } = setup()
    const draft = {
      seed: 'email to text for alarm systems',
      website: 'textbolt.com',
      keywordTerms: []
    }
    const evidence = await topicEvidence(host, db, 'proj-1', draft, SITEMAP, 'textbolt.com')
    expect(evidence.fallback).toBe(false)
    expect(evidence.topicPaths).toEqual([
      '/use-case/alarm-system-text-alerts/',
      '/blog/alarm-facility-text-alerts/'
    ])
    expect(evidence.pages.map((page) => page.path)).toEqual([
      '/use-case/alarm-system-text-alerts/',
      '/blog/alarm-facility-text-alerts/',
      '/',
      '/pricing',
      '/faq'
    ])
    expect(evidence.block.startsWith('<evidence>\n[/use-case/alarm-system-text-alerts/]')).toBe(
      true
    )
    expect(evidence.block).not.toContain('Login')
    // The topic pages are cached like the key pages; the next call reads nothing.
    const count = reads.length
    await topicEvidence(host, db, 'proj-1', draft, SITEMAP, 'textbolt.com')
    expect(reads.length).toBe(count)
    // Other steps' site text keeps to the key pages.
    expect(cachedSiteReads(db).map((read) => read.url)).not.toContain(
      'https://textbolt.com/use-case/alarm-system-text-alerts/'
    )
  })

  test('falls back to the fixed key pages when no page matches', async () => {
    const { db, host } = setup()
    const draft = { seed: 'zebra grooming schedules', website: 'textbolt.com', keywordTerms: [] }
    const evidence = await topicEvidence(host, db, 'proj-1', draft, SITEMAP, 'textbolt.com')
    expect(evidence.fallback).toBe(true)
    expect(evidence.topicPaths).toEqual([])
    expect(evidence.pages.map((page) => page.path)).toEqual(['/', '/pricing', '/faq'])
  })
})

describe('readSite', () => {
  test('reads the key pages two at a time on the site and returns them in page order', async () => {
    const { db } = setup()
    let inFlight = 0
    let most = 0
    const waiting: Array<() => void> = []
    const host = {
      now: () => NOW,
      readWebsitePage: async (url: string) => {
        inFlight += 1
        most = Math.max(most, inFlight)
        await new Promise<void>((resolve) => waiting.push(resolve))
        inFlight -= 1
        return SITE[url] ?? null
      }
    } as unknown as EngineHost
    const progress: string[] = []
    const reading = readSite(host, db, 'textbolt.com', {
      onProgress: (step) => progress.push(`${step.done}/${step.total} ${step.url}`)
    })
    const turns = async (): Promise<void> => {
      for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve))
    }
    await turns()
    expect(waiting).toHaveLength(2)
    // Let the newest go first: the reads still come back in page order.
    while (waiting.length > 0) {
      waiting.pop()?.()
      await turns()
    }
    const reads = await reading
    expect(most).toBe(2)
    expect(reads.map((read) => read.url)).toEqual([
      'https://textbolt.com/',
      ...KEY_PAGE_PATHS.map((page) => `https://textbolt.com${page.path}`)
    ])
    expect(reads.map((read) => read.ok)).toEqual([true, true, false, true, false, false])
    expect(progress[0]).toBe('0/6 https://textbolt.com/')
    expect(progress.at(-1)).toBe('6/6 https://textbolt.com')
    expect(progress).toHaveLength(7)
  })
})
