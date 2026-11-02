import type { BuyerProfile } from '@shared/domain'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  NOW,
  SEED,
  SERP_SECRET,
  seedAssistProject,
  type AssistSeed
} from '../assist/assist.test-helper'
import { contentHash } from '../pipeline/hash'
import { insertBuyerProfile } from '../storage/content-records'
import { replaceProductCatalog, setPageProduct } from '../storage/products'
import { scrubPrivate } from './prompt'
import { estimateHelpFill } from './service'

/**
 * `helpfill:*` through the real handlers on the seeded TextBolt project (two tracked
 * prompts on page-1). Claude is the scripted stand-in: Describe's `prompts.more`
 * call is answered from src/main/assist/fixtures/prompts.more.json.
 */

const SCOPE = { pageId: SEED.pageId }
const ANTHROPIC_KEY = 'sk-ant-api03-PRIVATEprivatePRIVATE0123456789'
const HEX_KEY = 'a'.repeat(32) + '0123456789abcdef0123456789abcdef'

let seed: AssistSeed

beforeEach(async () => {
  seed = await seedAssistProject()
})

afterEach(() => {
  seed.close()
})

describe('helpfill:estimate', () => {
  test('a Claude connection: available, with its cost line', async () => {
    const estimate = await seed.handlers['helpfill:estimate']({
      kind: 'questions',
      projectId: SEED.projectId
    })
    expect(estimate).toEqual({
      kind: 'questions',
      available: true,
      calls: 1,
      costText: '1 AI call · on your AI plan',
      reason: null
    })
  })

  test('an Anthropic API key: the dollar estimate; no key: not available, and why', () => {
    const api = { ...seed.host, claude: { ...seed.claude, id: 'anthropic-api' as const } }
    expect(estimateHelpFill(api, { kind: 'questions', projectId: SEED.projectId }).costText).toBe(
      '1 AI call · about $0.01'
    )
    const keyless = {
      ...seed.host,
      claude: undefined,
      settings: () => ({ ...seed.host.settings(), claudeProvider: 'anthropic-api' as const })
    }
    expect(estimateHelpFill(keyless, { kind: 'questions', projectId: SEED.projectId })).toEqual({
      kind: 'questions',
      available: false,
      calls: 1,
      costText: '1 AI call',
      reason: 'Needs CiteFox AI connected.'
    })
  })
})

describe('helpfill:prompt', () => {
  test('holds the context, the reply header, the brand rule and the tracked questions', async () => {
    const result = await seed.handlers['helpfill:prompt']({
      kind: 'questions',
      projectId: SEED.projectId,
      scope: SCOPE,
      count: null
    })
    expect(result.columns).toEqual(['question', 'stage', 'page'])
    expect(result.tracked).toBe(2)
    const prompt = result.prompt
    expect(prompt.split('\n')[0]).toBe(
      'You help a company find the questions its buyers type into Google.'
    )
    expect(prompt).toContain('Business: textbolt.com.')
    // Context lines with no value stay out of the outside prompt.
    expect(prompt).not.toMatch(/: (?:not (?:set|given|known)|none (?:given|saved|noted))\b/u)
    expect(prompt).toContain('Buyer: Office managers at US businesses with 10 to 250 staff.')
    expect(prompt).toContain('Market: United States (English)')
    expect(prompt).toContain("Already tracked, don't repeat: 2 questions, listed below.")
    expect(prompt).toContain('Write 15 new questions a buyer would really type')
    expect(prompt).toContain('Never name TextBolt. Mix the stages.')
    expect(prompt).toContain('Reply with CSV only, this header:\nquestion,stage,page')
    expect(prompt).toContain('stage = Problem | Options | Doubts | Fit | Compare | Decide')
    // The first wording of each tracked prompt is listed.
    expect(prompt).toContain(`- ${SEED.ukPrompt}`)
    expect(prompt).toContain(`- ${SEED.prompts[1]}`)
    // Lines that only say a value is missing are left out.
    expect(prompt).not.toMatch(/not given|not set|not known|none given|none saved|none noted/u)
  })

  test('never carries a key, an email address or a file path', async () => {
    replaceProductCatalog(seed.projectDb, {
      products: [
        {
          id: 'prod-1',
          name: 'Email to SMS',
          job: 'text alerts from email, docs in /Users/jane/Desktop/notes.txt',
          buyer: 'office managers, write to owner@textbolt.com'
        }
      ],
      competitors: [
        {
          name: 'Rival',
          domain: 'rival.io',
          productId: null,
          tier: 'direct',
          startingPrice: null,
          sources: []
        }
      ]
    })
    setPageProduct(seed.projectDb, SEED.pageId, 'prod-1', true)
    insertBuyerProfile(seed.projectDb, privateProfile())
    const { prompt } = await seed.handlers['helpfill:prompt']({
      kind: 'questions',
      projectId: SEED.projectId,
      scope: SCOPE,
      count: 10
    })
    expect(prompt).toContain('Write 10 new questions')
    expect(prompt).toContain('Product: Email to SMS.')
    expect(prompt).toContain('Rival (rival.io)')
    for (const secret of [
      'owner@textbolt.com',
      'support@textbolt.com',
      '/Users/jane',
      'C:\\Users',
      '~/Library',
      'file://',
      SERP_SECRET,
      HEX_KEY
    ]) {
      expect(prompt).not.toContain(secret)
    }
    // Storage refuses an Anthropic key in a profile; the scrub would take it out anyway.
    expect(scrubPrivate(`Buyer: ops. Key ${ANTHROPIC_KEY}, mail a@b.co`)).toBe(
      'Buyer: ops. Key, mail'
    )
    expect(prompt).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/iu)
    // Site paths are not file paths.
    expect(scrubPrivate('Page: https://textbolt.com/pricing/ and /email-to-sms/')).toBe(
      'Page: https://textbolt.com/pricing/ and /email-to-sms/'
    )
  })
})

