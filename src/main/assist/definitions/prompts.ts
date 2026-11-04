import type { CoverageMatrix, PromptSetView } from '@shared/domain'
import { formatMoment } from '@shared/moment'
import { getLatestBuyerProfile } from '../../storage/content-records'
import { COVERAGE_RUBRIC, DATA_FENCE_RULE, fence, NO_REPEAT_RULE } from '../../prompts/blocks'
import type { AssistContext, AssistDefinition, AssistReply } from '../types'
import { pageCompetitors, pageMarketBlock, pageProductLines } from './context-blocks'
import {
  brandNamesOf,
  clip,
  findPrompt,
  formatPageBody,
  formatPageHead,
  formatPrompt,
  formatPrompts,
  formatProfile,
  inputNumber,
  inputText,
  marketIdOf,
  pageOf,
  profileOf,
  promptSetOf,
  snapshotOf
} from './gather'
import { currentCoverage } from './page-claims'
import {
  BUYER_PROMPT_MAX_WORDS,
  BUYER_PROMPT_MIN_WORDS,
  PROMPT_STAGES,
  checkBuyerPrompts,
  checkNoRepeats,
  checkTags,
  competitorNamedAsOption
} from './rules'

/** Prompts screen assists, in the owner's buyer-prompt method (Docs/PROMPT-AUDIT.md P7). */

const DEFAULT_MORE = 5
const MAX_MORE = 12

const METHOD = `A buyer prompt is a long, natural, situational question a buyer types into an AI assistant before they know any brand that sells the answer.
Write it in full sentences, ${BUYER_PROMPT_MIN_WORDS} to ${BUYER_PROMPT_MAX_WORDS} words, in the market's language. Put the situation in it: who is asking, the tool they use now by name, and what just happened or what worries them.
Never write a short keyword search. Never write a brand name or alias from the saved brand names. Never leave a [placeholder] in a prompt: if a detail is not known, write the prompt without it.`

/** The comparison stage, as `buyer_prompts` writes it (Docs/PROMPT-AUDIT.md P1). */
const COMPARISON_RULE = `A comparison prompt weighs kinds of solutions, or names direct or partial competitors from the competitor lines above, and no other company. Never offer a switch-from option or a tool used with the product as one of the choices; the buyer may name them only as their situation ("our carrier gateway is shutting down", "we send from Outlook").`

function moreCount(context: AssistContext): number {
  return Math.min(MAX_MORE, inputNumber(context, 'count') ?? DEFAULT_MORE)
}

function brandCheck(texts: readonly string[], context: AssistContext): string | null {
  return checkBuyerPrompts(texts, context.db === null ? [] : brandNamesOf(context.db))
}

/** A comparison prompt that offers a switch-from option or a tool as a choice. */
function comparisonCheck(reply: AssistReply, context: AssistContext): string | null {
  const competitors = pageCompetitors(pageOf(context))
  for (const item of reply.items) {
    if (item.tag?.toLowerCase() !== 'comparison') continue
    const option = competitorNamedAsOption(item.text, competitors)
    if (option !== null) {
      return `A comparison prompt offers "${option}" as a choice. Buyers switch from it or use it with the product; name only listed competitors or kinds of solutions.`
    }
  }
  return null
}

/** The saved matrix when it is current and rates every prompt in the set. */
function matrixForSet(context: AssistContext, set: PromptSetView): CoverageMatrix | null {
  const opened = pageOf(context)
  const snapshot = snapshotOf(opened.db, opened.page.id)
  const matrix = currentCoverage(opened.db, opened.page.id, snapshot)
  if (matrix === null) return null
  const rated = new Set(matrix.rows.map((row) => row.promptId))
  return set.prompts.every((prompt) => rated.has(prompt.id)) ? matrix : null
}

