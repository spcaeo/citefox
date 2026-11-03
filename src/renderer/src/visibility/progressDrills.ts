import type { PageResults, PromptCheckRow } from '@shared/domain'
import type { DrillItem, DrillRequest, DrillScope, ItemDrill } from '../drill'
import { countNoun, formatStamp, hasAio, hostFromUrl, statusLabel } from '../m3/model'
import type { LiveMarketRow } from './promptHistory'

/**
 * Progress drills (REPORT-SPEC "Interaction model", NFR-14). Every drill
 * here lists exactly the prompt ids it was given, from the check (run) the
 * number belongs to, so the drawer total equals the number clicked even when
 * a prompt has no row in that check.
 */

/** What a prompt is called, from any check that listed it. */
export interface PromptMeta {
  n: number
  label: string
}

/** Copy for a drill: its NFR-14 id, title and Markdown description. */
export interface DrillCopy {
  id: string
  title: string
  description: string
  omitCount?: boolean
}

/** Where the rows come from: this page, one market, one check. */
export interface RunContext {
  pageId: string
  marketId: string | null
  /** The check. Null is the latest check (prompt links follow it). */
  runId: string | null
  marketLabel: string
  meta: ReadonlyMap<string, PromptMeta>
}

/** Prompt numbers and labels from every loaded check, newest wins. */
export function promptMeta(runs: Iterable<PageResults>): Map<string, PromptMeta> {
  const meta = new Map<string, PromptMeta>()
  for (const results of runs) {
    for (const row of results.prompts) {
      meta.set(row.promptId, { n: row.promptPosition, label: row.label })
    }
  }
  return meta
}

/** The ids once each, in the order given. */
export function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)]
}

function plain(label: string): string {
  return label.split('**').join('')
}

/** The drawer scope for a check: its market, its date, the brand and domain it looked for. */
export function runScope(results: PageResults | null | undefined, context: RunContext): DrillScope {
  return {
    pageId: context.pageId,
    marketId: context.marketId,
    runId: context.runId,
    marketLabel: context.marketLabel,
    checkDateLabel: results?.scope.checkedAt ? formatStamp(results.scope.checkedAt) : '',
    brand: results ? (results.scope.brands[0] ?? hostFromUrl(results.scope.pageUrl)) : '',
    domain: results ? hostFromUrl(results.scope.pageUrl) : ''
  }
}

/**
 * The prompts behind a number in one check. When every id has a row in that
 * check it is a prompt drill (rows expand to the overview); otherwise each id
 * still gets a row, marked "No result in this check", so nothing is dropped.
 */
export function runIdsDrill(
  copy: DrillCopy,
  ids: readonly string[],
  results: PageResults | null | undefined,
  context: RunContext
): DrillRequest {
  const unique = uniqueIds(ids)
  const scope = runScope(results, context)
  const byId = new Map<string, PromptCheckRow>(
    (results?.prompts ?? []).map((row) => [row.promptId, row])
  )
  const rows = unique.flatMap((id) => {
    const row = byId.get(id)
    return row ? [row] : []
  })
  if (results && rows.length === unique.length) {
    return { kind: 'prompts', ...copy, rows, scope }
  }
  const missing = unique.length - rows.length
  const items: DrillItem[] = unique.map((id) => {
    const row = byId.get(id)
    const meta = row ? { n: row.promptPosition, label: row.label } : context.meta.get(id)
    return {
      id,
      primary: meta ? `${meta.n}. ${plain(meta.label)}` : 'Question',
      secondary: row
        ? statusLabel(row.status)
        : results
          ? 'No result in this check'
          : 'This check could not be loaded',
      target: {
        kind: 'prompt',
        pageId: context.pageId,
        promptId: id,
        marketId: context.marketId,
        runId: row ? context.runId : null
      },
      group: row ? 'checked' : 'missing'
    }
  })
  const drill: ItemDrill = {
    kind: 'items',
    ...copy,
    noun: ['question', 'questions'],
    primaryLabel: 'Question',
    items,
    summary: [
      { label: 'In this check', group: 'checked' },
      { label: 'No result in this check', group: 'missing' }
    ],
    note: `${countNoun(missing, 'question has', 'questions have')} no result in this check (added later, turned off, or not part of a partial check). They open the latest result instead.`,
    scope
  }
  return drill
}

/** Every prompt the check measured. Its length is the check's "prompts checked". */
export function checkedIds(results: PageResults | null | undefined): string[] {
  return (results?.prompts ?? []).map((row) => row.promptId)
}

/** Prompts with no AI Overview in the check. */
export function noOverviewIds(results: PageResults | null | undefined): string[] {
  return (results?.prompts ?? []).filter((row) => !hasAio(row)).map((row) => row.promptId)
}

/** Prompts with an AI Overview in the check. */
export function overviewIds(results: PageResults | null | undefined): string[] {
  return (results?.prompts ?? []).filter((row) => hasAio(row)).map((row) => row.promptId)
}

/** All markets: one market's checks, each opening Results at that check in that market. */
export function marketChecksDrill(row: LiveMarketRow, pageId: string): ItemDrill {
  return {
    kind: 'items',
    id: `market:${row.id}`,
    title: `${row.name} · checks`,
    description: row.aria,
    noun: ['check', 'checks'],
    primaryLabel: 'Check',
    columns: [{ id: 'score', label: 'Visibility score', align: 'end', width: '136px' }],
    items: row.checks.map((check) => ({
      id: check.id,
      primary: check.label,
      cells: { score: check.value },
      target: { kind: 'page', pageId, tab: 'results', marketId: row.id, runId: check.id }
    })),
    note: 'Select a check to open its results in this market.',
    scope: {
      pageId,
      marketId: row.id,
      runId: null,
      marketLabel: row.name,
      checkDateLabel: '',
      brand: '',
      domain: ''
    }
  }
}