describe('helpfill:read', () => {
  test('reads a pasted answer: tracked near-duplicates merged, the brand set aside', async () => {
    const result = await seed.handlers['helpfill:read']({
      kind: 'questions',
      projectId: SEED.projectId,
      scope: SCOPE,
      text: `Sure! Here you go:

\`\`\`
question,stage,page
"How can I send text alerts to my employees, without hiring a developer or learning a new app?",Problem,
Our freezer alarm only emails the office. How do we get it as a text?,Problem,/email-to-text/
Is TextBolt cheaper than hiring a freelancer?,Compare,
Do volunteers need an app to get texts from Outlook?,Fit,
\`\`\`
Want more?`
    })
    expect(result.counts).toEqual({ read: 4, tracked: 1, repeats: 0, setAside: 1, ready: 2 })
    expect(result.rows.map((row) => row.values.question)).toEqual([
      'Our freezer alarm only emails the office. How do we get it as a text?',
      'Do volunteers need an app to get texts from Outlook?'
    ])
    expect(result.rows[0]?.values).toMatchObject({ stage: 'problem', page: '/email-to-text/' })
    expect(result.brand).toBe('TextBolt')
    expect(result.warnings).toEqual([])
  })
})

describe('helpfill:describe', () => {
  test('runs prompts.more with the sentence as its instruction and returns rows', async () => {
    const sentence = 'IT teams whose carrier email-to-text gateway stopped working'
    const result = await seed.handlers['helpfill:describe']({
      kind: 'questions',
      projectId: SEED.projectId,
      scope: SCOPE,
      sentence,
      count: 5
    })
    const request = seed.claude.requests.at(-1)
    expect(request?.prompt.startsWith('Assist: prompts.more')).toBe(true)
    expect(request?.prompt).toContain(sentence)
    expect(request?.prompt).toContain('Prompts wanted: 5')
    expect(result.counts).toMatchObject({ read: 5, ready: 5, tracked: 0, setAside: 0 })
    expect(result.rows.map((row) => row.values.stage)).toEqual([
      'decide',
      'options',
      'doubts',
      'compare',
      'problem'
    ])
    expect(result.rows[0]?.values.question).toMatch(/^Our alarm panel at the warehouse/u)
  })

  test('a count over the most is clamped, and a blank sentence runs the assist as shipped', async () => {
    await seed.handlers['helpfill:describe']({
      kind: 'questions',
      projectId: SEED.projectId,
      scope: SCOPE,
      sentence: '  ',
      count: 99
    })
    expect(seed.claude.requests.at(-1)?.prompt).toContain('Prompts wanted: 12')
  })
})

describe('bad requests', () => {
  test('are refused with the channel name only', async () => {
    const h = seed.handlers
    await expect(
      h['helpfill:estimate']({ kind: 'nope', projectId: SEED.projectId })
    ).rejects.toThrow('helpfill:estimate: That helper is not available.')
    await expect(
      h['helpfill:estimate']({ kind: 'questions', projectId: SEED.projectId, extra: 1 } as never)
    ).rejects.toThrow('helpfill:estimate: Invalid request')
    await expect(
      h['helpfill:prompt']({
        kind: 'questions',
        projectId: SEED.projectId,
        scope: { pageId: null },
        count: null
      })
    ).rejects.toThrow('Pick a page or topic first.')
    await expect(
      h['helpfill:read']({
        kind: 'questions',
        projectId: SEED.projectId,
        scope: SCOPE,
        text: 'x'.repeat(200_001)
      })
    ).rejects.toThrow('helpfill:read: Invalid request')
    await expect(
      h['helpfill:read']({
        kind: 'questions',
        projectId: SEED.projectId,
        scope: { pageId: 'page-nope' },
        text: 'a'
      })
    ).rejects.toThrow('That page or topic was not found.')
    await expect(
      h['helpfill:describe']({
        kind: 'questions',
        projectId: 'proj-nope',
        scope: SCOPE,
        sentence: 'x',
        count: 5
      })
    ).rejects.toThrow('That project was not found')
    await expect(
      h['helpfill:describe']({
        kind: 'questions',
        projectId: SEED.projectId,
        scope: SCOPE,
        sentence: 'x',
        count: 'many'
      } as never)
    ).rejects.toThrow('helpfill:describe: Invalid request')
  })
})

function privateProfile(): BuyerProfile {
  return {
    id: 'icp-private',
    pageId: SEED.pageId,
    snapshotId: 'snap-1',
    who: 'Office managers. Email support@textbolt.com or read C:\\Users\\owner\\notes.docx.',
    environment: `They live in Outlook. Token ${SERP_SECRET} and ~/Library/Application Support/CiteFox/x.db.`,
    segments: [],
    triggers: [`A gateway stopped (ref ${HEX_KEY}, file:///Users/owner/report.pdf).`],
    values: [],
    poorFit: [],
    templateId: 'tpl-buyer-profile',
    templateName: 'Buyer profile',
    templateHash: contentHash('template'),
    templateUpdatedAt: null,
    createdAt: NOW,
    promptsStale: false
  }
}
