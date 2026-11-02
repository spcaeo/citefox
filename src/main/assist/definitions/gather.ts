import type {
  BuyerProfile,
  BuyerPrompt,
  Market,
  PageResults,
  PageSummary,
  PromptCheckRow,
  PromptSetView
} from '@shared/domain'
import { checkReportsRoot, statusLabel } from '../../engine/checks/report-files'
import { loadPageResults } from '../../engine/checks/results'
import {
  capPageText,
  formatBuyerProfile,
  formatFaqs,
  formatLastModified,
  formatOutline,
  PAGE_TEXT_TEMPLATE_MAX
} from '../../pipeline/template-context'
import {
  getLatestBuyerProfile,
  getLatestPromptSet,
  getLatestSnapshot,
  type StoredSnapshot
} from '../../storage/content-records'
import type { SqliteDatabase } from '../../storage/database'
import { StorageError } from '../../storage/errors'
import { getPage } from '../../storage/pages'
import { getMarket, readProjectProfile } from '../../storage/project-profile'
import type { ProjectRecord } from '../../storage/records'
import { AssistInputError, type AssistContext } from '../types'

/**
 * Saved-data readers shared by the shipped assists. Each one reads through the
 * existing storage and engine readers, formats readable text, and throws
 * `AssistInputError` with a plain next step when something is missing.
 * Nothing here calls SerpApi or writes to a database.
 */

/** Page text sent with an assist: the same bound as the generation templates. */
export const ASSIST_PAGE_TEXT_MAX = PAGE_TEXT_TEMPLATE_MAX

export interface OpenedProject {
  db: SqliteDatabase
  project: ProjectRecord
}

export interface OpenedPage extends OpenedProject {
  page: PageSummary
}

export function projectOf(context: AssistContext): OpenedProject {
  if (context.db === null || context.project === null) {
    throw new AssistInputError('Open a project first.', 'Pick a project, then try again.')
  }
  return { db: context.db, project: context.project }
}

export function pageOf(context: AssistContext): OpenedPage {
  const opened = projectOf(context)
  const pageId = context.request.pageId
  const page = pageId === null ? null : getPage(opened.db, pageId, opened.project.id)
  if (page === null) {
    throw new AssistInputError('That page was not found.', 'Pick a page, then try again.')
  }
  return { ...opened, page }
}

export function snapshotOf(db: SqliteDatabase, pageId: string): StoredSnapshot {
  const snapshot = getLatestSnapshot(db, pageId)
  if (snapshot === null) {
    throw new AssistInputError('Read the page first.', 'Open Page read and read the page.')
  }
  return snapshot
}

export function profileOf(db: SqliteDatabase, pageId: string, kind?: string): BuyerProfile {
  const topic = kind === 'topic'
  const missing = topic
    ? new AssistInputError(
        'This topic has no buyer profile yet.',
        'Open the topic and add a buyer profile.'
      )
    : new AssistInputError('Write the buyer profile first.', 'Open Audience and write it.')
  let profile: BuyerProfile | null
  try {
    profile = getLatestBuyerProfile(db, pageId)
  } catch (error) {
    if (error instanceof StorageError) throw missing
    throw error
  }
  if (profile === null) throw missing
  return profile
}

export function brandNamesOf(db: SqliteDatabase): string[] {
  return [...(readProjectProfile(db)?.brandNames ?? [])]
}

export function promptSetOf(db: SqliteDatabase, pageId: string): PromptSetView {
  const set = getLatestPromptSet(db, pageId, brandNamesOf(db))
  if (set === null || set.prompts.length === 0) {
    throw new AssistInputError('Write the buyer prompts first.', 'Open Prompts and write them.')
  }
  return set
}

export function findPrompt(set: PromptSetView, promptId: string | null): BuyerPrompt {
  const prompt = promptId === null ? undefined : set.prompts.find((item) => item.id === promptId)
  if (prompt === undefined) {
    throw new AssistInputError('That prompt was not found.', 'Pick a prompt, then try again.')
  }
  return prompt
}

export function marketOf(db: SqliteDatabase, marketId: string): Market {
  const market = getMarket(db, marketId)
  if (market === null) {
    throw new AssistInputError('That market was not found.', 'Pick a market, then try again.')
  }
  return market
}

/** The request's market, else the page's default market. */
export function marketIdOf(context: AssistContext, page: PageSummary): string {
  const marketId = context.request.marketId ?? page.defaultMarketId
  if (marketId === null) {
    throw new AssistInputError('This page has no market yet.', 'Add a market to the page.')
  }
  return marketId
}

export function marketLabel(market: Market): string {
  const place = market.location === null ? '' : ` · ${market.location}`
  return `${market.country} · ${market.language}${place} · ${market.device}`
}

/** The prompt's wording in one market, else its first wording. */
export function promptText(prompt: BuyerPrompt, marketId: string | null): string {
  const variant =
    prompt.variants.find((item) => item.marketId === marketId) ?? prompt.variants[0] ?? null
  return variant?.text ?? prompt.label
}

export function formatPrompt(prompt: BuyerPrompt, marketId: string | null): string {
  return `Prompt ${prompt.position} (id ${prompt.id}; stage ${prompt.intentStage}; source ${prompt.source}; maps to ${prompt.mappedElement}${prompt.enabled ? '' : '; turned off'}): ${promptText(prompt, marketId)}`
}

export function formatPrompts(prompts: readonly BuyerPrompt[], marketId: string | null): string {
  return prompts.map((prompt) => formatPrompt(prompt, marketId)).join('\n')
}

