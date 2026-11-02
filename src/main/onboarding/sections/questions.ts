import { TOPIC_STAGE_LABEL, TOPIC_STAGES } from '@shared/domain'
import {
  DEFAULT_PROMPT_MIX,
  guessPromptShape,
  isPromptShape,
  PROMPT_SHAPES,
  type PromptMix
} from '@shared/ipc'
import { cleanQuestion } from '../../helpfill/kinds/questions'
import { NO_REPEAT_RULE } from '../../prompts/blocks'
import { sitePathOrNull } from '../../engine/site-grounding'
import { PAGE_RULE, SHAPE_RULES, withoutMadeUpSizes } from './examples'
import { brandWords, clip, pathOrNull } from './rows'
import type { ListSectionDef, TextSectionDef } from './types'

/**
 * Step 9: the first topic and its prompts, written to step 8's mix of shapes. The wording comes from the `topic` and
 * `questions` help-fill kinds (`helpfill/kinds/topic.ts`, `questions.ts`): neutral
 * questions that never name the brand, each with its stage and the page that should
 * answer it.
 */

/** The topic's reply: its name, then the site path it comes from (checked in code). */
export const TOPIC_REPLY_LEAD = 'Reply with two lines only:'

const ROLE =
  'You help a company plan one topic: the prompts buyers with one problem type into Google and AI assistants, and the page that should be cited for each.'

const SHAPE_WORDS: Readonly<Record<keyof PromptMix, [string, string]>> = {
  search: ['short search', 'short searches'],
  question: ['question', 'questions'],
  situation: ['situation', 'situations']
}

/** "4 short searches, 4 questions and 4 situations". */
export function mixWords(mix: PromptMix): string {
  const parts = PROMPT_SHAPES.filter((shape) => mix[shape] > 0).map(
    (shape) => `${mix[shape]} ${SHAPE_WORDS[shape][mix[shape] === 1 ? 0 : 1]}`
  )
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

export const TOPIC_SECTION: TextSectionDef = {
  kind: 'text',
  id: 'topic',
  noun: ['topic', 'topics'],
  context: ['website', 'market', 'summary', 'products', 'buyers', 'triggers'],
  site: ['quotes', 'compared', 'paths'],
  webSearch: false,
  usd: 0.01,
  maxChars: 120,
  replyLead: `${TOPIC_REPLY_LEAD} the topic name, then the path on the site it comes from. No heading, no quote marks.`,
  role: () => ROLE,
  task: (context) => [
    'Pick the one buyer problem worth tracking first and give the topic a short name, 2 to 6 words, as a buyer would say it.',
    'Take it from the business’s main offer: its first product above or the biggest item in its menu. A page that helps buyers switch from another company’s named product is a strong first topic (never a move between the business’s own editions or plans). Never a side niche, and never a buyer group or tool the pages do not name.',
    `Never name ${brandWords(context)}.`
  ]
}

export const QUESTIONS_SECTION: ListSectionDef = {
  kind: 'list',
  id: 'questions',
  noun: ['question', 'questions'],
  context: [
    'website',
    'market',
    'summary',
    'products',
    'buyers',
    'triggers',
    'competitors',
    'topic'
  ],
  site: ['paths'],
  webSearch: false,
  usd: 0.01,
  columns: ['question', 'stage', 'shape', 'page'],
  entity: 'questions',
  count: 12,
  maxRows: 60,
  neutral: true,
  role: () => ROLE,
  task: (context) => {
    const mix = context.mix ?? DEFAULT_PROMPT_MIX
    return [
      `Write ${mixWords(mix)} that a buyer with this topic's problem would really type, from the buyers and trigger events above.`,
      ...SHAPE_RULES,
      `Never name ${brandWords(context)}. Cover the stages from first noticing the problem to deciding.`,
      'Spread them over the different angles of the topic (the trigger events, buyers, products and competitors above) and over at least 3 different pages from the site paths above when they fit, such as the product page, pricing, a comparison or switch page, an integration or use-case page: no more than 4 on one page.',
      NO_REPEAT_RULE,
      `stage = ${TOPIC_STAGES.map((stage) => TOPIC_STAGE_LABEL[stage]).join(' | ')}`,
      `shape = ${PROMPT_SHAPES.join(' | ')}`,
      PAGE_RULE(context.domain)
    ]
  },
  toRow(values, _context, ground) {
    const question = cleanQuestion({
      question: values.question ?? '',
      stage: values.stage ?? '',
      page: values.page ?? ''
    })
    if (question === null) return null
    const text = clip(withoutMadeUpSizes(question.question ?? '', ground), 500)
    if (text.length < 3) return null
    const stage = question.stage ?? ''
    const said = (values.shape ?? '').trim().toLowerCase()
    return {
      name: text,
      detail: isPromptShape(said) ? said : guessPromptShape(text),
      url: sitePathOrNull(ground.check, pathOrNull(question.page ?? '')),
      tag: stage.length > 0 ? stage : null
    }
  },
  keys: (row) => [row.name],
  line: (row) => row.name
}
