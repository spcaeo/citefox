import { isPromptShape } from '@shared/ipc'
import { NO_REPEAT_RULE } from '../../prompts/blocks'
import { canCheckText, sitePathOrNull, withoutGuessedSizes } from '../../engine/site-grounding'
import { brandWords, clip, pathOrNull } from './rows'
import type { ListSectionDef, SiteGround } from './types'

/**
 * Step 8, "How do your buyers ask AI?" (owner feedback 2026-10-25): one buying moment
 * of this business written in each prompt shape, with what checking it would show.
 * Written in the background as soon as the site read is done, so the step opens ready.
 */

/** What each shape is, in the words both prompts (examples, questions) use. */
export const SHAPE_RULES = [
  'search = a short search as typed into Google, 2 to 6 words, no question mark (such as "invoicing software for accountants")',
  'question = one plain question, 6 to 16 words (such as "how do I send invoice reminders automatically?")',
  'situation = the buyer’s situation and need told in 2 or 3 sentences, the way people ask ChatGPT (such as "Our invoicing tool is being shut down and we bill clients every week. We are an accounting firm. What should we move to?")',
  'Never make up a team size, headcount, number of countries, budget or other number: no "a 40-person startup" or "a team of 800". Use a number only when the pages above show it.'
] as const

/**
 * A prompt without the sizes Claude made up (round 2: "a 150-person engineering team",
 * "a team of 800"): size words the site does not back come out (checks off: as given).
 */
export function withoutMadeUpSizes(text: string, ground: SiteGround): string {
  return canCheckText(ground.check) ? withoutGuessedSizes(text, ground.check) : text
}

/** The page rule both prompts share: a real path from the digest, or blank (checked in code). */
export const PAGE_RULE = (domain: string): string =>
  `page = the path on ${domain} from the site paths above that should be cited for it, or blank when none fits; never make up a path`

export const EXAMPLES_SECTION: ListSectionDef = {
  kind: 'list',
  id: 'examples',
  noun: ['example', 'examples'],
  context: ['website', 'market', 'summary', 'products', 'buyers', 'triggers', 'competitors'],
  site: ['paths'],
  webSearch: false,
  usd: 0.01,
  columns: ['shape', 'prompt', 'outcome', 'page'],
  entity: null,
  count: 3,
  maxRows: 6,
  neutral: true,
  role: () =>
    'You show a business how its buyers ask AI assistants about the problem it solves, and what tracking those prompts would show it.',
  task: (context) => [
    'Pick the buying moment that matters most to this business (from the buyers and trigger events above) and write it three ways, one row per shape: search, question, situation.',
    ...SHAPE_RULES,
    `Never name ${brandWords(context)} in a prompt.`,
    'outcome = one sentence for the business owner, starting with "See whether", saying what checking this prompt shows them; name their own page or a competitor from above when it fits (such as "See whether Google’s AI quotes your pricing page or a rival’s guide").',
    PAGE_RULE(context.domain),
    NO_REPEAT_RULE
  ],
  toRow(values, _context, ground) {
    const shape = (values.shape ?? '').trim().toLowerCase()
    if (!isPromptShape(shape)) return null
    const prompt = clip(withoutMadeUpSizes((values.prompt ?? '').trim(), ground), 500)
    if (prompt.length < 3) return null
    return {
      name: prompt,
      detail: clip((values.outcome ?? '').trim(), 300),
      url: sitePathOrNull(ground.check, pathOrNull(values.page ?? '')),
      tag: shape
    }
  },
  keys: (row) => [row.name],
  line: (row) => `${row.tag ?? 'prompt'}: ${row.name}`
}
