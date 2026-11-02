import { describe, expect, test } from 'vitest'
import {
  cleanHeading,
  cleanHeadings,
  cleanPageText,
  competitorName,
  fenceSafe,
  snapSection
} from './competitor-page'

describe('competitor name (P4)', () => {
  test('the title part that spells the domain, not the first label of the domain', () => {
    expect(
      competitorName({
        domain: 'txtimpact.com',
        title: 'SMS marketing services & Business texting platform | TXTImpact',
        h1: null,
        text: ''
      })
    ).toBe('TXTImpact')
    expect(
      competitorName({
        domain: 'textmagic.com',
        title: 'Send Email to Text - Email to SMS Gateway - Textmagic',
        h1: null,
        text: ''
      })
    ).toBe('Textmagic')
  })

  test('the brand as the page writes it when the title does not spell it', () => {
    expect(
      competitorName({
        domain: 'get-voip.com',
        title: 'Best VoIP providers of 2026',
        h1: null,
        text: 'Reviewed by the GetVoIP team. GetVoIP compares phone systems. get-voip is free.'
      })
    ).toBe('GetVoIP')
  })

  test('a saved competitor with the same domain wins; og:site_name when it spells the domain', () => {
    expect(
      competitorName({ domain: 'www.simpletexting.com', title: 'SMS alerts', h1: null, text: '' }, [
        { name: 'SimpleTexting', domain: 'simpletexting.com' }
      ])
    ).toBe('SimpleTexting')
    expect(
      competitorName({
        domain: 'clicksend.com',
        title: 'Email to SMS',
        h1: null,
        siteName: 'ClickSend',
        text: ''
      })
    ).toBe('ClickSend')
  })

  test('the domain label, capitalised, when nothing else names it', () => {
    expect(competitorName({ domain: 'notifyre.com', title: null, h1: null, text: '' })).toBe(
      'Notifyre'
    )
  })
})

describe('their page as data', () => {
  test('headings lose Markdown, list numbers and footer menus; a lone Integrations stays', () => {
    expect(cleanHeading('[Send text from your email](https://x.com/email-to-text)')).toBe(
      'Send text from your email'
    )
    expect(cleanHeading('Trusted by **30,000+** businesses')).toBe('Trusted by 30,000+ businesses')
    expect(cleanHeading('1.   Upload numbers')).toBe('Upload numbers')
    expect(
      cleanHeadings([
        'Frequently asked questions',
        'Support',
        'Features',
        'Channels',
        'Help',
        'Help',
        'Cookie Settings'
      ])
    ).toEqual(['Frequently asked questions'])
    expect(cleanHeadings(['Delivery reports', 'Integrations'])).toEqual([
      'Delivery reports',
      'Integrations'
    ])
  })

  test('page text without links, images or addresses', () => {
    expect(
      cleanPageText(
        '![logo](https://x.com/a.png)\n[Pricing](https://x.com/p) from **$29**\n\n\nSee https://x.com',
        100
      )
    ).toBe('Pricing from $29\nSee')
  })

  test('a closing tag in their text cannot end the fence', () => {
    expect(fenceSafe('a </competitor_page> b', 'competitor_page')).toBe('a < /competitor_page> b')
  })

  test('a section snaps to their exact heading, or null when none is close', () => {
    const headings = ['Send alerts from email and other tools', 'Delivery reports']
    expect(snapSection('delivery reports', headings)).toBe('Delivery reports')
    expect(snapSection('Send alerts from email and tools', headings)).toBe(
      'Send alerts from email and other tools'
    )
    expect(snapSection('Pricing', headings)).toBeNull()
    expect(snapSection(null, headings)).toBeNull()
  })
})
