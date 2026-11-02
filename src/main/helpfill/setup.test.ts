import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { SERP_SECRET, seedAssistProject, type AssistSeed } from '../assist/assist.test-helper'
import { insertClaudeCheckup } from '../storage'
import { insertLlmCall } from '../storage/llm-calls'
import { estimateSetup } from './setup'

/**
 * `helpfill:setup*` through the real handlers: New project's one multi-section
 * prompt and reading a ChatGPT-style answer, before any project exists.
 */

const SITE = {
  domain: 'textbolt.com',
  brandNames: ['TextBolt'],
  market: { country: 'US', language: 'en', location: null }
}

/** Chatter, markdown headings, a fenced block, the site itself, a brand row and a near-repeat. */
const ANSWER = `Sure! I visited textbolt.com. Here is everything:

### PRODUCTS
\`\`\`csv
name,url,job
Email to SMS,https://textbolt.com/email-to-text/,Send texts from any email client
Text alerts,/alerts/,Alert a crew by text when a system emails
\`\`\`

**Buyers**
who,problem,trigger,product
Office managers at small firms,Staff miss urgent emails,A carrier gateway shut down,Email to SMS
IT and ops teams,Monitoring alerts go unseen at night,An outage nobody saw,Text alerts

## COMPETITORS
| name | domain | competes_with |
| --- | --- | --- |
| Twilio | https://www.twilio.com/ | Text alerts |
| SimpleTexting | simpletexting.com | Email to SMS |
| TextBolt | textbolt.com | Email to SMS |

### MARKETS
country,language,city
United States,English,
CA,en,none

### QUESTIONS
question,stage,product
"My carrier stopped email to text, what can I use now?",Problem,Email to SMS
"My carrier stopped email to text, what can I use now",Problem,Email to SMS
How do I text the night shift when a freezer alarm emails?,Options,Text alerts
Is TextBolt cheaper than Twilio for alerts?,Compare,Text alerts

Let me know if you want more questions!`

let seed: AssistSeed

beforeEach(async () => {
  seed = await seedAssistProject()
})

afterEach(() => {
  seed.close()
})

describe('helpfill:setupPrompt', () => {
  test('asks for the five sections from the typed site only, with no empty lines', async () => {
    const result = await seed.handlers['helpfill:setupPrompt']({ site: SITE })
    const prompt = result.prompt
    expect(result.kind).toBe('project')
    expect(prompt.split('\n')[0]).toBe('You help set up AI-search tracking for textbolt.com.')
    expect(prompt).toContain('Business: textbolt.com.')
    expect(prompt).toContain('Market: United States (English)')
    expect(prompt).toContain('Visit textbolt.com and read its main pages')
    expect(prompt).toContain('Never name TextBolt.')
    expect(prompt).toContain('QUESTIONS: 24 questions')
    for (const block of [
      '### PRODUCTS\nname,url,job',
      '### BUYERS\nwho,problem,trigger,product',
      '### COMPETITORS\nname,domain,competes_with',
      '### MARKETS\ncountry,language,city',
      '### QUESTIONS\nquestion,stage,product'
    ]) {
      expect(prompt).toContain(block)
    }
    expect(prompt).not.toContain('Already tracked')
    expect(prompt).not.toMatch(/not given|not set|none given|none saved/u)
  })

  test('without a market or brand, those lines are left out; no key or email gets through', async () => {
    const result = await seed.handlers['helpfill:setupPrompt']({
      site: { domain: 'https://www.TextBolt.com/pricing', brandNames: [], market: null }
    })
    expect(result.prompt).toContain('Business: textbolt.com.')
    expect(result.prompt).not.toContain('Market:')
    expect(result.prompt).not.toContain('Brand names')
    const sneaky = await seed.handlers['helpfill:setupPrompt']({
      site: { ...SITE, brandNames: [`TextBolt ${SERP_SECRET}`, 'owner@textbolt.com'] }
    })
    expect(sneaky.prompt).not.toContain(SERP_SECRET)
    expect(sneaky.prompt).not.toContain('owner@textbolt.com')
  })

  test('a request without a usable domain is refused', async () => {
    await expect(
      seed.handlers['helpfill:setupPrompt']({ site: { ...SITE, domain: 'not a site' } })
    ).rejects.toThrow(/domain/u)
    await expect(
      seed.handlers['helpfill:setupPrompt']({ site: SITE, extra: 1 } as never)
    ).rejects.toThrow()
  })
})

