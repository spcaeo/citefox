import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  SEED,
  SERP_SECRET,
  seedAssistProject,
  type AssistSeed
} from '../../assist/assist.test-helper'
import { getAlertSettings, saveAlertSettings } from '../../storage/alert-settings'
import { replaceProductCatalog } from '../../storage/products'
import { readProjectProfile, updateProjectProfile } from '../../storage/project-profile'

/**
 * The text kinds (fix, pitch, reportSummary) and the Describe-only alert rule,
 * through the real `helpfill:*` handlers on the seeded TextBolt project. Claude is
 * the scripted stand-in: each assist is answered from its fixture.
 */

let seed: AssistSeed

beforeEach(async () => {
  seed = await seedAssistProject()
})

afterEach(() => {
  seed.close()
})

const FIX_SCOPE = { pageId: SEED.pageId, promptId: 'prompt-1' }

describe('fix', () => {
  test('the prompt carries the question, what Google cited and the section, and no reply header', async () => {
    const result = await seed.handlers['helpfill:prompt']({
      kind: 'fix',
      projectId: SEED.projectId,
      scope: FIX_SCOPE,
      count: null
    })
    expect(result.columns).toEqual([])
    expect(result.tracked).toBe(0)
    const prompt = result.prompt
    expect(prompt.split('\n')[0]).toBe(
      "You help a company rewrite one section of its own web page so Google's AI Overview can quote it."
    )
    expect(prompt).toContain('Company: TextBolt (textbolt.com).')
    expect(prompt).toContain(`Question a buyer types into Google: "${SEED.ukPrompt}"`)
    expect(prompt).toMatch(
      /Google's AI Overview for it \(check of [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M\) says:\n"""/u
    )
    expect(prompt).toContain('It cites these pages:\n- simpletexting.com')
    expect(prompt).toContain('My page /blog/how-to-set-up-text-alerts-for-business/ says now')
    expect(prompt).toContain('Rewrite my section so it answers the question first')
    expect(prompt).toContain('Reply with the section only, no notes.')
    // A text kind has no CSV header, no tracked list and no context blocks.
    expect(prompt).not.toContain('Reply with CSV')
    expect(prompt).not.toContain('Already tracked')
    expect(prompt).not.toContain('Business: textbolt.com.')
    expect(prompt).not.toContain(SERP_SECRET)
    expect(prompt).not.toMatch(/\n\n\n/u)
  })

  test('needs a question: a request without one is refused in plain words', async () => {
    await expect(
      seed.handlers['helpfill:prompt']({
        kind: 'fix',
        projectId: SEED.projectId,
        scope: { pageId: SEED.pageId },
        count: null
      })
    ).rejects.toThrow('helpfill:prompt: Pick a question first.')
    await expect(
      seed.handlers['helpfill:prompt']({
        kind: 'fix',
        projectId: SEED.projectId,
        scope: { pageId: SEED.pageId, promptId: 'prompt-9' },
        count: null
      })
    ).rejects.toThrow('That question was not found.')
    await expect(
      seed.handlers['helpfill:prompt']({
        kind: 'fix',
        projectId: SEED.projectId,
        scope: { pageId: SEED.pageId, promptId: 'prompt-1', other: 'x' } as never,
        count: null
      })
    ).rejects.toThrow('helpfill:prompt: Invalid request')
  })

  test('reads a pasted rewrite: the chatbot’s words around it are taken out', async () => {
    const result = await seed.handlers['helpfill:read']({
      kind: 'fix',
      projectId: SEED.projectId,
      scope: FIX_SCOPE,
      text: `Sure! Here's the rewritten section:

**AT&T shut down its email-to-text gateway in June 2025**, so alerts sent to it no longer arrive. TextBolt gives you a replacement address in 2 minutes.

1. Sign up.
2. Point your alerts at the new address.

Let me know if you'd like a shorter version!`
    })
    expect(result.counts).toMatchObject({ read: 1, ready: 1 })
    expect(result.text).toBe(
      '**AT&T shut down its email-to-text gateway in June 2025**, so alerts sent to it no longer arrive. TextBolt gives you a replacement address in 2 minutes.\n\n1. Sign up.\n2. Point your alerts at the new address.'
    )
    expect(result.rows[0]?.values.text).toBe(result.text)
    expect(result.warnings).toEqual([])
  })

  test('Draft it for me runs gaps.draftFix when the question has a coverage row', async () => {
    const result = await seed.handlers['helpfill:describe']({
      kind: 'fix',
      projectId: SEED.projectId,
      scope: FIX_SCOPE,
      sentence: 'Mention the AT&T shutdown',
      count: 1
    })
    const sent = seed.claude.requests.at(-1)?.prompt ?? ''
    expect(sent.startsWith('Assist: gaps.draftFix')).toBe(true)
    expect(sent).toContain('Mention the AT&T shutdown')
    expect(sent).toContain('Write it answer first: 2 sentences with one number')
    expect(result.text).toMatch(/^Carrier email-to-text gateways/u)
    expect(result.text).toContain('\n\nVerizon is shutting down vtext.com.')
  })

  test('without a coverage row it drafts with progress.draftFix, leaving out the log line', async () => {
    seed.projectDb.prepare(`DELETE FROM coverage_rows WHERE prompt_id = 'prompt-2'`).run()
    const result = await seed.handlers['helpfill:describe']({
      kind: 'fix',
      projectId: SEED.projectId,
      scope: { pageId: SEED.pageId, promptId: 'prompt-2' },
      sentence: '',
      count: 1
    })
    const sent = seed.claude.requests.map((request) => request.prompt.split('\n')[0])
    expect(sent.at(-1)).toBe('Assist: progress.draftFix')
    expect(seed.claude.requests.at(-1)?.prompt).toContain(
      `Answer the question "${SEED.prompts[1]}"`
    )
    expect(result.text).toMatch(/^Which plan includes scheduled text alerts\?/u)
    expect(result.text).not.toContain('Add an FAQ that names the plan')
  })
})

