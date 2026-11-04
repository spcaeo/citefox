import type {
  BuyerPrompt,
  CoverageFinding,
  CoveragePriority,
  PagePromiseSummary
} from '@shared/domain'
import type { AssistItem } from '@shared/ipc'
import { countryName, DATA_FENCE_RULE, fence } from '../../prompts/blocks'
import type { StoredSnapshot } from '../../storage/content-records'
import { setSnapshotSummary } from '../../storage/snapshot-records'
import {
  AssistInputError,
  type AssistContext,
  type AssistDefinition,
  type AssistReply
} from '../types'
import { pageCompetitors, pageMarket, pageMarketBlock } from './context-blocks'
import {
  brandNamesOf,
  formatPageBody,
  formatPageHead,
  inputText,
  pageOf,
  promptSetOf,
  promptText,
  snapshotOf,
  type OpenedPage
} from './gather'
import {
  checkableClaims,
  currentCoverage,
  cutOffWords,
  MAX_CHECKED_CLAIMS,
  META_CUT_OFF,
  normalizeQuote,
  quotedFromPage,
  TITLE_CUT_OFF
} from './page-claims'
import { checkTags } from './rules'

/** Page read assists (FR-25, textbolt-reference step 1; Docs/PROMPT-AUDIT.md P7). */

export const TITLE_MAX_LENGTH = 60

type SavedItem = Omit<AssistItem, 'id'>

function savedItem(
  text: string,
  detail: string | null,
  tag: string,
  verify: string | null = null
): SavedItem {
  return { text, detail, tag, verify, sign: null }
}

/** Page head, brand names and the fenced page text. */
function pageFacts(opened: OpenedPage, snapshot: StoredSnapshot): string {
  return [
    formatPageHead(opened.page, snapshot),
    `Brand names: ${brandNamesOf(opened.db).join(', ') || '(none saved)'}`,
    '',
    DATA_FENCE_RULE,
    fence('page_text', formatPageBody(snapshot))
  ].join('\n')
}

const PRIORITY_ORDER: Readonly<Record<CoveragePriority, number>> = { high: 0, medium: 1, low: 2 }

/**
 * The page's top buyer prompts: by the saved coverage priority when the matrix is
 * current, else in prompt order. Empty when no prompts are written yet.
 */
function topPrompts(
  context: AssistContext,
  opened: OpenedPage,
  snapshot: StoredSnapshot,
  count: number
): string[] {
  let prompts: readonly BuyerPrompt[]
  try {
    prompts = promptSetOf(opened.db, opened.page.id).prompts
  } catch {
    // No prompts yet: the title assist still runs on the page alone.
    return []
  }
  const priority = new Map(
    (currentCoverage(opened.db, opened.page.id, snapshot)?.rows ?? []).map((row) => [
      row.promptId,
      PRIORITY_ORDER[row.priority]
    ])
  )
  const marketId = context.request.marketId ?? opened.page.defaultMarketId
  return prompts
    .filter((prompt) => prompt.enabled)
    .sort(
      (left, right) =>
        (priority.get(left.id) ?? 3) - (priority.get(right.id) ?? 3) ||
        left.position - right.position
    )
    .slice(0, count)
    .map((prompt) => promptText(prompt, marketId))
}

/** Stored page-wide findings of these kinds, when the saved matrix is current. */
function storedFindings(
  opened: OpenedPage,
  snapshot: StoredSnapshot,
  kinds: readonly CoverageFinding['kind'][]
): CoverageFinding[] {
  const matrix = currentCoverage(opened.db, opened.page.id, snapshot)
  return (matrix?.findings ?? []).filter((finding) => kinds.includes(finding.kind))
}

// ---------------------------------------------------------------------------
// page.checkFacts: claims to re-check, from the stored audit or from the page
// ---------------------------------------------------------------------------

export const FACT_TAGS = ['date', 'price', 'limit', 'rule', 'promise', 'typo'] as const

const FACT_VERIFY: Readonly<Record<(typeof FACT_TAGS)[number], string>> = {
  date: 'Check the official notice or announcement for the current date.',
  price: 'Check the current price on the pricing page.',
  limit: 'Check the standard or the provider documentation for the exact limit.',
  rule: 'Check the current rule with the regulator or the carrier.',
  promise: 'Read the page from top to bottom and confirm the promised section is there.',
  typo: 'Fix the wording on the page.'
}

/** A stored finding's tag: its kind, and for a factual claim what the claim is about. */
function factTag(finding: CoverageFinding): (typeof FACT_TAGS)[number] {
  if (finding.kind === 'typo') return 'typo'
  if (finding.kind === 'missing_promised_section') return 'promise'
  const text = `${finding.summary} ${finding.detail}`
  if (/[$€£]\s?\d|\bprice|\bcost|\bper month|\bplan\b/iu.test(text)) return 'price'
  if (/\b(?:law|regulat|TCPA|10DLC|A2P|consent|registration|compliance)/iu.test(text)) return 'rule'
  if (/\b(?:19|20)\d{2}\b|\bdeadline|\bshut|\bdiscontinu|\bdate\b/iu.test(text)) return 'date'
  return 'limit'
}

