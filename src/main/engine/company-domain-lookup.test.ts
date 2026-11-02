import { describe, expect, test } from 'vitest'
import type { AddressLookup } from '../pipeline/fetch-guard'
import {
  checkTypedDomain,
  domainNamesBrand,
  lookupCompanyDomain,
  validHostname
} from './company-domain-lookup'
import { COMPETITOR_RULES } from './competitor-rules'
import { plainReason, type SuggestedCompany } from './competitor-guard'
import { guardFillCompanies } from './fill-companies'
import { parseOfficialDomains } from './official-domains'

/** Fake DNS: only these names resolve; `private` ones resolve to a private address. */
function dns(
  names: readonly string[],
  privateNames: readonly string[] = []
): AddressLookup & {
  asked: string[]
} {
  const asked: string[] = []
  return {
    asked,
    async lookup(hostname) {
      asked.push(hostname)
      if (privateNames.includes(hostname)) return ['10.0.0.8']
      if (!names.includes(hostname)) throw new Error('ENOTFOUND')
      return ['93.184.216.34']
    }
  }
}

describe('lookupCompanyDomain (batch 2 row 3)', () => {
  test('keeps the first candidate that resolves and spells the brand', async () => {
    const lookup = dns(['textemall.com', 'text-em-all.com'])
    const found = await lookupCompanyDomain({
      name: 'Text-Em-All',
      candidates: ['textemall.co', 'https://www.TextEmAll.com/', 'text-em-all.com'],
      ownDomain: 'textbolt.com',
      dns: lookup
    })
    expect(found).toBe('textemall.com')
    expect(lookup.asked).toEqual(['textemall.co', 'textemall.com'])
  })

  test('never shows an unverified candidate: no DNS, private address, own domain, marketplace', async () => {
    const found = await lookupCompanyDomain({
      name: 'Rival',
      candidates: ['rival.example', 'rival.internal', 'textbolt.com', 'g2.com', 'not a domain'],
      ownDomain: 'textbolt.com',
      dns: dns(['textbolt.com', 'g2.com'], ['rival.internal'])
    })
    expect(found).toBeNull()
  })

  test('a domain that does not spell the brand needs a homepage that names it', async () => {
    const reads: string[] = []
    const base = {
      name: 'Acme Alerts',
      candidates: ['acmesms.com'],
      ownDomain: 'textbolt.com',
      dns: dns(['acmesms.com'])
    }
    expect(await lookupCompanyDomain(base)).toBeNull()
    const named = await lookupCompanyDomain({
      ...base,
      readHomepage: async (domain) => {
        reads.push(domain)
        return { title: 'Acme Alerts | Text alerts for teams', text: 'Send texts.' }
      }
    })
    expect(named).toBe('acmesms.com')
    expect(reads).toEqual(['acmesms.com'])
    const other = await lookupCompanyDomain({
      ...base,
      readHomepage: async () => ({ title: 'Parked domain', text: 'This domain is for sale.' })
    })
    expect(other).toBeNull()
  })

  test('domainNamesBrand and validHostname', () => {
    expect(domainNamesBrand('text-em-all.com', 'Text-Em-All')).toBe(true)
    expect(domainNamesBrand('twilio.com', 'Twilio SMS')).toBe(true)
    expect(domainNamesBrand('getjobber.com', 'Jobber')).toBe(true)
    expect(domainNamesBrand('text.com', 'TextMagic')).toBe(false)
    expect(validHostname(' HTTPS://www.Example.com:443/x ')).toBe('example.com')
    expect(validHostname('[not a note]')).toBeNull()
  })

  test('checkTypedDomain: hostname, then DNS', async () => {
    const lookup = dns(['simpletexting.com'])
    expect(await checkTypedDomain('www.simpletexting.com', lookup)).toEqual({
      ok: true,
      domain: 'simpletexting.com',
      message: 'simpletexting.com found.'
    })
    expect((await checkTypedDomain('simple texting', lookup)).ok).toBe(false)
    expect(await checkTypedDomain('simpletxting.com', lookup)).toEqual({
      ok: false,
      domain: null,
      message: 'simpletxting.com was not found. Check the spelling and try again.'
    })
  })
})

