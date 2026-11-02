import { fixKindLabel } from '@shared/domain'
import { changeStatusLabel } from '@shared/fix-loop'
import type { FixQuestion } from '@shared/fix-verdict'
import type { ChangeCheck, ChangeLedger, ChangeRow } from '@shared/ipc'
import {
  drillCount,
  drillNoun,
  type DrillItem,
  type DrillRequest,
  type DrillScope,
  type ItemDrill,
  type PromptDrill
} from '../drill'
import { pathOf } from '../fixes/model'
import type { GridCellDrill } from '../grid/types'
import { countNoun } from '../m3/model'
import { changeRowHash } from '../fixes/views'
import { marketLabel } from '../shell/model'
import { formatDay } from '../utils/dates'
import { citedRows, daysLabel, INDEX_LABELS, indexBucket, topSpotRows } from './model'

/**
 * Drills for the loop views. Prompt drills list a check's rows (the number shown
 * is their count); page drills list ledger rows that open the change's detail.
 */

type LedgerContext = Pick<ChangeLedger, 'markets' | 'brand' | 'domain'>

/** The drawer scope for one stored check of a page. */
export function checkScope(ledger: LedgerContext, pageId: string, check: ChangeCheck): DrillScope {
  const market = ledger.markets.find((item) => item.id === check.marketId)
  return {
    pageId,
    marketId: check.marketId,
    runId: check.runId,
    marketLabel: market ? marketLabel(market) : '',
    checkDateLabel: formatDay(check.checkedAt),
    brand: ledger.brand,
    domain: ledger.domain
  }
}

/** The scope of a list of pages: no single page, market or check. */
export function pagesScope(ledger: LedgerContext): DrillScope {
  return {
    pageId: null,
    marketId: null,
    runId: null,
    marketLabel: '',
    checkDateLabel: '',
    brand: ledger.brand,
    domain: ledger.domain
  }
}

/** Questions that cited the page in the check before go-live, or in the latest check. Null without that check. */
export function citedDrill(
  ledger: LedgerContext,
  row: ChangeRow,
  which: 'before' | 'now'
): PromptDrill | null {
  const check = which === 'before' ? row.before : row.now
  if (!check) return null
  const path = pathOf(row.url)
  return {
    kind: 'prompts',
    id: `change:${row.fixId}:${which}`,
    title: which === 'before' ? `Cited before the change · ${path}` : `Cited now · ${path}`,
    description:
      which === 'before'
        ? `Questions that cited this page in the last full check before the change went live, on ${formatDay(check.checkedAt)}.`
        : `Questions that cite this page in the latest full check, on ${formatDay(check.checkedAt)}.`,
    rows: citedRows(check),
    scope: checkScope(ledger, row.pageId, check)
  }
}

/** Questions where the page is the first source listed in the latest check. */
export function topSpotsDrill(ledger: LedgerContext, row: ChangeRow): PromptDrill | null {
  if (!row.now) return null
  return {
    kind: 'prompts',
    id: `change:${row.fixId}:top`,
    title: `#1 spots · ${pathOf(row.url)}`,
    description: 'Questions where this page is the first source the AI Overview lists.',
    rows: topSpotRows(row.now),
    scope: checkScope(ledger, row.pageId, row.now)
  }
}

/** One page of the ledger as a drawer row: it opens the change's detail. */
export function pageItem(row: ChangeRow): DrillItem {
  return {
    id: row.fixId,
    primary: pathOf(row.url),
    mono: true,
    url: row.url,
    secondary: row.title,
    target: { kind: 'hash', hash: changeRowHash(row.fixId) },
    cells: {
      kind: fixKindLabel(row.kind),
      days: daysLabel(row.daysLive),
      cited: citedRows(row.now).length,
      index: INDEX_LABELS[indexBucket(row)],
      status: changeStatusLabel(row.status)
    }
  }
}

const PAGE_COLUMNS = [
  { id: 'kind', label: 'Kind', width: 'minmax(72px, 0.5fr)' },
  { id: 'days', label: 'Days live', align: 'end' as const, width: 'minmax(72px, 0.5fr)' },
  { id: 'cited', label: 'Cited now', align: 'end' as const, width: 'minmax(64px, 0.4fr)' },
  { id: 'index', label: 'Google index', width: 'minmax(88px, 0.6fr)' },
  { id: 'status', label: 'Status', width: 'minmax(88px, 0.6fr)' }
]

