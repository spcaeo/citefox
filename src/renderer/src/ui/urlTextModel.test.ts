import { describe, expect, it } from 'vitest'
import { displayAddress, domainHref, hostOf, resolveUrlText, splitLabel } from './urlTextModel'

describe('urlTextModel', () => {
  it('shows an address without https:// and www.', () => {
    expect(displayAddress('https://www.textbolt.com/a/')).toBe('textbolt.com/a/')
    expect(displayAddress('https://textbolt.com/')).toBe('textbolt.com')
    expect(displayAddress('http://localhost:3000/x')).toBe('localhost:3000/x')
    expect(displayAddress('mailto:a@b.com')).toBe('mailto:a@b.com')
    expect(displayAddress('/pricing')).toBe('/pricing')
  })

  it('finds the host of web addresses only', () => {
    expect(hostOf('https://www.TextBolt.com/a')).toBe('textbolt.com')
    expect(hostOf('/a')).toBeNull()
    expect(hostOf('mailto:a@b.com')).toBeNull()
    expect(hostOf('https://')).toBeNull()
  })

  it('opens a domain on its home page', () => {
    expect(domainHref('twilio.com')).toBe('https://twilio.com')
    expect(domainHref(' reddit.com/r/sysadmin ')).toBe('https://reddit.com/r/sysadmin')
    expect(domainHref('http://a.com')).toBe('http://a.com')
  })

  it('resolves a domain, a path on a site, a bare path and a URL', () => {
    expect(resolveUrlText({ domain: 'twilio.com' })).toEqual({
      href: 'https://twilio.com',
      label: 'twilio.com',
      iconDomain: 'twilio.com',
      openable: true,
      variant: 'domain'
    })
    expect(resolveUrlText({ path: '/pricing/', site: 'textbolt.com' })).toEqual({
      href: 'https://textbolt.com/pricing/',
      label: '/pricing/',
      iconDomain: 'textbolt.com',
      openable: true,
      variant: 'path'
    })
    expect(resolveUrlText({ url: 'https://textbolt.com/a/', label: '/a/' })).toMatchObject({
      href: 'https://textbolt.com/a/',
      iconDomain: 'textbolt.com',
      variant: 'path'
    })
    expect(resolveUrlText({ url: '/pricing/' })).toMatchObject({
      href: '/pricing/',
      iconDomain: null,
      openable: false,
      variant: 'path'
    })
    expect(resolveUrlText({ url: 'https://a.com/x', label: 'X', variant: 'domain' })).toMatchObject(
      {
        href: 'https://a.com/x',
        label: 'X',
        variant: 'domain'
      }
    )
  })

  it('cuts long addresses between the domain, the middle and the last segment', () => {
    expect(splitLabel('textbolt.com/a')).toBeNull()
    expect(splitLabel('simpletexting.com/blog/email-to-text-guide/carriers-shut-down/')).toEqual({
      head: 'simpletexting.com',
      middle: '/blog/email-to-text-guide',
      tail: '/carriers-shut-down/'
    })
    expect(splitLabel('/blog/how-to/set-up-text-alerts-for-business-teams')).toEqual({
      head: '',
      middle: '/blog/how-to',
      tail: '/set-up-text-alerts-for-business-teams'
    })
    // One long segment: nothing in the middle to give way.
    expect(splitLabel('/set-up-text-alerts-for-business-teams-in-2026')).toBeNull()
    // A title is not an address.
    expect(splitLabel('How to set up text alerts for business teams / a guide')).toBeNull()
  })
})