export const PROMPT_ASSISTS: readonly AssistDefinition[] = [
  {
    id: 'prompts.more',
    title: 'More buyer prompts',
    expectedSeconds: 15,
    acceptsInstruction: true,
    needsProject: true,
    needs: ['pageId'],
    minItems: 1,
    maxItems: MAX_MORE,
    task: `Write new buyer prompts for this page and this product that are not already in the saved set. Write the number asked for under "Prompts wanted".
${METHOD}
Every prompt is a different situation from the saved ones: a different buyer segment, trigger event or worry. Do not reword a saved prompt. ${NO_REPEAT_RULE}
Draw on the title, meta description and H1 promises, the trigger events and segments in the buyer profile, and the objections a buyer checks before buying (price, setup, compliance, where replies go). Spread the prompts over the stages, and include a comparison prompt when more than two are wanted.
${COMPARISON_RULE}
For each prompt: text is the prompt. tag is its intent stage: ${PROMPT_STAGES.join(', ')}. detail is "Source: <title/meta/H1, trigger event, segment or objection> · Maps to: <the page element it maps to, as written on the page>".`,
    gather(context) {
      const opened = pageOf(context)
      const snapshot = snapshotOf(opened.db, opened.page.id)
      const profile = profileOf(opened.db, opened.page.id, opened.page.kind)
      const set = promptSetOf(opened.db, opened.page.id)
      const marketId = marketIdOf(context, opened.page)
      return [
        `Prompts wanted: ${moreCount(context)}`,
        `Brand names to leave out: ${brandNamesOf(opened.db).join(', ') || '(none saved)'}`,
        pageMarketBlock(context, opened),
        pageProductLines(opened),
        '',
        'Saved prompts:',
        formatPrompts(set.prompts, marketId),
        '',
        'Buyer profile:',
        formatProfile(profile),
        '',
        formatPageHead(opened.page, snapshot),
        '',
        DATA_FENCE_RULE,
        fence('page_text', formatPageBody(snapshot, 12_000))
      ].join('\n')
    },
    check(reply, context) {
      return (
        checkTags(
          reply,
          PROMPT_STAGES,
          `Tag every prompt with one stage: ${PROMPT_STAGES.join(', ')}.`
        ) ??
        brandCheck(
          reply.items.map((item) => item.text),
          context
        ) ??
        checkNoRepeats(
          reply.items.map((item) => item.text),
          promptSetOf(pageOf(context).db, pageOf(context).page.id).prompts.flatMap((prompt) =>
            prompt.variants.map((variant) => variant.text)
          )
        ) ??
        comparisonCheck(reply, context)
      )
    }
  },
  {
    id: 'prompts.rephrase',
    title: 'Rephrase this prompt',
    expectedSeconds: 8,
    acceptsInstruction: true,
    needsProject: true,
    needs: ['pageId'],
    minItems: 3,
    maxItems: 3,
    task: `Write three new wordings of the prompt under "Prompt to rephrase". Keep the same situation, the same buyer and the same intent stage, so the prompt still maps to the same part of the page.
${METHOD}
Use the buyer's own words and tools from "Buyer" where the prompt is vague, but add no new worry or fact.
Make the three differ in how a real buyer would ask: one leads with what just happened, one with the tool they use now, one with what they fear.
For each wording: text is the prompt. detail says in a few words what changed, such as "names the tool first".`,
    gather(context) {
      const opened = pageOf(context)
      const set = promptSetOf(opened.db, opened.page.id)
      const prompt = findPrompt(set, inputText(context, 'promptId', 80) ?? context.request.promptId)
      const marketId = marketIdOf(context, opened.page)
      const snapshot = snapshotOf(opened.db, opened.page.id)
      const profile = getLatestBuyerProfile(opened.db, opened.page.id)
      return [
        `Prompt to rephrase: ${formatPrompt(prompt, marketId)}`,
        pageMarketBlock(context, opened),
        `Buyer: ${profile === null ? 'no profile written yet.' : clip(profile.who.replace(/\s+/gu, ' '), 600)}`,
        `Brand names to leave out: ${brandNamesOf(opened.db).join(', ') || '(none saved)'}`,
        '',
        formatPageHead(opened.page, snapshot)
      ].join('\n')
    },
    check(reply, context) {
      return brandCheck(
        reply.items.map((item) => item.text),
        context
      )
    }
  },
  {
    id: 'prompts.checkPage',
    title: 'Check prompts against the page',
    expectedSeconds: 15,
    acceptsInstruction: false,
    needsProject: true,
    needs: ['pageId'],
    minItems: 1,
    maxItems: 40,
    task: `For each saved prompt, say whether the page answers it now.
${COVERAGE_RUBRIC}
One item per prompt, in prompt order. text is "Prompt <number>: " and a one-sentence verdict for that buyer. tag is strong, partial, weak or none.
detail names where the page covers it, copied exactly as written on the page (a heading, an FAQ question or a sentence), then what is missing for this buyer, if anything. For none, detail says what is missing.`,
    gather(context) {
      const opened = pageOf(context)
      const snapshot = snapshotOf(opened.db, opened.page.id)
      const set = promptSetOf(opened.db, opened.page.id)
      return [
        'Saved prompts:',
        formatPrompts(set.prompts, marketIdOf(context, opened.page)),
        '',
        formatPageHead(opened.page, snapshot),
        '',
        DATA_FENCE_RULE,
        fence('page_text', formatPageBody(snapshot))
      ].join('\n')
    },
    answerFromSaved(context) {
      const opened = pageOf(context)
      const set = promptSetOf(opened.db, opened.page.id)
      const matrix = matrixForSet(context, set)
      if (matrix === null) return null
      const rows = new Map(matrix.rows.map((row) => [row.promptId, row]))
      const counts = { strong: 0, partial: 0, weak: 0, none: 0 }
      const items = [...set.prompts]
        .sort((left, right) => left.position - right.position)
        .map((prompt) => {
          const row = rows.get(prompt.id)
          if (row === undefined) throw new Error('matrixForSet checked every prompt has a row')
          counts[row.coverage] += 1
          const where = row.whereCovered.map((place) => `"${place}"`).join('; ')
          return {
            text: `Prompt ${prompt.position}: ${row.mainGap.length > 0 && row.coverage !== 'strong' ? row.mainGap : 'The page answers this directly.'}`,
            detail:
              [where.length > 0 ? `Covered in ${where}.` : null, row.whatToUpdate || null]
                .filter((part): part is string => part !== null)
                .join(' ') || null,
            tag: row.coverage,
            verify: null,
            sign: null
          }
        })
      return {
        summary: `From the coverage check saved on ${formatMoment(matrix.recordedAt, { year: true })} for this version of the page: ${counts.strong} strong, ${counts.partial} partial, ${counts.weak} weak, ${counts.none} none. No new CiteFox AI call.`,
        items,
        caution: null
      }
    },
    check(reply) {
      return checkTags(
        reply,
        ['strong', 'partial', 'weak', 'none'],
        'Tag every prompt strong, partial, weak, or none.'
      )
    }
  }
]
