import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  SEED,
  SERP_SECRET,
  seedAssistProject,
  type AssistSeed
} from '../../assist/assist.test-helper'
import { contentHash } from '../../pipeline/hash'
import { insertBuyerProfile } from '../../storage/content-records'
import { cleanBuyer } from './buyers'

/**
 * Buyer profile → ✦ Help me fill this (`kind: 'buyers'`) through the real handlers on
 * the seeded TextBolt page. Its saved profile has one segment ("Field service"), one
 * trigger and one value. Claude is the scripted stand-in: Describe's `audience.sharpen`
 * and `audience.triggers` calls are answered from their recorded fixtures.
 */

const SCOPE = { pageId: SEED.pageId }

let seed: AssistSeed

beforeEach(async () => {
  seed = await seedAssistProject()
})

afterEach(() => {
  seed.close()
})

describe('buyers prompt', () => {
  test('holds the page context, the saved segments, triggers and values, and the header', async () => {
    const result = await seed.handlers['helpfill:prompt']({
      kind: 'buyers',
      projectId: SEED.projectId,
      scope: SCOPE,
      count: null
    })
    const prompt = result.prompt
    expect(result.columns).toEqual(['who', 'problem', 'trigger', 'need'])
    expect(result.tracked).toBe(1)
    expect(prompt.split('\n')[0]).toBe(
      'You help a company describe the buyers who search for what one page offers.'
    )
    expect(prompt).toContain('Business: textbolt.com.')
    expect(prompt).toContain('Market: United States (English)')
    expect(prompt).toContain("Already tracked, don't repeat: 1 buyer type, listed below.")
    expect(prompt).toContain('List 8 buyer types who would search for this page')
    expect(prompt).toContain(
      "Trigger events already saved, don't repeat: A carrier email-to-text gateway stopped working."
    )
    expect(prompt).toContain("Needs already saved, don't repeat: Setup in about 30 minutes.")
    expect(prompt).toContain('Reply with CSV only, this header:\nwho,problem,trigger,need')
    expect(prompt).toContain('- Field service: Crews are away from desks.')
  })

  test('leaves out the saved lines when the profile has none, and never carries a secret', async () => {
    insertBuyerProfile(seed.projectDb, {
      id: 'icp-2',
      pageId: SEED.pageId,
      snapshotId: 'snap-1',
      who: 'Office managers. Write to owner@textbolt.com.',
      environment: `Token ${SERP_SECRET}, notes in /Users/jane/Desktop/icp.txt.`,
      segments: [],
      triggers: [],
      values: [],
      poorFit: [],
      templateId: 'tpl-buyer-profile',
      templateName: 'Buyer profile',
      templateHash: contentHash('template'),
      templateUpdatedAt: null,
      createdAt: '2026-10-21T12:00:00.000Z',
      promptsStale: false
    })
    const { prompt, tracked } = await seed.handlers['helpfill:prompt']({
      kind: 'buyers',
      projectId: SEED.projectId,
      scope: SCOPE,
      count: 5
    })
    expect(tracked).toBe(0)
    expect(prompt).toContain('Already tracked: no buyer types yet.')
    expect(prompt).not.toContain('already saved')
    for (const secret of ['owner@textbolt.com', '/Users/jane', SERP_SECRET]) {
      expect(prompt).not.toContain(secret)
    }
  })

  test('needs a page', async () => {
    await expect(
      seed.handlers['helpfill:prompt']({
        kind: 'buyers',
        projectId: SEED.projectId,
        scope: { pageId: null },
        count: null
      })
    ).rejects.toThrow('Pick a page or topic first.')
  })
})

describe('buyers read', () => {
  test('reads a ChatGPT answer: the saved segment merged, a repeat merged, chatter ignored', async () => {
    const result = await seed.handlers['helpfill:read']({
      kind: 'buyers',
      projectId: SEED.projectId,
      scope: SCOPE,
      text: `Here are buyer types for this page:

| Who | Problem | Trigger | Need |
| --- | --- | --- | --- |
| **Field service** | Crews miss emails | A job email sat unread | Texts on site |
| Clinic office managers | Staff miss shift changes | A nurse missed a shift | Texts from Outlook |
| IT leads at 50-person firms | Monitoring only emails | Verizon shut vtext.com | A new alert address |
| Clinic office managers. | Same | Same | Same |

Let me know if you want more!`
    })
    expect(result.counts).toEqual({ read: 4, tracked: 1, repeats: 1, setAside: 0, ready: 2 })
    expect(result.noun).toEqual(['buyer type', 'buyer types'])
    expect(result.rows.map((row) => row.values)).toEqual([
      {
        who: 'Clinic office managers',
        problem: 'Staff miss shift changes',
        trigger: 'A nurse missed a shift',
        need: 'Texts from Outlook'
      },
      {
        who: 'IT leads at 50-person firms',
        problem: 'Monitoring only emails',
        trigger: 'Verizon shut vtext.com',
        need: 'A new alert address'
      }
    ])
  })
})

