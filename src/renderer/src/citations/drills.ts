import type { Market } from '@shared/domain'
import type { CitedQuestionRef } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import type { DrillScope, DrillTarget, ItemDrill } from '../drill'
import { marketLabel } from '../shell/model'
import { rowName, type CitedListRow } from './model'

/**
 * The drills behind the Citations numbers: a row's questions, markets, overviews
 * and (a domain's) pages. Each list is the row's own data, so the drawer total
 * equals the number clicked. Pure.
 */

export interface CitedDrillScope {
  brand: string
  domain: string
  markets: ReadonlyMap<string, Market>
}

function scopeOf(scope: CitedDrillScope): DrillScope {
  return {
    pageId: null,
    marketId: null,
    runId: null,
    marketLabel: 'All markets',
    checkDateLabel: 'Latest checks',
    brand: scope.brand,
    domain: scope.domain
  }
}

function marketName(scope: CitedDrillScope, id: string): string {
  const market = scope.markets.get(id)
  return market ? marketLabel(market) : id
}

/** Prompt detail for a question, in the market and check it was cited in. */
export function questionTarget(
  item: Pick<CitedQuestionRef, 'pageId' | 'promptId' | 'marketId' | 'runId'>
): DrillTarget {
  return {
    kind: 'prompt',
    pageId: item.pageId,
    promptId: item.promptId,
    marketId: item.marketId,
    runId: item.runId
  }
}

/** Where a question belongs: its page, or `Topic · name`. */
export function questionSource(item: Pick<CitedQuestionRef, 'pageKind' | 'pageLabel'>): string {
  return item.pageKind === 'topic' ? `Topic · ${item.pageLabel}` : item.pageLabel
}

/** The questions whose latest overview cites the row (the Questions cell). */
export function questionsDrill(row: CitedListRow, scope: CitedDrillScope): ItemDrill {
  const name = rowName(row)
  return {
    kind: 'items',
    id: `cit:questions:${row.id}`,
    title: `Searches citing ${name}`,
    description: `Searches whose latest AI Overview cites ${name}, every market together.`,
    noun: ['search', 'searches'],
    primaryLabel: 'Search',
    columns: [
      { id: 'markets', label: 'Markets', align: 'end', width: 'minmax(72px, 0.3fr)' },
      { id: 'position', label: 'Best', align: 'end', width: 'minmax(64px, 0.3fr)' }
    ],
    items: row.questions.map((item) => ({
      id: item.id,
      primary: item.promptText,
      secondary: questionSource(item),
      target: questionTarget(item),
      cells: { markets: item.marketIds.length, position: `#${item.position}` }
    })),
    scope: scopeOf(scope)
  }
}

/** The markets with an overview citing the row (the Markets cell). */
export function marketsDrill(row: CitedListRow, scope: CitedDrillScope): ItemDrill {
  const name = rowName(row)
  return {
    kind: 'items',
    id: `cit:markets:${row.id}`,
    title: `Markets citing ${name}`,
    description: `Markets where the latest AI Overviews cite ${name}.`,
    noun: ['market', 'markets'],
    primaryLabel: 'Market',
    columns: [
      { id: 'questions', label: 'Searches', align: 'end', width: 'minmax(84px, 0.3fr)' },
      { id: 'overviews', label: 'AI Overviews', align: 'end', width: 'minmax(84px, 0.3fr)' }
    ],
    items: row.marketIds.map((id) => ({
      id,
      primary: marketName(scope, id),
      cells: {
        questions: row.questions.filter((item) => item.marketIds.includes(id)).length,
        overviews: row.overviews.filter((item) => item.marketId === id).length
      }
    })),
    scope: scopeOf(scope)
  }
}

/** Every overview citing the row, once each (the Overviews cell). */
export function overviewsDrill(row: CitedListRow, scope: CitedDrillScope): ItemDrill {
  const name = rowName(row)
  const questions = new Map(row.questions.map((item) => [item.id, item]))
  return {
    kind: 'items',
    id: `cit:overviews:${row.id}`,
    title: `AI Overviews citing ${name}`,
    description: `Each search’s latest AI Overview in each market that cites ${name}: ${pluralize(row.questions.length, 'search', 'searches')} in all.`,
    noun: ['AI Overview', 'AI Overviews'],
    primaryLabel: 'Search',
    columns: [
      { id: 'market', label: 'Market', width: 'minmax(96px, 0.5fr)' },
      { id: 'position', label: 'Position', align: 'end', width: 'minmax(72px, 0.3fr)' }
    ],
    items: row.overviews.map((item) => {
      const question = questions.get(item.questionId)
      return {
        id: item.id,
        primary: question?.promptText ?? item.questionId,
        secondary: question ? questionSource(question) : null,
        target: question
          ? questionTarget({ ...question, marketId: item.marketId, runId: item.runId })
          : null,
        cells: { market: marketName(scope, item.marketId), position: `#${item.position}` }
      }
    }),
    note: 'Select an AI Overview to open its search on that check.',
    scope: scopeOf(scope)
  }
}

/** A domain row's cited pages (the Pages cell). */
export function pagesDrill(row: CitedListRow, scope: CitedDrillScope): ItemDrill {
  return {
    kind: 'items',
    id: `cit:pages:${row.id}`,
    title: `Pages cited on ${row.domain}`,
    description: `Pages on ${row.domain} that the latest AI Overviews cite.`,
    noun: ['page', 'pages'],
    primaryLabel: 'Page',
    columns: [
      { id: 'questions', label: 'Searches', align: 'end', width: 'minmax(84px, 0.3fr)' },
      { id: 'overviews', label: 'AI Overviews', align: 'end', width: 'minmax(84px, 0.3fr)' }
    ],
    items: row.pages.map((page) => ({
      id: page.id,
      primary: page.url,
      mono: true,
      url: page.url,
      secondary: page.title,
      cells: { questions: page.questions.length, overviews: page.overviews.length }
    })),
    scope: scopeOf(scope)
  }
}