/** Title, meta description, H1, and their lengths. */
export function formatPageHead(page: PageSummary, snapshot: StoredSnapshot): string {
  const sized = (label: string, value: string | null): string =>
    value === null || value.trim().length === 0
      ? `${label}: (none on the page)`
      : `${label} (${value.length} characters): ${value}`
  return [
    // A topic has no single URL; its "page text" is the topic's definition.
    page.url === null ? `Topic: ${page.title ?? page.label ?? ''}` : `Page URL: ${page.url}`,
    `Page read on: ${snapshot.fetchedAt}`,
    `Last modified: ${formatLastModified(snapshot.modifiedAt, snapshot.publishedAt)}`,
    sized('Title', snapshot.title),
    sized('Meta description', snapshot.metaDescription),
    sized('H1', snapshot.h1)
  ].join('\n')
}

/** Outline, FAQs, and the capped body text. */
export function formatPageBody(snapshot: StoredSnapshot, max = ASSIST_PAGE_TEXT_MAX): string {
  return [
    'Outline:',
    formatOutline(snapshot.outline),
    '',
    'FAQs on the page:',
    formatFaqs(snapshot.faqs),
    '',
    `Body (${snapshot.wordCount} words):`,
    capPageText(snapshot.bodyText, max)
  ].join('\n')
}

export function formatProfile(profile: BuyerProfile): string {
  return formatBuyerProfile(profile)
}

/** `loadPageResults` for the latest check, or the next step when there is none. */
export function resultsOf(
  context: AssistContext,
  opened: OpenedPage,
  marketId: string,
  runId: string | null = null
): PageResults {
  const results = loadPageResults(opened.db, {
    projectId: opened.project.id,
    pageId: opened.page.id,
    marketId,
    runId,
    builtAt: context.host.now().toISOString(),
    domain: opened.project.domain,
    keyLabels: new Map(),
    reportsRoot: checkReportsRoot(context.host.storage.paths.root)
  })
  if (results.run === null) {
    throw new AssistInputError(
      'Press Check now first.',
      'Press Check now on this page, then try again.'
    )
  }
  return results
}

/** The check's headline numbers, as plain lines. */
export function formatRun(results: PageResults): string {
  const run = results.run
  if (run === null) return 'No check yet.'
  const [baseline, previous] = results.comparison
  const lines = [
    `Check finished: ${run.finishedAt ?? 'not finished'} (${run.kind}${run.partial ? ', partial' : ''})`,
    `Prompts checked: ${run.promptsChecked}. AI Overviews shown: ${run.promptsWithAio}.`,
    `This page cited: ${run.pageCited}. Another own page cited: ${run.otherOwnPage}. Brand named only: ${run.brandMentioned}. Not cited: ${run.notCited}. No overview: ${run.noAio}. Errors: ${run.errors}.`,
    `Visibility score: ${run.visibilityScore ?? 'none'} (change since previous: ${results.scoreChange.sincePrevious ?? 'no previous check'}; since baseline: ${results.scoreChange.sinceBaseline ?? 'no baseline'}).`,
    `Average position of this page: ${run.averagePosition ?? 'not cited'}.`,
    `Page content changed since the previous check: ${run.contentChanged ? (run.contentChange?.summary ?? 'yes') : 'no'}.`
  ]
  if (previous.runId !== null) {
    lines.push(
      `Previous check: ${previous.finishedAt ?? 'unknown'}, score ${previous.score ?? 'none'}, page cited ${previous.pageCited ?? 0} of ${previous.aiosShown ?? 0} overviews.`
    )
  }
  if (baseline.runId !== null && baseline.runId !== run.runId) {
    lines.push(
      `Baseline check: ${baseline.finishedAt ?? 'unknown'}, score ${baseline.score ?? 'none'}.`
    )
  }
  if (results.runSummary !== null) {
    lines.push(`Stored summary: ${results.runSummary.headline} ${results.runSummary.body}`)
  }
  return lines.join('\n')
}

export function formatRow(row: PromptCheckRow): string {
  const position = row.position === null ? '' : ` at #${row.position}`
  const was =
    row.previousStatus === null
      ? 'no previous check'
      : `was ${statusLabel(row.previousStatus)}${row.previousPosition === null ? '' : ` #${row.previousPosition}`}`
  const cited = row.references
    .slice(0, 6)
    .map((reference) => `#${reference.position} ${reference.domain}`)
    .join(', ')
  const parts = [
    `Prompt ${row.promptPosition} (id ${row.promptId}; ${row.intentStage}): ${row.text}`,
    `  Now: ${statusLabel(row.status)}${position}; ${row.movement ?? 'first check'}; ${was}.`,
    `  Cited in the overview: ${cited.length === 0 ? 'none' : cited}.`
  ]
  if (row.coverage !== null) parts.push(`  Page coverage: ${row.coverage}.`)
  if (row.action !== null) parts.push(`  Saved fix idea: ${row.action}`)
  if (row.aioSummary !== null) parts.push(`  Overview says: ${clip(row.aioSummary, 400)}`)
  return parts.join('\n')
}

export function formatRows(results: PageResults): string {
  if (results.prompts.length === 0) return 'No prompt results.'
  return results.prompts.map(formatRow).join('\n')
}

/** A string input, trimmed and capped. Null when it is missing or empty. */
export function inputText(context: AssistContext, key: string, max = 4000): string | null {
  const value = context.request.inputs[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed.slice(0, max)
}

/** A whole-number input given as a number or digits. Null otherwise. */
export function inputNumber(context: AssistContext, key: string): number | null {
  const value = context.request.inputs[key]
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export function clip(text: string, max: number): string {
  const flat = text.trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`
}

/** YYYY-MM-DD of an ISO timestamp. */
export function day(iso: string | null): string {
  return iso === null ? 'unknown' : iso.slice(0, 10)
}