describe('guardFillCompanies lookup path (fake Claude, fake DNS)', () => {
  const pages = [
    { path: '/compare', text: 'TextBolt vs Text-Em-All. SimpleTexting. Ghost Co.' }
  ] as const
  const competitor = (
    name: string,
    domain: string | null,
    officialDomain?: string | null
  ): SuggestedCompany => ({
    name,
    domain,
    reason: `A buyer could pick ${name} instead.`,
    evidence: { path: '/compare', quote: name },
    ...(officialDomain !== undefined ? { officialDomain } : {})
  })

  test('same-call candidates first, one follow-up only for rows without any', async () => {
    let n = 0
    const asked: string[][] = []
    const result = await guardFillCompanies({
      ideas: {
        competitors: [
          competitor('Text-Em-All', null, 'textemall.com'),
          competitor('SimpleTexting', null),
          competitor('Ghost Co', null)
        ],
        switchingFrom: [],
        integrations: []
      },
      pages,
      domain: 'textbolt.com',
      brandNames: ['TextBolt'],
      seen: [],
      dns: dns(['textemall.com', 'simpletexting.com']),
      createId: () => String((n += 1)),
      askOfficialDomains: async (companies) => {
        asked.push(companies.map((item) => item.name))
        return new Map([
          ['SimpleTexting', ['simpletexting.com']],
          ['Ghost Co', ['ghost.example']]
        ])
      }
    })
    expect(asked).toEqual([['SimpleTexting', 'Ghost Co']])
    expect(result.competitors.map((item) => [item.name, item.domain, item.domainSource])).toEqual([
      ['Text-Em-All', 'textemall.com', 'lookup'],
      ['SimpleTexting', 'simpletexting.com', 'lookup'],
      ['Ghost Co', null, null]
    ])
  })

  test('a failing follow-up leaves the domain unknown and the rest intact', async () => {
    const result = await guardFillCompanies({
      ideas: {
        competitors: [competitor('SimpleTexting', null)],
        switchingFrom: [],
        integrations: []
      },
      pages,
      domain: 'textbolt.com',
      brandNames: ['TextBolt'],
      seen: [],
      dns: dns(['simpletexting.com']),
      createId: () => 'x',
      askOfficialDomains: async () => {
        throw new Error('claude down')
      }
    })
    expect(result.competitors.map((item) => [item.name, item.domain, item.domainSource])).toEqual([
      ['SimpleTexting', null, null]
    ])
  })

  test('parseOfficialDomains reads the follow-up reply', () => {
    expect(
      parseOfficialDomains({ domains: [{ name: ' Rival ', candidates: ['rival.com', 3, ''] }] })
    ).toEqual(new Map([['Rival', ['rival.com']]]))
    expect(parseOfficialDomains({ domains: [{ name: 'Rival' }] })).toBeNull()
  })
})

describe('reasons are plain buyer-facing sentences (batch 2 row 3)', () => {
  test('drops notes about the pages read, bracketed or not', () => {
    expect(
      plainReason(
        'A buyer could pick it instead for the same job: the compare page sets it side by side with TextBolt on pricing, email-to-SMS workflow and team access. [The pages read do not show what Text-Em-All does better.]'
      )
    ).toBe(
      'A buyer could pick it instead for the same job: the compare page sets it side by side with TextBolt on pricing, email-to-SMS workflow and team access.'
    )
    expect(
      plainReason('Sells mass alerts. The site does not say what it costs. Popular with schools.')
    ).toBe('Sells mass alerts. Popular with schools.')
    expect(plainReason('Pricing is not shown on the pages.')).toBe('')
    expect(plainReason('[No information on the pages about it.] Sells alerts.')).toBe(
      'Sells alerts.'
    )
    expect(
      plainReason(
        "People who sent texts through the Verizon gateway are moving to TextBolt. [Confirm the gateway's status before publishing.]"
      )
    ).toBe('People who sent texts through the Verizon gateway are moving to TextBolt.')
    expect(plainReason('Sells alerts. Check the price before you publish.')).toBe('Sells alerts.')
  })

  test('keeps a bracketed unconfirmed fact', () => {
    expect(plainReason('Plans start at [$29 a month] for small teams.')).toBe(
      'Plans start at [$29 a month] for small teams.'
    )
  })

  test('the guard falls back to a plain line when nothing is left', async () => {
    const result = await guardFillCompanies({
      ideas: {
        competitors: [
          {
            name: 'Text-Em-All',
            domain: null,
            reason: '[The pages read do not show what Text-Em-All does better.]',
            evidence: { path: '/compare', quote: 'Text-Em-All' }
          }
        ],
        switchingFrom: [],
        integrations: []
      },
      pages: [{ path: '/compare', text: 'TextBolt vs Text-Em-All' }],
      domain: 'textbolt.com',
      brandNames: ['TextBolt'],
      seen: [],
      dns: dns([]),
      createId: () => 'x'
    })
    expect(result.competitors[0]?.reason).toBe('The site names it on /compare.')
  })

  test('the shared competitor rules forbid notes about the pages in reasons', () => {
    expect(COMPETITOR_RULES).toContain(
      'Never write about the pages, the reading or what is missing'
    )
  })
})
