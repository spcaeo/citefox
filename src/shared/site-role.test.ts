import { describe, expect, test } from 'vitest'
import { overrideFor } from './site-overrides'
import { knownPlatform, SITE_ROLE_LABELS, SITE_ROLES } from './site-role'

describe('knownPlatform', () => {
  test.each([
    ['https://www.reddit.com/r/msp/comments/abc123/best_sms_tool/', 'community', 'Reddit', 'r/msp'],
    ['https://old.reddit.com/r/sysadmin/', 'community', 'Reddit', 'r/sysadmin'],
    ['https://www.reddit.com/user/someone', 'community', 'Reddit', null],
    ['https://redd.it/abc123', 'community', 'Reddit', null],
    ['https://www.youtube.com/@textbolt/videos', 'video', 'YouTube', '@textbolt'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'video', 'YouTube', null],
    ['https://youtu.be/dQw4w9WgXcQ', 'video', 'YouTube', null],
    ['https://vimeo.com/123', 'video', 'Vimeo', null],
    ['https://www.quora.com/What-is-the-best-SMS-app', 'qa', 'Quora', null],
    ['https://stackoverflow.com/questions/1', 'qa', 'Stack Overflow', null],
    ['https://superuser.stackexchange.com/q/1', 'qa', 'Stack Exchange', 'superuser'],
    ['https://www.linkedin.com/pulse/sms-tips', 'social', 'LinkedIn', null],
    ['https://uk.linkedin.com/company/acme', 'social', 'LinkedIn', null],
    ['https://x.com/acme/status/1', 'social', 'X', null],
    ['https://twitter.com/acme', 'social', 'X', null],
    ['https://www.facebook.com/acme', 'social', 'Facebook', null],
    ['https://www.tiktok.com/@acme', 'social', 'TikTok', null],
    ['https://medium.com/@someone/sms-guide', 'social', 'Medium', null],
    ['https://en.wikipedia.org/wiki/SMS', 'encyclopedia', 'Wikipedia', null],
    ['https://www.g2.com/products/textbolt/reviews', 'review', 'G2', null],
    ['https://www.capterra.com/p/1/textbolt/', 'review', 'Capterra', null],
    ['https://www.capterra.co.uk/software/1', 'review', 'Capterra', null],
    ['https://uk.trustpilot.com/review/textbolt.com', 'review', 'Trustpilot', null],
    ['https://www.gartner.com/reviews/market/sms', 'review', 'Gartner Peer Insights', null],
    ['https://www.gartner.com/en/articles/sms', 'media', 'Gartner', null],
    ['https://www.forbes.com/advisor/business/sms/', 'media', 'Forbes', null],
    ['https://techcrunch.com/2026/01/01/a/', 'media', 'TechCrunch', null],
    ['https://community.spiceworks.com/t/sms/1', 'community', 'Spiceworks Community', null],
    ['https://forum.acme.io/t/1', 'community', 'forum.acme.io', null],
    ['https://news.ycombinator.com/item?id=1', 'community', 'Hacker News', null]
  ])('%s is %s · %s', (url, role, name, detail) => {
    expect(knownPlatform(url)).toEqual({ role, name, detail })
  })

  test.each([
    'https://textbolt.com/sms',
    'https://www.att.com/business/sms',
    'https://www.verizon.com/business/',
    'https://www.twilio.com/docs/sms',
    'https://docs.acme.com/sms',
    'not a url at all'
  ])('%s is no platform (neutral until the user says)', (url) => {
    expect(knownPlatform(url)).toBeNull()
  })

  test('reads an address with no scheme', () => {
    expect(knownPlatform('reddit.com/r/msp')).toMatchObject({ name: 'Reddit', detail: 'r/msp' })
  })

  test('no platform is ever a competitor, and every role has a label that is not "Other"', () => {
    expect(SITE_ROLES).not.toContain('competitor')
    for (const role of SITE_ROLES) expect(SITE_ROLE_LABELS[role]).not.toMatch(/other|competitor/i)
  })
})

describe('overrideFor', () => {
  const overrides = [
    { domain: 'reddit.com', type: null, role: 'social' as const },
    { domain: 'old.reddit.com', type: 'news' as const, role: null },
    { domain: 'att.com', type: 'custom:t1' as const, role: null }
  ]

  test('the domain itself, else the nearest parent; never a look-alike', () => {
    expect(overrideFor('www.reddit.com', overrides)?.domain).toBe('reddit.com')
    expect(overrideFor('np.reddit.com', overrides)?.domain).toBe('reddit.com')
    expect(overrideFor('old.reddit.com', overrides)?.domain).toBe('old.reddit.com')
    expect(overrideFor('https://www.att.com/x', overrides)?.type).toBe('custom:t1')
    expect(overrideFor('notreddit.com', overrides)).toBeNull()
    expect(overrideFor('example.com', [])).toBeNull()
  })
})
