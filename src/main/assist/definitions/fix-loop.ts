import { fixKindLabel, type PromptCheckRow } from '@shared/domain'
import { isCited } from '@shared/fix-loop'
import { statusLabel } from '../../engine/checks/report-files'
import { CheckInputError, runPromptRows } from '../../engine/checks/results'
import {
  readLostGround,
  recoveryInputKey,
  type LostGroundFacts
} from '../../engine/fix-loop/lost-ground'
import { fullRunsOf } from '../../engine/fix-loop/runs'
import { DATA_FENCE_RULE, fence, NO_CAUSE_RULE } from '../../prompts/blocks'
import { causeProblem } from '../../prompts/citations'
import { getLatestPromptSet, getLatestSnapshot } from '../../storage/content-records'
import { getPageAiText, PAGE_AI_TEXT_MAX, putPageAiText } from '../../storage/fix-loop-records'
import {
  AssistInputError,
  type AssistContext,
  type AssistDefinition,
  type AssistReply
} from '../types'
import {
  brandNamesOf,
  clip,
  day,
  inputText,
  marketLabel,
  marketOf,
  pageOf,
  promptText,
  type OpenedPage
} from './gather'
import { replyTexts } from './results'

/**
 * The Fixes screen's loop: a backlink anchor for a page, and a recovery plan for a
 * page that lost ground. Each is one single-purpose call (Docs/PROMPT-AUDIT.md), its
 * answer cached per page in `page_ai_texts` so the screen shows it again without a
 * new call.
 */

/** Questions sent with the anchor request, those not cited yet first. */
const ANCHOR_QUESTIONS_MAX = 12
const ANCHOR_WORDS = { min: 2, max: 6 } as const

function addressOf(opened: OpenedPage): string {
  if (opened.page.url === null) {
    throw new AssistInputError('A topic has no address to link to.', 'Pick a page, then try again.')
  }
  return opened.page.url
}

/** The page's questions in its default market, not cited ones first, from the latest full check. */
function anchorQuestions(opened: OpenedPage, marketId: string): string[] {
  const latest = fullRunsOf(opened.db, opened.project.id, opened.page.id, marketId).at(-1)
  if (latest !== undefined) {
    const rows = runPromptRows(opened.db, opened.project.id, latest)
    return [...rows]
      .sort(
        (left, right) =>
          Number(isCited(left)) - Number(isCited(right)) ||
          left.promptPosition - right.promptPosition
      )
      .slice(0, ANCHOR_QUESTIONS_MAX)
      .map((row) => `- ${row.text} (${isCited(row) ? 'cited' : 'not cited yet'})`)
  }
  const set = getLatestPromptSet(opened.db, opened.page.id, brandNamesOf(opened.db))
  return (set?.prompts ?? [])
    .filter((prompt) => prompt.enabled)
    .slice(0, ANCHOR_QUESTIONS_MAX)
    .map((prompt) => `- ${promptText(prompt, marketId)} (not checked yet)`)
}

/** Why an anchor is refused, or null: 2–6 words, no brand, no quotes, not an address. */
export function anchorProblem(text: string, brands: readonly string[]): string | null {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length < ANCHOR_WORDS.min || words.length > ANCHOR_WORDS.max) {
    return `Give an anchor of ${ANCHOR_WORDS.min} to ${ANCHOR_WORDS.max} words.`
  }
  if (/["“”«»]/u.test(text) || /^['‘’]|['‘’]$/u.test(text.trim())) {
    return 'Give the anchor without quote marks.'
  }
  if (/https?:|www\.|\/|\.(?:com|net|org|io|co)\b/iu.test(text)) {
    return 'Give words a site would link with, not the address.'
  }
  const lower = text.toLowerCase()
  const brand = brands.find((name) => name.trim().length > 0 && lower.includes(name.toLowerCase()))
  if (brand !== undefined) return `Leave the brand name "${brand}" out of the anchor.`
  return null
}

