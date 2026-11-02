import { describe, expect, test } from 'vitest'
import { SITE_TYPE_LABELS, SITE_TYPES, siteTypeOf, type SiteType } from './site-type'

function typeOf(url: string): SiteType {
  return siteTypeOf({ url, own: false, competitor: false })
}

describe('siteTypeOf', () => {
  test('the own site and a saved competitor come first, whatever the address', () => {
    expect(siteTypeOf({ url: 'https://textbolt.com/docs/api', own: true, competitor: false })).toBe(
      'yours'
    )
    expect(siteTypeOf({ url: 'https://www.twilio.com/docs', own: false, competitor: true })).toBe(
      'competitor'
    )
  })

  test.each([
    'https://www.reddit.com/r/msp/comments/1nhtfd5/emailtosms/',
    'https://www.quora.com/How-do-I-send-SMS-from-email',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.linkedin.com/pulse/sms-alerts',
    'https://x.com/twilio/status/1',
    'https://www.facebook.com/groups/msp',
    'https://www.tiktok.com/@textbolt',
    'https://medium.com/@someone/email-to-sms',
    'https://dev.to/someone/sms-alerts',
    'https://discord.com/invite/abc',
    'https://superuser.com/questions/1/sms',
    'https://networking.stackexchange.com/questions/1',
    'https://github.com/nagios/nagios/discussions/12',
    'https://community.spiceworks.com/t/sms-alerts/1'
  ])('%s is a community or social site', (url) => {
    expect(typeOf(url)).toBe('community')
  })

  test.each([
    'https://www.g2.com/products/twilio/reviews',
    'https://www.capterra.co.uk/software/1/textmagic',
    'https://www.trustpilot.com/review/textbolt.com',
    'https://www.gartner.com/reviews/market/cpaas'
  ])('%s is a review site', (url) => {
    expect(typeOf(url)).toBe('review')
  })

  test.each([
    'https://www.forbes.com/advisor/business/best-sms-service/',
    'https://techcrunch.com/2026/01/01/sms/',
    'https://www.gartner.com/en/newsroom/press-releases/1',
    'https://finance.yahoo.com/news/sms-market'
  ])('%s is news and media', (url) => {
    expect(typeOf(url)).toBe('news')
  })

  test.each([
    'https://en.wikipedia.org/wiki/SMS_gateway',
    'https://docs.nagios.com/xi/sms',
    'https://support.google.com/a/answer/1',
    'https://www.att.com/support/article/wireless/KM1061254/',
    'https://acme.com/help/sms-alerts',
    'https://github.com/nagios/nagios'
  ])('%s is docs and a knowledge base', (url) => {
    expect(typeOf(url)).toBe('docs')
  })

  test.each([
    'https://clutch.co/it-services/msp',
    'https://apps.apple.com/us/app/textbolt/id1',
    'https://www.amazon.co.uk/sms-modem/dp/1',
    'https://zapier.com/apps/textbolt/integrations',
    'https://sourceforge.net/software/sms-gateway/'
  ])('%s is a directory or marketplace', (url) => {
    expect(typeOf(url)).toBe('directory')
  })

  test.each([
    'https://email2phone.net/verizon-vtext-shutdown/',
    'https://ritzherald.com/the-text-that-never-arrived/',
    'https://assets.nagios.com/downloads/sms.pdf',
    'not a url at all'
  ])('%s is another website', (url) => {
    expect(typeOf(url)).toBe('web')
  })

  test('a stored source type wins over the address', () => {
    expect(
      siteTypeOf({
        url: 'https://forum.acme.com/t/1',
        own: false,
        competitor: false,
        sourceType: 'forum'
      })
    ).toBe('community')
    expect(
      siteTypeOf({
        url: 'https://acme.com/reviews',
        own: false,
        competitor: false,
        sourceType: 'review'
      })
    ).toBe('review')
  })

  test('an address without a scheme still sorts', () => {
    expect(typeOf('www.reddit.com/r/sysadmin')).toBe('community')
  })

  test('every type has a plain label, and none is the bare word Other', () => {
    for (const type of SITE_TYPES) {
      expect(SITE_TYPE_LABELS[type].length).toBeGreaterThan(0)
      expect(SITE_TYPE_LABELS[type]).not.toBe('Other')
    }
  })
})