describe('pitch', () => {
  async function otherCited(): Promise<{ id: string; pageId: string; promptId: string }> {
    // twilio.com is a competitor in the seed; dropped, it is someone else's site.
    const profile = readProjectProfile(seed.projectDb)
    if (profile === null) throw new Error('no profile')
    updateProjectProfile(seed.projectDb, { ...profile, competitors: ['simpletexting.com'] })
    replaceProductCatalog(seed.projectDb, {
      products: [],
      competitors: [
        {
          name: 'simpletexting.com',
          domain: 'simpletexting.com',
          productId: null,
          tier: 'direct',
          startingPrice: null,
          sources: []
        }
      ]
    })
    seed.projectDb
      .prepare(`UPDATE aio_references SET classification = 'other' WHERE domain LIKE '%twilio.com'`)
      .run()
    const data = await seed.handlers['allpages:citedPages']({ projectId: SEED.projectId })
    const row = data.rows.find((item) => item.whose === 'other' && item.domain === 'twilio.com')
    const question = row?.questions[0]
    if (row === undefined || question === undefined) throw new Error('no other row')
    return { id: row.id, pageId: question.pageId, promptId: question.promptId }
  }

  test('the prompt carries the site, its page, the question, the competitors and our page', async () => {
    const cited = await otherCited()
    const { prompt } = await seed.handlers['helpfill:prompt']({
      kind: 'pitch',
      projectId: SEED.projectId,
      scope: { pageId: cited.pageId, promptId: cited.promptId, subject: cited.id },
      count: null
    })
    expect(prompt).toContain('The site: twilio.com')
    expect(prompt).toContain(
      'Its page that Google\'s AI Overview cites: "Employee SMS" (https://www.twilio.com/en-us/blog/employee-sms-notifications)'
    )
    expect(prompt).toContain(`The question buyers type into Google: "`)
    expect(prompt).toContain(
      'Google cites these competitors next to that page for it: simpletexting.com.'
    )
    expect(prompt).toContain('Google cites us for it too.')
    expect(prompt).toContain(
      'Our matching page: "' // the seeded page's title
    )
    expect(prompt).toContain('Start with "Subject: …"')
    expect(prompt).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/iu)
  })

  test('a cited page that is gone, or one of ours, is refused with the next step', async () => {
    const data = await seed.handlers['allpages:citedPages']({ projectId: SEED.projectId })
    const ours = data.rows.find((item) => item.whose === 'yours')
    await expect(
      seed.handlers['helpfill:prompt']({
        kind: 'pitch',
        projectId: SEED.projectId,
        scope: { pageId: SEED.pageId, promptId: 'prompt-1', subject: ours?.id ?? 'sx' },
        count: null
      })
    ).rejects.toThrow('That cited page is not in the latest checks any more.')
    await expect(
      seed.handlers['helpfill:prompt']({
        kind: 'pitch',
        projectId: SEED.projectId,
        scope: { pageId: SEED.pageId, promptId: 'prompt-1' },
        count: null
      })
    ).rejects.toThrow('Pick what to write about first.')
  })

  test('Describe runs citations.pitch on the same facts', async () => {
    const cited = await otherCited()
    const result = await seed.handlers['helpfill:describe']({
      kind: 'pitch',
      projectId: SEED.projectId,
      scope: { pageId: cited.pageId, promptId: cited.promptId, subject: cited.id },
      sentence: 'Keep it casual',
      count: 1
    })
    const sent = seed.claude.requests.at(-1)?.prompt ?? ''
    expect(sent.startsWith('Assist: citations.pitch')).toBe(true)
    expect(sent).toContain('The site: twilio.com')
    expect(sent).toContain('Keep it casual')
    expect(result.text).toMatch(/^Subject: A tool for your text alerts guide/u)
  })
})