/** Pages behind a number, each opening its change's detail. */
export function pagesDrill(
  ledger: LedgerContext,
  rows: readonly ChangeRow[],
  copy: { id: string; title: string; description: string },
  summary?: {
    groupOf: (row: ChangeRow) => string
    parts: readonly { label: string; group: string }[]
  }
): ItemDrill {
  return {
    kind: 'items',
    ...copy,
    noun: ['page', 'pages'],
    primaryLabel: 'Page',
    columns: PAGE_COLUMNS,
    items: rows.map((row) => ({
      ...pageItem(row),
      ...(summary ? { group: summary.groupOf(row) } : {})
    })),
    ...(summary ? { summary: summary.parts } : {}),
    scope: pagesScope(ledger)
  }
}

/** A list-grid cell that opens `drill`. Null (a plain cell) without one. */
export function drillCell(
  open: (drill: DrillRequest) => void,
  drill: DrillRequest | null,
  label?: string
): GridCellDrill | null {
  if (!drill) return null
  const [one, many] = drillNoun(drill)
  return {
    label: label ?? `${countNoun(drillCount(drill), one, many)}: ${drill.title}`,
    onOpen: () => open(drill),
    nfrId: drill.id
  }
}

/** Which of a fix's searches a drill lists. */
export type FixQuestionList = 'won' | 'lost' | 'before' | 'now' | 'measured'

const QUESTION_COLUMNS = [
  { id: 'from', label: 'Asked by', width: 'minmax(96px, 0.8fr)' },
  { id: 'before', label: 'Before', width: 'minmax(80px, 0.5fr)' },
  { id: 'now', label: 'Now', width: 'minmax(80px, 0.5fr)' }
]

function stateCell(check: FixQuestion['before']): string {
  if (!check) return 'Not checked'
  if (!check.cited) return 'Not cited'
  return check.position === null ? 'Cited' : `Cited #${check.position}`
}

const QUESTION_COPY: Readonly<Record<FixQuestionList, { title: string; description: string }>> = {
  won: {
    title: 'Searches won',
    description: 'Searches that did not cite this page before the fix went live and cite it now.'
  },
  lost: {
    title: 'Searches lost',
    description: 'Searches that cited this page before the fix went live and do not now.'
  },
  before: {
    title: 'Cited before the fix',
    description: 'The fix’s searches that cited this page in the last check before it went live.'
  },
  now: {
    title: 'Cited now',
    description: 'The fix’s searches that cite this page in the latest check since it went live.'
  },
  measured: {
    title: 'Searches measured',
    description:
      'The fix’s searches checked since it went live. Each opens in the check it is from.'
  }
}

/**
 * A fix's searches behind a verdict number. Each row opens the search in the check it
 * is from (its page's or topic's), so a topic search opens the topic's result.
 */
export function fixQuestionsDrill(
  ledger: LedgerContext,
  row: Pick<ChangeRow, 'fixId' | 'url'>,
  which: FixQuestionList,
  questions: readonly FixQuestion[]
): ItemDrill {
  const copy = QUESTION_COPY[which]
  return {
    kind: 'items',
    id: `change:${row.fixId}:${which}`,
    title: `${copy.title} · ${pathOf(row.url)}`,
    description: copy.description,
    noun: ['search', 'searches'],
    primaryLabel: 'Search',
    columns: QUESTION_COLUMNS,
    items: questions.map((question) => {
      const check = question.now ?? question.before
      return {
        id: question.promptId,
        primary: question.text || question.label,
        secondary: question.label,
        target: {
          kind: 'prompt' as const,
          pageId: question.sourceId,
          promptId: question.promptId,
          marketId: question.marketId || null,
          runId: check?.runId ?? null
        },
        cells: {
          from: question.sourceName,
          before: stateCell(question.before),
          now: stateCell(question.now)
        }
      }
    }),
    scope: pagesScope(ledger)
  }
}
