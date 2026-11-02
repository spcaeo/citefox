import type { AskRow } from '@shared/ipc'
import type { DrillItem, DrillScope, DrillTarget, ItemDrill } from '../../drill'
import { movementLabel, stageLabel, statusLabel } from '../../m3/model'
import { checkedDay, positionText } from './format'

/**
 * Ask CiteFox drill-downs (REPORT-SPEC "Interaction model"). The answer's
 * counts open exactly the matched rows: prompt checks open Prompt detail in
 * their market, pages open their Results in that market.
 */

const SCOPE: DrillScope = {
  pageId: null,
  marketId: null,
  runId: null,
  marketLabel: '',
  checkDateLabel: 'Latest check per page and market',
  brand: '',
  domain: ''
}

/**
 * The project the answer was asked in. Row links name it, so a row always
 * opens in its own project (a project route switches first when it is not
 * the open one). Null: the open project.
 */
export type AskProject = string | null

/** Prompt detail for this row, in the row's market (latest check there). */
export function rowPromptTarget(row: AskRow, projectId: AskProject = null): DrillTarget {
  return {
    kind: 'prompt',
    pageId: row.pageId,
    promptId: row.promptId,
    marketId: row.marketId,
    projectId
  }
}

/** The row's page Results, in the row's market. */
export function rowPageTarget(row: AskRow, projectId: AskProject = null): DrillTarget {
  return { kind: 'page', pageId: row.pageId, tab: 'results', marketId: row.marketId, projectId }
}

function checkItem(row: AskRow, projectId: AskProject): DrillItem {
  return {
    id: `${row.pageId}|${row.marketId}|${row.promptId}`,
    primary: row.promptText,
    secondary: `${row.pageLabel} · ${row.marketLabel} · ${stageLabel(row.intentStage)}`,
    target: rowPromptTarget(row, projectId),
    cells: {
      status: statusLabel(row.status),
      position: positionText(row.position),
      change: row.movement ? movementLabel(row.movement) : '—',
      checked: checkedDay(row.checkedAt)
    },
    detail:
      row.citedDomains.length === 0
        ? 'The overview cited no domains.'
        : `Cited domains, in order: ${row.citedDomains.join(', ')}`,
    group: row.status
  }
}

const CHECK_COLUMNS = [
  { id: 'status', label: 'Status', width: '120px' },
  { id: 'position', label: 'Position', align: 'end' as const, width: '72px' },
  { id: 'change', label: 'Change', width: '96px' },
  { id: 'checked', label: 'Checked', width: '96px' }
]

/** The matched prompt checks shown in the answer, one row each. */
export function askChecksDrill(
  rows: readonly AskRow[],
  total: number,
  projectId: AskProject = null
): ItemDrill {
  const more = total > rows.length
  return {
    kind: 'items',
    id: 'ask:checks',
    title: 'Matching question checks',
    description: more
      ? `The first ${rows.length} of ${total.toLocaleString('en-US')} question checks that match these filters, from each page's latest check in each market.`
      : "Every question check that matches these filters, from each page's latest check in each market.",
    noun: ['question check', 'question checks'],
    primaryLabel: 'Question',
    columns: CHECK_COLUMNS,
    items: rows.map((row) => checkItem(row, projectId)),
    note: 'Select a question to open its detail in that market. Expand it to see the cited domains.',
    scope: SCOPE
  }
}

/** The matched rows that cite one domain. */
export function askDomainDrill(
  rows: readonly AskRow[],
  domain: string,
  projectId: AskProject = null
): ItemDrill {
  const matched = rows.filter((row) => row.citedDomains.includes(domain))
  return {
    kind: 'items',
    id: `ask:domain:${domain}`,
    title: `Question checks citing ${domain}`,
    description: `Matching question checks whose AI Overview cited ${domain}.`,
    noun: ['question check', 'question checks'],
    primaryLabel: 'Question',
    columns: CHECK_COLUMNS,
    items: matched.map((row) => checkItem(row, projectId)),
    note: 'Select a question to open its detail in that market.',
    scope: SCOPE
  }
}

/** The distinct pages among the matched rows, each with its match count. */
export function askPagesDrill(rows: readonly AskRow[], projectId: AskProject = null): ItemDrill {
  const pages = new Map<string, { first: AskRow; count: number; markets: Set<string> }>()
  for (const row of rows) {
    const entry = pages.get(row.pageId)
    if (entry) {
      entry.count += 1
      entry.markets.add(row.marketLabel)
    } else {
      pages.set(row.pageId, { first: row, count: 1, markets: new Set([row.marketLabel]) })
    }
  }
  const items: DrillItem[] = [...pages.values()].map(({ first, count, markets }) => ({
    id: first.pageId,
    primary: first.pageLabel,
    secondary: first.pageUrl,
    target:
      markets.size === 1
        ? rowPageTarget(first, projectId)
        : { kind: 'page', pageId: first.pageId, tab: 'results', projectId },
    cells: { matches: count, markets: [...markets].join(', ') }
  }))
  return {
    kind: 'items',
    id: 'ask:pages',
    title: 'Pages in this answer',
    description: 'The pages the matching question checks belong to.',
    noun: ['page', 'pages'],
    primaryLabel: 'Page',
    columns: [
      { id: 'matches', label: 'Matches', align: 'end', width: '72px' },
      { id: 'markets', label: 'Markets', width: 'minmax(96px, 0.8fr)' }
    ],
    items,
    note: "Select a page to open its Results (in the match's market when there is one).",
    scope: SCOPE
  }
}

/** The distinct markets among the matched rows, each expanding to its prompts. */
export function askMarketsDrill(rows: readonly AskRow[], projectId: AskProject = null): ItemDrill {
  const markets = new Map<string, { label: string; rows: AskRow[] }>()
  for (const row of rows) {
    const entry = markets.get(row.marketId)
    if (entry) entry.rows.push(row)
    else markets.set(row.marketId, { label: row.marketLabel, rows: [row] })
  }
  const items: DrillItem[] = [...markets.entries()].map(([marketId, entry]) => {
    const pageIds = new Set(entry.rows.map((row) => row.pageId))
    const only = entry.rows[0]
    return {
      id: marketId,
      primary: entry.label,
      target: pageIds.size === 1 && only ? rowPageTarget(only, projectId) : null,
      cells: { matches: entry.rows.length, pages: pageIds.size },
      detail: entry.rows
        .map((row) => `- ${row.pageLabel}: ${row.promptText} (${statusLabel(row.status)})`)
        .join('\n')
    }
  })
  return {
    kind: 'items',
    id: 'ask:markets',
    title: 'Markets in this answer',
    description: 'The markets the matching question checks come from.',
    noun: ['market', 'markets'],
    primaryLabel: 'Market',
    columns: [
      { id: 'matches', label: 'Matches', align: 'end', width: '72px' },
      { id: 'pages', label: 'Pages', align: 'end', width: '64px' }
    ],
    items,
    note: 'Expand a market to see its matching questions.',
    scope: SCOPE
  }
}
