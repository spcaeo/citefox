import { describe, expect, test } from 'vitest'
import {
  brandingMode,
  bylineText,
  cleanSender,
  NO_SENDER,
  reportByline,
  senderEmailName,
  senderFieldProblem,
  type ReportSender
} from './sender'

const LOGO = 'data:image/png;base64,iVBORw0KGgo='
const AGENCY: ReportSender = {
  mode: 'agency',
  name: 'Northwind SEO',
  logo: LOGO,
  website: 'northwindseo.com',
  email: 'hello@northwindseo.com',
  preparedBy: ''
}

describe('report sender (Settings › Reports)', () => {
  test('cleaning keeps a known mode, trims names and drops a bad website, email or logo', () => {
    expect(cleanSender(null)).toEqual(NO_SENDER)
    expect(cleanSender({ mode: 'reseller', name: '  A  ' }).mode).toBe('none')
    const clean = cleanSender({
      mode: 'agency',
      name: '  Northwind   SEO ',
      logo: 'data:text/html;base64,AAAA',
      website: 'not a site',
      email: 'nope',
      preparedBy: 'x'.repeat(200)
    })
    expect(clean).toMatchObject({ mode: 'agency', name: 'Northwind SEO', logo: null })
    expect(clean.website).toBe('')
    expect(clean.email).toBe('')
    expect(clean.preparedBy).toHaveLength(80)
    expect(cleanSender(AGENCY)).toEqual(AGENCY)
    expect(senderFieldProblem('email', 'nope')).toMatch(/email/)
    expect(senderFieldProblem('website', 'https://northwindseo.com/about')).toBeNull()
    expect(senderFieldProblem('website', '')).toBeNull()
  })

  test('the mode: an agency with no name yet reads as no branding', () => {
    expect(brandingMode(undefined)).toBe('none')
    expect(brandingMode(AGENCY)).toBe('agency')
    expect(brandingMode({ ...AGENCY, name: '' })).toBe('none')
    expect(brandingMode({ ...NO_SENDER, mode: 'company' })).toBe('company')
  })

  test('agency: agency left, client right; the client defaults to the brand', () => {
    const byline = reportByline(AGENCY, { preparedFor: '', logo: null }, 'TextBolt')
    expect(byline).toMatchObject({
      mode: 'agency',
      fromName: 'Northwind SEO',
      fromWebsite: 'northwindseo.com',
      forName: 'TextBolt',
      preparedBy: 'Northwind SEO'
    })
    expect(bylineText(byline!)).toBe('Prepared by Northwind SEO for TextBolt')
    const named = reportByline(AGENCY, { preparedFor: 'Acme', logo: LOGO }, 'TextBolt')
    expect(named?.forName).toBe('Acme')
    expect(named?.forLogo).toBe(LOGO)
    expect(senderEmailName(AGENCY)).toBe('Northwind SEO')
  })

  test('in-house: the company (default the brand and its site icon), no client anywhere', () => {
    const company: ReportSender = { ...NO_SENDER, mode: 'company', preparedBy: 'Growth team' }
    const byline = reportByline(company, { preparedFor: 'Acme', logo: LOGO }, 'TextBolt', LOGO)
    expect(byline).toMatchObject({
      mode: 'company',
      fromName: 'TextBolt',
      fromLogo: LOGO,
      forName: 'Acme',
      forLogo: null,
      preparedBy: 'Growth team'
    })
    expect(bylineText(byline!)).toBe('TextBolt · reports for Acme')
    const own = reportByline(
      { ...company, name: 'TextBolt Inc.' },
      { preparedFor: '', logo: null, preparedBy: 'Dana' },
      'TextBolt'
    )
    expect(own?.preparedBy).toBe('Dana')
    expect(bylineText(own!)).toBe('TextBolt Inc.')
    expect(senderEmailName(company)).toBe('Growth team')
  })

  test('just me: no byline, today’s look', () => {
    expect(reportByline(NO_SENDER, { preparedFor: 'Acme', logo: null }, 'TextBolt')).toBeNull()
    expect(senderEmailName(NO_SENDER)).toBe('')
  })
})
