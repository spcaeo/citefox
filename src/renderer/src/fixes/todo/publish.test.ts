import { describe, expect, it } from 'vitest'
import { rollupPageFixes, type PageFix } from '@shared/page-fixes'
import { createdFix } from '../fixtures'
import { NAGIOS_OTHER, NAGIOS_TARGET, projectSearches, questionTargets } from '../searchFixtures'
import {
  editsText,
  liveLine,
  publishedFixOf,
  publishedPageUrl,
  publishMarkets,
  publishPrefill,
  publishRequest,
  publishSubject,
  publishText
} from './publish'

const FIXES = rollupPageFixes(projectSearches().searches).fixes
function fixOf(kind: PageFix['kind']): PageFix {
  const fix = FIXES.find((item) => item.kind === kind)
  if (!fix) throw new Error(`no ${kind} fix`)
  return fix
}
const TARGETS = questionTargets().targets

describe('I published this', () => {
  it('an improve fix is stored on its tracked page and carries the topic questions', () => {
    const fix = fixOf('improve')
    const url = publishedPageUrl(fix, null)
    expect(url).toBe(NAGIOS_TARGET)
    const subject = publishSubject(fix, url, TARGETS)
    expect(subject).toEqual({ pageId: 'page-nagios', url: null, also: ['topic-nagios'] })
    const request = publishRequest({
      projectId: 'proj-1',
      fix,
      subject: subject!,
      marketIds: publishMarkets(fix, TARGETS[0]),
      text: 'Added the steps.',
      now: new Date(2026, 10, 1, 15, 30)
    })
    expect(request).toMatchObject({
      pageId: 'page-nagios',
      kind: 'fix',
      rule: 'after_3_days',
      marketIds: ['mkt-us'],
      pageFixId: fix.id,
      goLiveAt: new Date(2026, 10, 1).toISOString()
    })
    // Every one of its searches, whichever topic asks them.
    expect(request.promptIds).toEqual(fix.searches.map((search) => search.promptId))
    expect(request).not.toHaveProperty('url')
  })

  it('an untracked page is stored on its topic with the address', () => {
    const fix = fixOf('improve')
    const targets = TARGETS.filter((target) => target.id !== 'page-nagios')
    expect(publishSubject(fix, NAGIOS_TARGET, targets)).toEqual({
      pageId: 'topic-nagios',
      url: NAGIOS_TARGET,
      also: []
    })
  })

  it('an owner fix logs the page Why Google picks recommends, else the target', () => {
    const fix = fixOf('owner')
    expect(publishedPageUrl(fix, NAGIOS_OTHER)).toBe(NAGIOS_OTHER)
    expect(publishedPageUrl(fix, null)).toBe(NAGIOS_TARGET)
    // The recommended page is not tracked: the topic holds it, with its address.
    expect(publishSubject(fix, NAGIOS_OTHER, TARGETS)).toMatchObject({
      pageId: 'topic-nagios',
      url: NAGIOS_OTHER
    })
  })

  it('a new page needs its address first', () => {
    const fix = fixOf('new')
    expect(publishedPageUrl(fix, null, null)).toBeNull()
    expect(publishedPageUrl(fix, null, 'https://textbolt.com/school-alerts')).toBe(
      'https://textbolt.com/school-alerts'
    )
    expect(
      publishPrefill({
        fix,
        subject: publishSubject(fix, 'https://textbolt.com/school-alerts', TARGETS),
        text: 'x'
      })
    ).toMatchObject({ pageId: 'topic-school', kind: 'new_page', pageFixId: fix.id })
  })

  it('markets: the searches’ own markets the subject has, else all of the subject’s', () => {
    const fix = fixOf('improve')
    expect(publishMarkets(fix, { marketIds: ['mkt-us', 'mkt-uk'] })).toEqual(['mkt-us'])
    expect(publishMarkets(fix, { marketIds: ['mkt-uk'] })).toEqual(['mkt-uk'])
  })

  it('words: kept page edits, else the brief, else a short line', () => {
    const fix = fixOf('improve')
    expect(publishText(fix, NAGIOS_TARGET, { edits: 'Edits', brief: 'Brief' })).toBe('Edits')
    expect(publishText(fix, NAGIOS_TARGET, { edits: null, brief: 'Brief' })).toBe('Brief')
    expect(publishText(fix, NAGIOS_TARGET, { edits: null, brief: null })).toBe(
      `Updated /integration/nagios-email-to-text-alerts for ${fix.searches.length} searches.`
    )
    expect(editsText('Page edits on https://x.com/:')).toBeNull()
    expect(editsText('Page edits on https://x.com/:\n- Added: a')).toContain('Added')
  })

  it('finds the newest fix logged from the page fix', () => {
    const fix = fixOf('improve')
    const base = {
      projectId: 'proj-1',
      fix,
      subject: { pageId: 'page-nagios', url: null, also: [] },
      marketIds: ['mkt-us'],
      text: 't'
    }
    const older = createdFix(publishRequest({ ...base, now: new Date(2026, 9, 1) }), 1)
    const newer = createdFix(publishRequest({ ...base, now: new Date(2026, 9, 20) }), 2)
    const list = [older, newer].map((item) => ({ fix: item, searchesMin: 0, searchesMax: 0 }))
    expect(publishedFixOf(fix.id, list)?.number).toBe(2)
    expect(publishedFixOf('other', list)).toBeNull()
  })

  it('says how long until the verdict', () => {
    const at = new Date(2026, 9, 31).toISOString()
    expect(liveLine({ state: 'too_early', daysLeft: 13 }, at)).toBe(
      'Live since Oct 31 · measuring, 13 days left'
    )
    expect(liveLine({ state: 'worked', daysLeft: 0 }, at)).toBe('Live since Oct 31')
  })
})
