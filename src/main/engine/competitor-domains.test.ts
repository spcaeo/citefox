import { describe, expect, test } from 'vitest'
import type { AddressLookup } from '../pipeline/fetch-guard'
import { bareDomain, verifyCompetitorDomains } from './competitor-domains'

/** Fake DNS: only these names resolve. */
function dns(table: Record<string, readonly string[]>): AddressLookup & { asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    async lookup(hostname) {
      asked.push(hostname)
      const found = table[hostname]
      if (found === undefined) throw new Error('ENOTFOUND')
      return found
    }
  }
}

describe('verifyCompetitorDomains (live run: textemall.com does not exist)', () => {
  test('drops a suggested domain that does not resolve', async () => {
    const lookup = dns({ 'simpletexting.com': ['104.18.1.1'] })
    const result = await verifyCompetitorDomains({
      suggested: [
        { domain: 'simpletexting.com', reason: 'Business texting.' },
        { domain: 'textemall.com', reason: 'Mass alerts.' }
      ],
      seen: [],
      dns: lookup
    })
    expect(result.kept.map((item) => item.domain)).toEqual(['simpletexting.com'])
    expect(result.dropped).toEqual(['textemall.com'])
  })

  test('prefers the spelling Google cites, without a DNS lookup', async () => {
    const lookup = dns({})
    const result = await verifyCompetitorDomains({
      suggested: [{ domain: 'https://www.TextEmAll.com/', reason: 'Mass alerts.' }],
      seen: ['text-em-all.com', 'reddit.com'],
      dns: lookup
    })
    expect(result.kept).toEqual([{ domain: 'text-em-all.com', reason: 'Mass alerts.' }])
    expect(result.dropped).toEqual([])
    expect(lookup.asked).toEqual([])
  })

  test('drops a domain that resolves to a private address, and puts cited domains first', async () => {
    const lookup = dns({ 'intranet.example': ['10.0.0.5'], 'twilio.com': ['3.3.3.3'] })
    const result = await verifyCompetitorDomains({
      suggested: [
        { domain: 'twilio.com', reason: 'API.' },
        { domain: 'intranet.example', reason: 'No.' },
        { domain: 'simpletexting.com', reason: 'Cited.' }
      ],
      seen: ['simpletexting.com'],
      dns: lookup
    })
    expect(result.kept.map((item) => item.domain)).toEqual(['simpletexting.com', 'twilio.com'])
    expect(result.dropped).toEqual(['intranet.example'])
  })

  test('bareDomain strips scheme, www, port and path', () => {
    expect(bareDomain(' HTTPS://www.Example.com:443/path?q=1 ')).toBe('example.com')
  })
})