/**
 * True when the statement is on the page: the whole text, or each part of it in double
 * quotes (a short label in front, or "…" for words left out, does not fail it).
 */
function quotesPage(text: string, snapshot: StoredSnapshot): boolean {
  const quoted = [...text.matchAll(/["“]([^"”]{12,})["”]/gu)].map((match) => match[1] ?? '')
  const parts = (quoted.length > 0 ? quoted : [text])
    .flatMap((part) => part.split(/\.{3}|…/u))
    .map((part) => part.trim())
    .filter((part) => part.length >= 8)
  return (
    quotedFromPage(text, snapshot) ||
    (parts.length > 0 && parts.every((part) => quotedFromPage(part, snapshot)))
  )
}

// ---------------------------------------------------------------------------
// page.verifyClaims: the opt-in online check
// ---------------------------------------------------------------------------

export const VERDICT_TAGS = ['confirmed', 'outdated', 'wrong', 'unclear'] as const

/** The claims to check: the user's list (from Check facts), else checkable sentences on the page. */
function claimsToCheck(context: AssistContext, snapshot: StoredSnapshot): string[] {
  const given = inputText(context, 'claims', 4000)
  if (given !== null) {
    return given
      .split('\n')
      .map((line) => line.replace(/^\s*[-*\d.)]+\s*/u, '').trim())
      .filter((line) => line.length > 0)
      .slice(0, MAX_CHECKED_CLAIMS)
  }
  return checkableClaims(snapshot)
}

/** http(s) URLs in a verify field. */
export function sourceUrls(verify: string | null): string[] {
  return (verify ?? '').split(/[\s,;]+/u).filter((token) => token.length > 0)
}

function checkVerdicts(reply: AssistReply, claims: readonly string[]): string | null {
  const tagged = checkTags(reply, VERDICT_TAGS, `Tag every claim ${VERDICT_TAGS.join(', ')}.`)
  if (tagged !== null) return tagged
  const given = claims.map(normalizeQuote)
  for (const item of reply.items) {
    const text = normalizeQuote(item.text)
    if (!given.some((claim) => claim === text || claim.includes(text) || text.includes(claim))) {
      return 'Copy each claim exactly as it was given in text.'
    }
    const urls = sourceUrls(item.verify)
    if (urls.some((url) => !/^https?:\/\/[^\s/]+\.[^\s]+/iu.test(url))) {
      return 'Put only full http or https source URLs in verify, separated by spaces.'
    }
    if (item.tag !== 'unclear' && urls.length === 0) {
      return `Give at least one source URL in verify for every ${item.tag} claim, or tag it unclear.`
    }
    if (item.tag !== 'confirmed' && item.detail === null) {
      return 'Give the correct current fact in detail for every claim that is not confirmed.'
    }
  }
  return null
}

export const PAGE_ASSISTS: readonly AssistDefinition[] = [
  {
    id: 'page.shorterTitle',
    title: 'Shorter title',
    expectedSeconds: 8,
    acceptsInstruction: true,
    needsProject: true,
    needs: ['pageId'],
    minItems: 3,
    maxItems: 3,
    task: `Write three shorter title tags for this page, in the market's language. Each is under ${TITLE_MAX_LENGTH} characters, spaces included.
Google cuts long titles in search results, so the first words carry the page: lead with the words a buyer from "Top buyer prompts" would recognise as their problem or the job the page does, then the strongest differentiator the page itself states.
Keep the page's own promise and its main topic. Do not add a claim, price, number or year the page does not make. Keep a brand name only at the end, if at all.
Make the three different in approach (problem first, job first, differentiator first), not three rewordings of one title.
For each title: text is the title. detail says in one sentence which buyer wording it leads with and what it drops from the current title. tag is the approach: "problem first", "job first" or "differentiator first". Code counts the characters, so do not count them or mention counting.`,
    gather(context) {
      const opened = pageOf(context)
      const snapshot = snapshotOf(opened.db, opened.page.id)
      const prompts = topPrompts(context, opened, snapshot, 3)
      return [
        pageMarketBlock(context, opened),
        '',
        'Top buyer prompts for this page:',
        prompts.length > 0
          ? prompts.map((text, index) => `${index + 1}. ${text}`).join('\n')
          : 'None written yet.',
        '',
        pageFacts(opened, snapshot)
      ].join('\n')
    },
    check(reply) {
      if (!reply.items.every((item) => item.text.length < TITLE_MAX_LENGTH)) {
        return `Every title must be under ${TITLE_MAX_LENGTH} characters.`
      }
      const unique = new Set(reply.items.map((item) => item.text.trim().toLowerCase()))
      return unique.size === reply.items.length ? null : 'Write three different titles.'
    },
    finish(reply) {
      // Code measures the length (rule 4); the tag keeps Claude's approach in front of it.
      const items = reply.items.map((item) => {
        const length = `${item.text.trim().length} characters`
        return { ...item, tag: item.tag === null ? length : `${item.tag} · ${length}` }
      })
      return { ...reply, items }
    }
  },
  {
    id: 'page.promises',
    title: 'What the page promises',
    expectedSeconds: 10,
    acceptsInstruction: true,
    needsProject: true,
    needs: ['pageId'],
    minItems: 3,
    maxItems: 3,
    task: `Say what the title, the meta description and the H1 each promise a searcher: one item each, tagged title, meta and h1, in that order.
A promise is the outcome or answer a reader expects after reading that line, in plain words, for the buyer this page is for. Not a summary of the line: what it commits the page to deliver.
text is the promise in one sentence. detail quotes the line exactly as written on the page.
When the page has no meta description or no H1, text says so and what the searcher sees instead (Google writes its own snippet from the page; the title acts as the heading), and detail is null.
Only the promise. Search cut-off and mismatches between the three are checked separately.`,
    gather(context) {
      const opened = pageOf(context)
      const snapshot = snapshotOf(opened.db, opened.page.id)
      return [pageMarketBlock(context, opened), '', pageFacts(opened, snapshot)].join('\n')
    },
    check(reply) {
      const tags = reply.items.map((item) => item.tag?.toLowerCase() ?? '')
      return tags.join(',') === 'title,meta,h1'
        ? null
        : 'Give exactly three items, tagged title, meta and h1, in that order.'
    },
    finish(reply, context) {
      // The Page read rail's "What the page promises" panel reads the snapshot summary.
      const opened = pageOf(context)
      const snapshot = snapshotOf(opened.db, opened.page.id)
      setSnapshotSummary(opened.db, snapshot.id, promiseSummary(reply, opened))
      return reply
    },
    savedItems(context) {
      const opened = pageOf(context)
      const snapshot = snapshotOf(opened.db, opened.page.id)
      const items: SavedItem[] = []
      const title = cutOffWords(snapshot.title, TITLE_CUT_OFF)
      if (title !== null) {
        items.push(
          savedItem(
            `Search results cut the title after about ${TITLE_CUT_OFF} characters.`,
            `Searchers would not see: "${title}"`,
            'cut off'
          )
        )
      }
      const meta = cutOffWords(snapshot.metaDescription, META_CUT_OFF)
      if (meta !== null) {
        items.push(
          savedItem(
            `Search results cut the meta description after about ${META_CUT_OFF} characters.`,
            `Searchers would not see: "${meta}"`,
            'cut off'
          )
        )
      }
      for (const finding of storedFindings(opened, snapshot, ['title_meta_mismatch'])) {
        items.push(savedItem(finding.summary, finding.detail, 'mismatch'))
      }
      return items
    }
  },
  {
    id: 'page.checkFacts',
    title: 'Check facts',
    expectedSeconds: 12,
    acceptsInstruction: true,
    needsProject: true,
    needs: ['pageId'],
    minItems: 0,
    maxItems: 12,
    task: `List the statements on this page the owner should re-check before the next edit, because they are wrong, out of date, or likely to change:
- date: a deadline, a shutdown, a launch or a "last updated" that may have passed;
- price: a price, a plan or what a plan includes;
- limit: a number with a unit (characters per SMS, messages, contacts, days to approve). Compare it with the standard you know, for example a single SMS holds 160 GSM-7 characters, not 155;
- rule: a law, a registration or a carrier rule (consent, opt-out, 10DLC, toll-free verification);
- promise: a section or answer the intro or a heading promises that the page does not deliver;
- typo: a broken sentence, a doubled word, or punctuation such as an FAQ question ending in "??".
One item per statement. text copies the statement exactly as written on the page (the shortest full sentence or phrase that carries it). detail says in one sentence what looks wrong or what may have changed, and gives the standard figure when you know it, in [brackets] when you are not sure. tag is date, price, limit, rule, promise or typo.
Every item has verify: where and what to check, such as "Check Verizon's shutdown notice for the current date".
Do not list opinions, marketing claims or steps that cannot go out of date. Give no items when nothing needs checking, and say so in summary.`,
    gather(context) {
      const opened = pageOf(context)
      const snapshot = snapshotOf(opened.db, opened.page.id)
      return [pageMarketBlock(context, opened), '', pageFacts(opened, snapshot)].join('\n')
    },
    answerFromSaved(context) {
      const opened = pageOf(context)
      const snapshot = snapshotOf(opened.db, opened.page.id)
      const findings = storedFindings(opened, snapshot, [
        'factual_claim',
        'missing_promised_section',
        'typo'
      ])
      if (findings.length === 0) return null
      return {
        summary: `${findings.length} ${findings.length === 1 ? 'thing' : 'things'} to re-check, from the content check saved for this version of the page. Ask CiteFox AI to look again with an instruction.`,
        caution:
          'Dates, prices and limits can change. Check them at the source, or run "Check the claims online".',
        items: findings.map((finding) => {
          const tag = factTag(finding)
          return savedItem(finding.summary, finding.detail, tag, FACT_VERIFY[tag])
        })
      }
    },
    check(reply, context) {
      const tagged = checkTags(reply, FACT_TAGS, `Tag every statement ${FACT_TAGS.join(', ')}.`)
      if (tagged !== null) return tagged
      if (reply.items.some((item) => item.verify === null))
        return 'Give every claim a "verify" note.'
      const opened = pageOf(context)
      const snapshot = snapshotOf(opened.db, opened.page.id)
      const loose = reply.items.find((item) => !quotesPage(item.text, snapshot))
      return loose === undefined
        ? null
        : `Copy each statement exactly as written on the page; "${loose.text.slice(0, 80)}" is not on the page.`
    }
  },
  {
    id: 'page.verifyClaims',
    title: 'Check the claims online',
    expectedSeconds: 90,
    acceptsInstruction: true,
    needsProject: true,
    needs: ['pageId'],
    webSearch: true,
    minItems: 1,
    maxItems: MAX_CHECKED_CLAIMS,
    task: `Check each claim under "Claims" against current, authoritative sources on the web, for the market given: standards bodies and specifications, carriers, regulators and official notices, and the official pages of the companies named. For a claim about the business's own product or price, the business's own site is the source.
One item per claim, in the order given. Skip a claim only when it is an opinion with nothing to check, and say which in summary.
- text: the claim, copied exactly as given.
- tag: confirmed (a current source says the same), outdated (it was true but has changed: a date has passed, a price or a limit moved), wrong (a source says otherwise), or unclear (no source settles it, or sources disagree).
- detail: the correct current fact in one or two sentences, with the number, date or rule the source gives. For confirmed, what the source says. For unclear, what you found and what is still open.
- verify: the URLs of the sources you used, best first, separated by spaces. Only pages you opened or saw in the results; never a made-up URL. null only for unclear when nothing relevant was found.
summary: the counts by verdict in one line. caution: what is time-sensitive and worth re-checking before publishing, or null.
When you are not sure, say unclear. Never guess a verdict.`,
    gather(context) {
      const opened = pageOf(context)
      const snapshot = snapshotOf(opened.db, opened.page.id)
      const claims = claimsToCheck(context, snapshot)
      if (claims.length === 0) {
        throw new AssistInputError(
          'This page states no dates, prices, limits or rules to check online.',
          'Run Check facts on the page instead.'
        )
      }
      const market = pageMarket(context, opened)
      return [
        `Page: ${opened.page.url ?? 'not set'}`,
        market === null
          ? 'Market: not set.'
          : `Market: ${countryName(market.country)}${market.location === null ? '' : `, ${market.location}`}. Judge laws, carriers and prices for this market.`,
        `Checked on: ${context.host.now().toISOString().slice(0, 10)}`,
        '',
        `Claims (copied from the page; ${DATA_FENCE_RULE.toLowerCase()}):`,
        fence('claims', claims.map((claim, index) => `${index + 1}. ${claim}`).join('\n'))
      ].join('\n')
    },
    check(reply, context) {
      const opened = pageOf(context)
      const snapshot = snapshotOf(opened.db, opened.page.id)
      return checkVerdicts(reply, claimsToCheck(context, snapshot))
    }
  }
]

const PROMISE_LINES: Readonly<Record<string, string>> = {
  title: 'the title',
  meta: 'the meta description',
  h1: 'the H1'
}

/**
 * `page.promises` as the snapshot summary the Page read rail shows: one promise per
 * line (title, meta, H1) with the line it comes from, and the page's product.
 */
export function promiseSummary(reply: AssistReply, opened: OpenedPage): PagePromiseSummary {
  const promises = reply.items.map((item) => {
    const line = PROMISE_LINES[item.tag?.toLowerCase() ?? ''] ?? 'the page'
    return {
      title: item.text,
      detail: item.detail === null ? `Not on the page: ${line}.` : `From ${line}: "${item.detail}"`
    }
  })
  const product = pageCompetitors(opened).product
  return { promises, product: product === null ? null : `${product.name}: ${product.job}` }
}