export const ANCHOR_TEXT_ASSIST: AssistDefinition = {
  id: 'fixes.anchorText',
  title: 'Suggest anchor text',
  expectedSeconds: 6,
  acceptsInstruction: false,
  needsProject: true,
  needs: ['pageId'],
  minItems: 1,
  maxItems: 1,
  task: `Suggest one anchor text for backlinks to this exact page: the words another site would link to it with.
- Exactly 1 item. text: the anchor, ${ANCHOR_WORDS.min} to ${ANCHOR_WORDS.max} words, a natural lowercase phrase in the market's language that says what the page answers. No brand name, no quote marks, not the address.
- detail: one short reason, naming the questions it matches.
- Build it from the title or H1, the URL path and the questions, the ones not cited yet first.
- ${DATA_FENCE_RULE}
summary and caution are null.`,
  gather(context) {
    const opened = pageOf(context)
    const url = addressOf(opened)
    const marketId = opened.page.defaultMarketId
    if (marketId === null) {
      throw new AssistInputError('This page has no market yet.', 'Add a market to the page.')
    }
    const market = marketOf(opened.db, marketId)
    const snapshot = getLatestSnapshot(opened.db, opened.page.id)
    const questions = anchorQuestions(opened, marketId)
    return [
      `Page URL: ${url}`,
      `URL path: ${pathOf(url)}`,
      `Market: ${marketLabel(market)} (write the anchor in language "${market.language}")`,
      `Brand names to leave out: ${brandNamesOf(opened.db).join(', ') || 'none saved'}`,
      '',
      fence(
        'page_text',
        [
          `Title: ${snapshot?.title ?? opened.page.title ?? '(none)'}`,
          `H1: ${snapshot?.h1 ?? '(none)'}`
        ].join('\n')
      ),
      '',
      'Questions this page should answer:',
      questions.length === 0 ? '- none saved yet' : questions.join('\n')
    ].join('\n')
  },
  check(reply, context) {
    const item = reply.items[0]
    if (item === undefined) return 'Give exactly 1 item.'
    return anchorProblem(item.text, brandNamesOf(pageOf(context).db))
  },
  answerFromSaved(context) {
    if (context.request.inputs.refresh === true) return null
    const opened = pageOf(context)
    const saved = getPageAiText(opened.db, opened.page.id, 'anchor')
    if (saved === null) return null
    return {
      summary: null,
      caution: null,
      items: [{ text: saved.text, detail: null, tag: null, verify: null, sign: null }]
    }
  },
  finish(reply, context) {
    const opened = pageOf(context)
    const item = reply.items[0]
    if (item === undefined) return reply
    const text = item.text.trim().toLowerCase()
    putPageAiText(opened.db, {
      pageId: opened.page.id,
      kind: 'anchor',
      inputKey: opened.page.id,
      text,
      edited: false,
      savedAt: context.host.now().toISOString()
    })
    return { ...reply, items: [{ ...item, text }] }
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

/** Lost ground for the request's page and its `vsRunId` input (the older check), as assist input. */
function lostGroundOf(context: AssistContext): LostGroundFacts {
  const opened = pageOf(context)
  try {
    return readLostGround(
      opened.db,
      opened.project,
      opened.page.id,
      inputText(context, 'vsRunId', 80)
    )
  } catch (error) {
    if (error instanceof CheckInputError) {
      throw new AssistInputError(
        error.message,
        'Run another full check of this page, then try again.'
      )
    }
    throw error
  }
}

function lostRows(facts: LostGroundFacts): PromptCheckRow[] {
  const { buckets } = facts.view
  const lost = new Set([...buckets.moved_tracked, ...buckets.moved_own, ...buckets.not_cited])
  return facts.beforeRows.filter((row) => lost.has(row.promptId))
}

/** Where a lost question went: another tracked page, another own page, or nowhere on the site. */
function whereNow(facts: LostGroundFacts, row: PromptCheckRow): string {
  const view = facts.view
  const moved = view.movedTo[row.promptId]
  if (view.buckets.moved_tracked.includes(row.promptId) && moved !== undefined) {
    return `now cites another tracked page: ${moved}`
  }
  if (moved !== undefined) return `now cites another own page: ${moved}`
  const now = facts.nowRows.find((item) => item.promptId === row.promptId)
  return `no own page cited now (${now === undefined ? 'not checked' : statusLabel(now.status)})`
}

function formatLost(facts: LostGroundFacts): string {
  const rows = lostRows(facts)
  const stages = [...new Set(rows.map((row) => row.intentStage))]
  return stages
    .map((stage) =>
      [
        `Stage ${stage}:`,
        ...rows
          .filter((row) => row.intentStage === stage)
          .map((row) => `- ${clip(row.text, 300)} → ${whereNow(facts, row)}`)
      ].join('\n')
    )
    .join('\n')
}

function formatOutline(facts: LostGroundFacts): string {
  const outline = facts.view.outline
  if (outline === null) return 'No outline comparison: one of the two page reads is missing.'
  const removed = outline.before.filter((heading) => heading.match === null)
  const added = outline.now.filter((heading) => heading.match === null)
  const list = (items: readonly { level: string; text: string }[]): string =>
    items.length === 0 ? '- none' : items.map((item) => `- ${item.level}: ${item.text}`).join('\n')
  return fence(
    'page_text',
    [
      `Sections in the older read with no match now (${removed.length}):`,
      list(removed),
      `Sections in the latest read with no match before (${added.length}):`,
      list(added)
    ].join('\n')
  )
}

function cited(rows: readonly PromptCheckRow[]): string {
  return `cited for ${rows.filter(isCited).length} of ${rows.length} questions`
}

function planKey(facts: LostGroundFacts): string {
  return recoveryInputKey(facts.beforeRun.id, facts.nowRun.id)
}

/** A numbered Markdown list, one step per line, the detail after a dash. */
function planMarkdown(reply: AssistReply): string {
  return reply.items
    .map(
      (item, index) =>
        `${index + 1}. ${item.text}${item.detail === null ? '' : ` — ${item.detail}`}`
    )
    .join('\n')
}

/** A saved plan back as items: one per numbered line, else the whole text as one item. */
function planItems(text: string): AssistReply['items'] {
  const steps = text
    .split('\n')
    .map((line) => /^\s*\d+[.)]\s+(.+)$/u.exec(line)?.[1]?.trim() ?? null)
    .filter((step): step is string => step !== null && step.length > 0)
  const texts = steps.length > 0 ? steps : [text.trim()]
  return texts.map((step) => ({ text: step, detail: null, tag: null, verify: null, sign: null }))
}

export const RECOVERY_PLAN_ASSIST: AssistDefinition = {
  id: 'fixes.recoveryPlan',
  title: 'Write a recovery plan',
  expectedSeconds: 12,
  acceptsInstruction: true,
  needsProject: true,
  needs: ['pageId'],
  minItems: 3,
  maxItems: 5,
  task: `Write a recovery plan for this page: between the two checks it stopped being cited for the questions under "Lost questions".
- 3 to 5 items, most useful first. text: one concrete step (which section to restore, add or rewrite and what it must answer, or which page should own a question that moved to another tracked page). detail: the lost questions it targets, or null.
- Read the outline comparison and the logged change side by side with the dates, and say what most likely matters. ${NO_CAUSE_RULE}
- ${DATA_FENCE_RULE}
summary: one sentence on what was lost and what most likely changed. caution: null, or one short line on what the saved data cannot show.`,
  gather(context) {
    const facts = lostGroundOf(context)
    if (lostRows(facts).length === 0) {
      throw new AssistInputError(
        'This page lost no cited question between these two checks.',
        'Compare with another check.'
      )
    }
    const { view } = facts
    const change = view.change
    return [
      `Page URL: ${view.url}`,
      `Page: ${view.title ?? '(no title)'}`,
      `Older check: ${day(view.before.checkedAt)}, ${cited(facts.beforeRows)}.`,
      `Latest check: ${day(view.now.checkedAt)}, ${cited(facts.nowRows)}.`,
      `Still cited: ${view.buckets.still_cited.length}. Not in the latest check: ${view.notCheckedNow.length}.`,
      change === null
        ? 'Change logged between the two checks: none.'
        : `Change logged between the two checks: ${fixKindLabel(change.kind)}, live ${day(change.liveSince)}: ${clip(change.description, 600)}`,
      '',
      'Lost questions, by intent stage, and where each stands now:',
      formatLost(facts),
      '',
      `Outline: page read of ${day(view.beforeRead?.fetchedAt ?? null)} against page read of ${day(view.nowRead?.fetchedAt ?? null)}.`,
      formatOutline(facts)
    ].join('\n')
  },
  check: (reply) => causeProblem(replyTexts(reply)),
  answerFromSaved(context) {
    const facts = lostGroundOf(context)
    const plan = facts.view.plan
    if (plan === null || plan.inputKey !== planKey(facts)) return null
    return { summary: null, caution: null, items: planItems(plan.text) }
  },
  finish(reply, context) {
    const facts = lostGroundOf(context)
    putPageAiText(pageOf(context).db, {
      pageId: facts.page.id,
      kind: 'recovery',
      inputKey: planKey(facts),
      text: planMarkdown(reply).slice(0, PAGE_AI_TEXT_MAX),
      edited: false,
      savedAt: context.host.now().toISOString()
    })
    return reply
  }
}

export const FIX_LOOP_ASSISTS: readonly AssistDefinition[] = [
  ANCHOR_TEXT_ASSIST,
  RECOVERY_PLAN_ASSIST
]
