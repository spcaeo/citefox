import { TOPIC_STAGE_LABEL, TOPIC_STAGES } from '@shared/domain'
import { indexed, SimilarIndex } from '../../import/similar'
import { NO_REPEAT_RULE } from '../../prompts/blocks'
import type { HelpFillKindDef, HelpFillValues } from '../types'
import { cleanQuestion } from './questions'

/**
 * New topic → "A buyer problem" (HelpFill.dc.html panel 7): one new topic from
 * the user's own chatbot. The reply is one CSV whose columns are IMPORT_FIELDS
 * `questions` ids: each question with its stage, the page that should be cited
 * for it, and the topic's name repeated on every row. The dialog puts the rows
 * into its own draft (name, questions with stage, target pages) and saves the
 * topic only on "Create topic". The topic does not exist yet, so the scope is the
 * project and every tracked question is listed so none is repeated.
 *
 * Describe stays the dialog's own buyer-problem box (`topics:generateQuestions`
 * on its draft, one call per stage), so this kind has no `describe`.
 */

/** Page paths listed as allowed targets; more are left out of the prompt. */
const PROMPT_PATHS = 12

export const TOPIC_KIND: HelpFillKindDef = {
  kind: 'topic',
  noun: ['question', 'questions'],
  scope: 'project',
  sections: [
    {
      id: 'main',
      title: null,
      columns: ['question', 'stage', 'page', 'topic'],
      entity: 'questions'
    }
  ],
  neutral: true,
  defaultCount: 10,
  maxCount: 12,
  chatbotCount: 12,
  // Not shown: there is no `describe` (the dialog's own box writes the questions).
  describeCost: { calls: 1, usd: 0.01 },
  role: () =>
    'You help a company plan one topic: the questions buyers with one problem type into Google, and the page that should be cited for each.',
  task(context, count) {
    const brands = context.brands.length > 0 ? context.brands.join(' or ') : 'the company'
    const paths = context.pagePaths.slice(0, PROMPT_PATHS)
    const more = context.pagePaths.length > paths.length ? ' | …' : ''
    return [
      'Pick one buyer problem (use the buyer problem above when there is one) and give the topic a short name, 2 to 6 words.',
      `Write ${count} questions a buyer with that problem would really type: a situation plus a need, in full sentences.`,
      `Never name ${brands}. Cover the stages from first noticing the problem to deciding.`,
      NO_REPEAT_RULE,
      `stage = ${TOPIC_STAGES.map((stage) => TOPIC_STAGE_LABEL[stage]).join(' | ')}`,
      paths.length > 0
        ? `page = the page that should be cited: ${paths.join(' | ')}${more}, or a new path for a page worth writing`
        : 'page = a path for the page that should be cited, such as /guides/…',
      'topic = the topic name, the same on every row'
    ]
  },
  tracked: (context) => ({
    listed: distinctQuestions(context.projectQuestions),
    merge: { main: context.projectQuestions }
  }),
  clean: cleanTopicRow
}

/** The question tidied like Add questions (stage id, label taken off), plus the topic name. */
export function cleanTopicRow(values: HelpFillValues): HelpFillValues | null {
  const question = cleanQuestion(values)
  if (question === null) return null
  return { ...question, topic: (values.topic ?? '').trim().slice(0, 120) }
}

/** Fewer words than this is a prompt's short label ("Crew alerts"), not a question. */
const QUESTION_WORDS = 4

/**
 * The project's questions once each for the prompt: labels left out, and a market's
 * near-copy of a wording already listed (the importer's normaliser) not listed again.
 */
export function distinctQuestions(texts: readonly string[]): string[] {
  const seen = new SimilarIndex<string>()
  const out: string[] = []
  for (const text of texts) {
    if (text.trim().split(/\s+/u).length < QUESTION_WORDS) continue
    const probe = indexed(text, text)
    if (seen.exact(probe) !== null || seen.merged(probe) !== null) continue
    seen.add(probe)
    out.push(text)
  }
  return out
}