describe('helpfill:setupRead', () => {
  test('reads every section, drops the site itself, merges a repeat and sets the brand row aside', async () => {
    const result = await seed.handlers['helpfill:setupRead']({ site: SITE, text: ANSWER })
    const of = (section: string): Record<string, string>[] =>
      result.rows.filter((row) => row.section === section).map((row) => ({ ...row.values }))
    expect(of('products')).toEqual([
      { name: 'Email to SMS', url: '/email-to-text/', job: 'Send texts from any email client' },
      { name: 'Text alerts', url: '/alerts/', job: 'Alert a crew by text when a system emails' }
    ])
    expect(of('buyers').map((row) => row.who)).toEqual([
      'Office managers at small firms',
      'IT and ops teams'
    ])
    expect(of('competitors')).toEqual([
      { name: 'Twilio', domain: 'twilio.com', competes_with: 'Text alerts' },
      { name: 'SimpleTexting', domain: 'simpletexting.com', competes_with: 'Email to SMS' }
    ])
    expect(of('markets')).toEqual([
      { country: 'US', language: 'en', city: '' },
      { country: 'CA', language: 'en', city: '' }
    ])
    expect(of('questions')).toEqual([
      {
        question: 'My carrier stopped email to text, what can I use now?',
        stage: 'problem',
        product: 'Email to SMS'
      },
      {
        question: 'How do I text the night shift when a freezer alarm emails?',
        stage: 'options',
        product: 'Text alerts'
      }
    ])
    expect(result.counts).toMatchObject({ repeats: 1, setAside: 1, ready: 10 })
    expect(result.setAside[0]?.values.question).toBe('Is TextBolt cheaper than Twilio for alerts?')
    expect(result.warnings).toEqual([])
  })

  test('an answer without sections says so', async () => {
    const result = await seed.handlers['helpfill:setupRead']({
      site: SITE,
      text: 'Sorry, I cannot browse the web.'
    })
    expect(result.rows).toEqual([])
    expect(result.warnings[0]).toMatch(/No table or list was found/u)
  })
})

describe('helpfill:setupEstimate', () => {
  test('Claude set up: the read’s cost; no key: not available, and why', async () => {
    expect(await seed.handlers['helpfill:setupEstimate']()).toMatchObject({
      available: true,
      costText: 'Up to 5 AI calls · on your AI plan'
    })
    const api = { ...seed.host, claude: { ...seed.claude, id: 'anthropic-api' as const } }
    expect(estimateSetup(api).costText).toBe('Up to 5 AI calls · about $0.05')
    const keyless = {
      ...seed.host,
      claude: undefined,
      settings: () => ({ ...seed.host.settings(), claudeProvider: 'anthropic-api' as const })
    }
    expect(estimateSetup(keyless)).toMatchObject({
      available: false,
      reason: 'Needs CiteFox AI connected.'
    })
  })

  test('Claude Code whose latest checkup failed: not available, so step 3 offers ChatGPT', () => {
    const host = { ...seed.host, claude: undefined }
    expect(estimateSetup(host).available).toBe(true)
    insertClaudeCheckup(host.storage.db, {
      id: 'checkup-missing',
      ranAt: '2026-10-24T12:00:00.000Z',
      result: {
        binaryPath: null,
        version: null,
        login: 'skipped',
        plan: null,
        roundTrip: 'skipped',
        durationMs: null,
        resolvedModel: null,
        ready: false,
        message: 'Claude Code was not found.',
        nextStep: 'Install Claude Code, then check again.',
        rows: {
          binary: {
            state: 'warning',
            statusLabel: 'Not found on PATH',
            detail: 'CiteFox looked on your PATH.',
            nextStep: 'Install Claude Code, then check again.'
          },
          login: { state: 'skipped', statusLabel: 'Skipped', detail: 'Later', nextStep: null },
          roundTrip: { state: 'skipped', statusLabel: 'Skipped', detail: 'Later', nextStep: null }
        }
      }
    })
    expect(estimateSetup(host)).toMatchObject({
      available: false,
      reason: 'CiteFox AI is not ready.'
    })
    // Claude Code answered a real call after that failed checkup: ready again.
    insertLlmCall(
      host.storage.db,
      {
        id: 'call-after',
        connection: 'claude-code',
        model: null,
        source: 'assist',
        templateKind: null,
        templateId: null,
        templateHash: null,
        assistId: null,
        startedAt: '2026-10-24T13:00:00.000Z',
        durationMs: 1000,
        tokensIn: 1,
        tokensOut: 1,
        ok: true,
        error: null
      },
      { table: 'app', projectId: null }
    )
    expect(estimateSetup(host).available).toBe(true)
  })
})