describe('buyers describe', () => {
  test('runs audience.sharpen and audience.triggers with the sentence; keeps only new points', async () => {
    const sentence = 'Our best customers are clinics and HVAC firms that text crews from Outlook'
    const result = await seed.handlers['helpfill:describe']({
      kind: 'buyers',
      projectId: SEED.projectId,
      scope: SCOPE,
      sentence,
      count: 5
    })
    const prompts = seed.claude.requests.map((request) => request.prompt)
    const sharpen = prompts.find((prompt) => prompt.startsWith('Assist: audience.sharpen'))
    const triggers = prompts.find((prompt) => prompt.startsWith('Assist: audience.triggers'))
    expect(sharpen).toContain(sentence)
    expect(triggers).toContain(sentence)
    // The sharpen fixture has no segments: one row under who the profile says the buyer is.
    expect(result.rows).toHaveLength(1)
    const row = result.rows[0]?.values
    expect(row?.who).toBe(
      'Operations and office managers, IT leads, and owner-operators at US and Canadian businesses with 10 to 250 staff'
    )
    const triggerLines = row?.trigger?.split('\n') ?? []
    expect(triggerLines).toContain(
      'A monitoring tool such as Datadog or Grafana only sends email alerts'
    )
    expect(triggerLines).not.toContain('A carrier email-to-text gateway stopped working.')
    expect(row?.need?.split('\n')).toContain('Nothing new for staff to install')
  })

  test('new segments from Sharpen each get a share of the new triggers and values', async () => {
    seed.claude.queue.push({
      summary: 'Sharper.',
      items: [
        {
          text: 'Field service: crews are away\nClinics: staff shifts change daily\nIT teams: monitoring only emails',
          detail: 'From the page.',
          tag: 'segments',
          verify: null,
          sign: null
        },
        {
          text: 'A shift changed overnight\nAn alert sat unread\nVerizon shut vtext.com',
          detail: 'From the page.',
          tag: 'triggers',
          verify: null,
          sign: null
        }
      ],
      caution: null
    })
    const result = await seed.handlers['helpfill:describe']({
      kind: 'buyers',
      projectId: SEED.projectId,
      scope: SCOPE,
      sentence: 'Clinics and IT teams',
      count: 5
    })
    // "Field service" is saved, so it is left out before the merge.
    expect(result.rows.map((row) => [row.values.who, row.values.problem])).toEqual([
      ['Clinics', 'staff shifts change daily'],
      ['IT teams', 'monitoring only emails']
    ])
    // Find more trigger events (its fixture) first, then Sharpen's, shared out in turn.
    const shares = result.rows.map((row) => (row.values.trigger ?? '').split('\n'))
    expect(shares.map((share) => share.length)).toEqual([3, 3])
    expect(shares.flat()).toEqual([
      'Verizon announces it is shutting down its vtext.com email-to-text gateway.',
      'A staff member replies to an alert and nobody knows where the reply went.',
      'An alert sat unread',
      'An urgent alert email sits unread while the crew is on site.',
      'A shift changed overnight',
      'Verizon shut vtext.com'
    ])
  })
})

describe('cleanBuyer', () => {
  test('trims every cell and drops a row without a buyer type', () => {
    expect(cleanBuyer({ who: ' Clinics. ', problem: ' a ', trigger: 'b', need: '' })).toEqual({
      who: 'Clinics',
      problem: 'a',
      trigger: 'b',
      need: ''
    })
    expect(cleanBuyer({ who: '', trigger: 'b' })).toBeNull()
    expect(cleanBuyer({ who: 'x'.repeat(300) })?.who).toHaveLength(160)
  })
})
