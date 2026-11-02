import { TOPIC_STAGE_LABEL, TOPIC_STAGES } from '@shared/domain'
import { BUILT_IN_STAGE_WORDS, foldWord, translateStage } from '@shared/import-fields'
import { ensureShippedAssists } from '../../assist/definitions'
import { runAssist } from '../../assist/run'
import { NO_REPEAT_RULE } from '../../prompts/blocks'
import type { HelpFillKindDef, HelpFillValues } from '../types'

/**
 * Add questions → ✦ Help me write: buyer questions for one page or topic, with
 * their stage and the page to be cited. The reply columns are IMPORT_FIELDS ids,
 * so a pasted answer and the questions CSV template read the same way. Describe
 * runs the existing `prompts.more` assist with the user's sentence as its
 * instruction (its prompt is not copied here).
 */

/** Page paths listed as allowed values; more are left out of the prompt. */
const PROMPT_PATHS = 12

export const QUESTIONS_KIND: HelpFillKindDef = {
  kind: 'questions',
  noun: ['question', 'questions'],
  scope: 'page',
  sections: [
    { id: 'main', title: null, columns: ['question', 'stage', 'page'], entity: 'questions' }
  ],
  neutral: true,
  defaultCount: 10,
  // The most `prompts.more` writes in one call.
  maxCount: 12,
  chatbotCount: 15,
  describeCost: { calls: 1, usd: 0.01 },
  role: () => 'You help a company find the questions its buyers type into Google.',
  task(context, count) {
    const brands = context.brands.length > 0 ? context.brands.join(' or ') : 'the company'
    const paths = context.pagePaths.slice(0, PROMPT_PATHS)
    return [
      `Write ${count} new questions a buyer would really type: a situation plus a need, in full sentences.`,
      `Never name ${brands}. Mix the stages.`,
      NO_REPEAT_RULE,
      `stage = ${TOPIC_STAGES.map((stage) => TOPIC_STAGE_LABEL[stage]).join(' | ')}`,
      paths.length > 0
        ? `page = ${paths.join(' | ')}${context.pagePaths.length > paths.length ? ' | …' : ''} (or leave it blank)`
        : 'page = leave it blank'
    ]
  },
  tracked: (context) => ({
    listed: context.targetQuestions,
    merge: { main: context.projectQuestions }
  }),
  clean: cleanQuestion,
  async describe(host, context, input) {
    ensureShippedAssists()
    if (context.target === null) return []
    const result = await runAssist(host, {
      assistId: 'prompts.more',
      projectId: context.projectId,
      pageId: context.target.id,
      marketId: null,
      promptId: null,
      inputs: { count: input.count },
      instruction: input.sentence.trim() || null
    })
    return result.items.map((item) => ({
      section: null,
      values: { question: item.text, stage: item.tag ?? '', page: '' }
    }))
  }
}

/** "Problem: …", "**Compare** — …" or "… (Decide)": a stage written beside the question. */
const STAGE_BEFORE = /^\s*\(?([\p{L} ]{3,22})\)?\s*[:–—-]\s+(.+)$/u
const STAGE_AFTER = /^(.+?)\s*(?:\(([\p{L} ]{3,22})\)|[–—|]\s*([\p{L} ]{3,22}))\s*$/u

/**
 * The stage as a stage id ('' when blank or unknown), the question without a stage
 * label a list item carried, and the page as written. A row with no question is dropped.
 */
export function cleanQuestion(values: HelpFillValues): HelpFillValues | null {
  let question = (values.question ?? '').trim()
  let stageWord = (values.stage ?? '').trim()
  if (stageWord.length === 0) {
    const before = STAGE_BEFORE.exec(question)
    const after = STAGE_AFTER.exec(question)
    if (before?.[1] !== undefined && before[2] !== undefined && isStageWord(before[1])) {
      stageWord = before[1]
      question = before[2].trim()
    } else if (after?.[1] !== undefined && isStageWord(after[2] ?? after[3] ?? '')) {
      stageWord = after[2] ?? after[3] ?? ''
      question = after[1].trim()
    }
  }
  if (question.length < 3) return null
  const stage = translateStage(stageWord, {})
  return {
    question,
    stage: stage === 'unknown' ? '' : stage,
    page: (values.page ?? '').trim()
  }
}

function isStageWord(word: string): boolean {
  return BUILT_IN_STAGE_WORDS[foldWord(word)] !== undefined
}
