import { readPitchFacts, PitchFactsMissing } from '../../engine/allpages/pitch-facts'
import { scorePass } from '../../engine/checks/glance'
import { AssistInputError, type AssistContext, type AssistDefinition } from '../types'
import { inputText, projectOf } from './gather'

/** Words in a pitch email: short enough to read on a phone. */
export const PITCH_MAX_WORDS = 140

/**
 * Citations → "✦ Draft a pitch" (HelpFill.dc.html panel 7, Citations / outreach): a
 * short email to a site whose page Google's AI Overview cites for one of the user's
 * questions, next to competitors, asking to be added. CiteFox never sends it: the
 * user copies the draft.
 */
export const CITATION_ASSISTS: readonly AssistDefinition[] = [
  {
    id: 'citations.pitch',
    title: 'Draft a pitch',
    expectedSeconds: 8,
    acceptsInstruction: true,
    needsProject: true,
    needs: ['pageId', 'promptId'],
    minItems: 1,
    maxItems: 1,
    task: `Draft a short pitch email to the person who runs the cited page below, asking them to add the user's company to it. CiteFox never sends it; the user copies it.
Give exactly one item: text is the email, with "Subject: …" on the first line, then the email, at most ${PITCH_MAX_WORDS} words, with [Name] for their name and no signature details. detail says in one sentence why their readers would want the company there.
Say why their readers would want the company on that page, using only what "What our page says it offers" states. Be friendly and specific: no flattery, no promises, no prices, and no link other than our matching page.`,
    gather(context) {
      return pitchLines(context).join('\n')
    },
    check(reply) {
      const text = reply.items[0]?.text.trim() ?? ''
      if (!/^subject:/iu.test(text)) return 'Start the email with a "Subject:" line.'
      if (text.split(/\s+/u).length > PITCH_MAX_WORDS + 12) {
        return `Keep the email under ${PITCH_MAX_WORDS} words.`
      }
      return null
    }
  }
]

function pitchLines(context: AssistContext): string[] {
  const opened = projectOf(context)
  const citedId = inputText(context, 'cited', 80)
  const pageId = context.request.pageId
  const promptId = context.request.promptId
  if (citedId === null || pageId === null || promptId === null) {
    throw new AssistInputError('Pick a cited page first.', 'Open Citations and pick the page.')
  }
  const now = context.host.now()
  try {
    return readPitchFacts(
      {
        storage: context.host.storage,
        project: opened.project,
        db: opened.db,
        scorePass: scorePass(context.host.storage, now, systemTimeZone()),
        now
      },
      { citedId, pageId, promptId }
    ).lines
  } catch (error) {
    if (error instanceof PitchFactsMissing)
      throw new AssistInputError(error.message, error.nextStep)
    throw error
  }
}

function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}
