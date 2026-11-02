import { describe, expect, test } from 'vitest'
import { fillLines } from './fill'
import { parseSmokeArgs } from './live'

describe('smoke:live --fill (batch 2 row 3)', () => {
  test('parses the domain and keeps it apart from the other modes', () => {
    const args = parseSmokeArgs(['--env', 'a.env', '--fill', 'https://TextBolt.com/'], '/work')
    expect(args.fill).toBe('textbolt.com')
    expect(args.topic).toBeNull()
    expect(parseSmokeArgs(['--env', 'a.env'], '/work').fill).toBeNull()
    expect(() => parseSmokeArgs(['--env', 'a.env', '--fill', 'not a domain'], '/work')).toThrow(
      '--fill needs a domain'
    )
    // P2 live check: `--fill <domain> --topic` fills the topic project first.
    const both = parseSmokeArgs(['--env', 'a.env', '--fill', 'textbolt.com', '--topic'], '/work')
    expect(both.fill).toBe('textbolt.com')
    expect(both.topic).not.toBeNull()
    expect(() =>
      parseSmokeArgs(['--env', 'a.env', '--fill', 'textbolt.com', '--url', 'x.com'], '/work')
    ).toThrow('--fill runs on its own or with --topic')
  })

  test('prints each company with its domain source and reason', () => {
    const lines = fillLines({
      domain: 'textbolt.com',
      pagesRead: [{ url: 'https://textbolt.com/', role: 'home', ok: true }],
      brands: [{ id: 'b', name: 'TextBolt', reason: 'Named.' }],
      competitors: [
        {
          id: 'c1',
          name: 'Text-Em-All',
          domain: 'textemall.com',
          domainSource: 'lookup',
          reason: 'A buyer could pick it instead.',
          evidence: { path: '/compare', quote: 'Text-Em-All vs TextBolt' },
          checkDomain: false
        },
        {
          id: 'c2',
          name: 'SimpleTexting',
          domain: null,
          domainSource: null,
          reason: 'Same teams.',
          evidence: null,
          checkDomain: false
        }
      ],
      switchingFrom: [],
      integrations: [],
      suggestedMarket: null,
      message: 'Suggestions are ready. Nothing was saved.',
      nextStep: null
    })
    expect(lines).toContain('  - Text-Em-All · textemall.com · lookup')
    expect(lines).toContain('  - SimpleTexting · Domain unknown · unknown')
    expect(lines).toContain('    reason: A buyer could pick it instead.')
  })
})