describe('reportSummary', () => {
  test("the prompt carries the report's own numbers and says to use only those", async () => {
    const { prompt } = await seed.handlers['helpfill:prompt']({
      kind: 'reportSummary',
      projectId: SEED.projectId,
      scope: { pageId: null },
      count: null
    })
    expect(prompt).toContain('The report (use only these numbers):')
    expect(prompt).toContain("Google's AI Overviews cite you in 2 of 2 answers")
    expect(prompt).toContain('Visibility score: 67 of 100')
    expect(prompt).toContain('What to do next:\n1. ')
    expect(prompt).toContain('Use only the numbers in the report above.')
    expect(prompt).not.toContain('Built with CiteFox')
  })

  test('a pasted summary loses the sentences with numbers the report does not hold', async () => {
    const result = await seed.handlers['helpfill:read']({
      kind: 'reportSummary',
      projectId: SEED.projectId,
      scope: { pageId: null },
      text: `Here is your summary:

Google now cites us in 2 of 2 AI answers. Our score is 67 out of 100. Traffic grew 40% this month.

Next, we make the setup page the clearest answer.`
    })
    expect(result.text).toBe(
      'Google now cites us in 2 of 2 AI answers. Our score is 67 out of 100.\n\nNext, we make the setup page the clearest answer.'
    )
    expect(result.warnings).toEqual(['Took out 1 sentence with a number not in the report: 40.'])
    expect(result.counts.ready).toBe(1)
  })

  test('has no Describe: in-app Claude has its own buttons there', async () => {
    const estimate = await seed.handlers['helpfill:estimate']({
      kind: 'reportSummary',
      projectId: SEED.projectId
    })
    expect(estimate.available).toBe(false)
  })
})

describe('alertRule', () => {
  test('Describe fills one rule, and Claude only ever sees email refs', async () => {
    saveAlertSettings(seed.projectDb, {
      ...getAlertSettings(seed.projectDb, SEED.projectId),
      emailTo: ['ops@textbolt.com']
    })
    seed.claude.queue.push({
      summary: 'Emails you when a competitor is cited instead of your page.',
      items: [
        { text: 'Competitor beats us', detail: null, tag: 'name', verify: null, sign: null },
        { text: 'competitor_cited', detail: null, tag: 'when', verify: null, sign: null },
        { text: 'twilio.com', detail: null, tag: 'competitor', verify: null, sign: null },
        { text: 'pages', detail: 'P1', tag: 'scope', verify: null, sign: null },
        { text: 'M1', detail: null, tag: 'markets', verify: null, sign: null },
        { text: 'E1, desktop', detail: null, tag: 'send', verify: null, sign: null },
        { text: 'digest', detail: null, tag: 'delivery', verify: null, sign: null }
      ],
      caution: null
    })
    const result = await seed.handlers['helpfill:describe']({
      kind: 'alertRule',
      projectId: SEED.projectId,
      scope: { pageId: null },
      sentence: 'Tell me when a competitor overtakes us on pricing questions',
      count: 1
    })
    const sent = seed.claude.requests.at(-1)?.prompt ?? ''
    expect(sent.startsWith('Assist: alerts.describeRule')).toBe(true)
    expect(sent).toContain('Email addresses already set up: E1')
    expect(sent).not.toContain('ops@textbolt.com')
    expect(result.rows[0]?.values).toEqual({
      name: 'Competitor beats us',
      when: 'competitor_cited',
      score: '',
      competitor: 'twilio.com',
      scope: 'pages',
      scope_ids: SEED.pageId,
      markets: SEED.us,
      desktop: 'yes',
      slack: 'no',
      email: 'ops@textbolt.com',
      delivery: 'digest',
      note: 'Emails you when a competitor is cited instead of your page.'
    })
  })

  test('an invented address or id is sent back to Claude, then refused', async () => {
    const bad = {
      summary: null,
      items: [
        { text: 'X', detail: null, tag: 'name', verify: null, sign: null },
        { text: 'citation_lost', detail: null, tag: 'when', verify: null, sign: null },
        { text: 'new@person.com', detail: null, tag: 'send', verify: null, sign: null }
      ],
      caution: null
    }
    seed.claude.queue.push(bad, bad, bad)
    await expect(
      seed.handlers['helpfill:describe']({
        kind: 'alertRule',
        projectId: SEED.projectId,
        scope: { pageId: null },
        sentence: 'Email new@person.com when we lose a citation',
        count: 1
      })
    ).rejects.toThrow()
    const retry = seed.claude.requests.at(-1)?.prompt ?? ''
    expect(retry).toContain('Send email only to the E refs listed. Never write an address.')
  })
})
