import { ensureShippedAssists } from '../../assist/definitions'
import { runAssist } from '../../assist/run'
import { PitchFactsMissing, readPitchFacts } from '../../engine/allpages/pitch-facts'
import { withAllPages } from '../../engine/allpages/pass'
import type { EngineHost } from '../../engine/host'
import { HelpFillEvidenceMissing, type HelpFillContext, type HelpFillKindDef } from '../types'

/**
 * Citations → "✦ Draft a pitch" (HelpFill.dc.html panel 7, Citations / outreach): a
 * short email to a site whose page Google's AI Overview cites for one of the user's
 * questions, next to competitors. The scope is the user's page or topic and the
 * question; `subject` is the cited page's row id from `allpages:citedPages`. The
 * prompt carries the site, its cited page, the question, the competitors cited
 * there and the user's matching page. Describe runs the `citations.pitch` assist
 * on the same facts. CiteFox never sends anything: the user copies the email.
 */
export const PITCH_KIND: HelpFillKindDef = {
  kind: 'pitch',
  noun: ['pitch', 'pitches'],
  scope: 'page',
  needs: ['promptId', 'subject'],
  contextBlocks: false,
  text: { evidence: pitchEvidence, maxChars: 4000 },
  sections: [{ id: 'main', title: null, columns: ['text'], entity: null }],
  neutral: false,
  defaultCount: 1,
  maxCount: 1,
  chatbotCount: 1,
  describeCost: { calls: 1, usd: 0.01 },
  role: () => 'You help a company ask a website to add it to a page that compares tools.',
  task: () => [
    'Write a short pitch email to the person who runs that page, asking them to add us to it.',
    'Say in 2 or 3 sentences why their readers would want us there, using only what our page says it offers.',
    'Be friendly and specific: no flattery, no promises, no prices, and no link other than our matching page.',
    'Start with "Subject: …", then the email, under 140 words, with [Name] for their name and no signature details.',
    'Reply with the email only, no notes.'
  ],
  tracked: () => ({ listed: [], merge: {} }),
  async describe(host, context, input) {
    ensureShippedAssists()
    if (context.target === null || context.promptId === null || context.subject === null) return []
    const result = await runAssist(host, {
      assistId: 'citations.pitch',
      projectId: context.projectId,
      pageId: context.target.id,
      marketId: null,
      promptId: context.promptId,
      inputs: { cited: context.subject },
      instruction: input.sentence.trim() || null
    })
    const text = result.items[0]?.text.trim() ?? ''
    return text.length === 0 ? [] : [{ section: null, values: { text } }]
  }
}

async function pitchEvidence(host: EngineHost, context: HelpFillContext): Promise<string[]> {
  const target = context.target
  if (target === null || context.promptId === null || context.subject === null) return []
  const promptId = context.promptId
  const citedId = context.subject
  return withAllPages(host, context.projectId, 'helpfill:prompt', (pass) => {
    try {
      return readPitchFacts(pass, { citedId, pageId: target.id, promptId }).lines
    } catch (error) {
      if (error instanceof PitchFactsMissing) {
        throw new HelpFillEvidenceMissing(error.message, error.nextStep)
      }
      throw error
    }
  })
}
