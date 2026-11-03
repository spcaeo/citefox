import { intervalDaysText, type DueList, type Market, type PageResults } from '@shared/domain'
import type { AllPageRow, UntrackedCitation, WrongPageCase } from '@shared/ipc'
import {
  promptTarget,
  resultsDrill,
  resultsScope,
  whereDrill,
  type DrillItem,
  type DrillScope,
  type ItemDrill,
  type PromptDrill
} from '../../drill'
import { countNoun, displayUrl } from '../../m3/model'
import { marketLabel } from '../../shell/model'
import { formatMoment } from '../../utils/dates'
import { pathOf } from './format'
import { rowName } from './text'

/** The page grid numbers that open a drawer of the page's latest default-market check. */
export type PageDrillKind = 'cited' | 'links' | 'score'

/** `data-nfr-drill` id for one page's grid number. */
export function pageDrillId(kind: PageDrillKind, pageId: string): string {
  return `allpages:${kind}:${pageId}`
}

/** A scope with no page: rows that name their own page and market link themselves. */
export function projectScope(domain: string): DrillScope {
  return {
    pageId: null,
    marketId: null,
    runId: null,
    marketLabel: '',
    checkDateLabel: '',
    brand: '',
    domain
  }
}

/**
 * The drawer behind one page's Page cited, Links to this page or Score cell. `results`
 * is that page's check from `row.runId`, so the total equals the cell.
 */
export function pageDrill(
  kind: PageDrillKind,
  row: AllPageRow,
  results: PageResults,
  market: Market | null
): PromptDrill | ItemDrill {
  const scope = resultsScope(results, {
    pageId: row.id,
    market,
    runId: row.runId ?? null
  })
  const name = rowName(row)
  const id = pageDrillId(kind, row.id)
  if (kind === 'cited') {
    return whereDrill(
      results,
      {
        id,
        title: `Page cited · ${name}`,
        description: `Questions whose AI Overview links ${pathOf(row.url)}, of the ${countNoun(row.aioPrompts ?? 0, 'question', 'questions')} with an overview in this check.`
      },
      (prompt) => prompt.status === 'page_cited',
      scope
    )
  }
  if (kind === 'links') return pageLinksDrill(results, scope, id, name)
  const scored = resultsDrill(results, 'kpi:score', scope)
  const drill: PromptDrill = scored ?? {
    kind: 'prompts',
    id,
    title: 'Scored questions',
    description: '',
    rows: [],
    scope
  }
  return {
    ...drill,
    id,
    title: `Score ${row.score ?? '—'} · ${name}`,
    description: `${drill.description} Open the page's Progress tab to see how the score moved.`
  }
}

/**
 * Links to this page in the check, one row per link. Counted like the engine
 * counts `citationsThisPage`: each URL once per overview.
 */
export function pageLinksDrill(
  results: PageResults,
  scope: DrillScope,
  id: string,
  name: string
): ItemDrill {
  const items: DrillItem[] = []
  for (const prompt of results.prompts) {
    const seen = new Set<string>()
    for (const ref of prompt.references) {
      if (ref.classification !== 'target' || seen.has(ref.normalizedUrl)) continue
      seen.add(ref.normalizedUrl)
      items.push({
        id: `${prompt.promptId}:${ref.id}`,
        primary: displayUrl(ref.url),
        mono: true,
        url: ref.url,
        secondary: `Question ${prompt.promptPosition} · ${prompt.label.split('**').join('')}`,
        target: promptTarget(scope, prompt),
        cells: { position: ref.position }
      })
    }
  }
  return {
    kind: 'items',
    id,
    title: `Links to ${name}`,
    description:
      'Every link to this page in the AI Overviews of this check, one row per link. Select a row to open its question.',
    noun: ['link', 'links'],
    primaryLabel: 'Link',
    columns: [{ id: 'position', label: 'Position', align: 'end', width: '72px' }],
    items,
    note: "Position is where the link sits in the overview's sources (1 = first).",
    scope
  }
}

/** FR-20.4. Every wrong-page case, grouped by tracked page in the summary strip. */
export function wrongPageDrill(
  cases: readonly WrongPageCase[],
  markets: ReadonlyMap<string, Market>,
  domain: string
): ItemDrill {
  const pages = new Map<string, string>()
  const items = cases.map((item): DrillItem => {
    pages.set(item.pageId, item.pageLabel)
    const market = markets.get(item.marketId)
    return {
      id: item.id,
      primary: `“${item.promptLabel}”`,
      secondary: `${item.pageLabel} → Google cites ${pathOf(item.citedUrl)}`,
      target: {
        kind: 'prompt',
        pageId: item.pageId,
        promptId: item.promptId,
        marketId: item.marketId,
        runId: item.runId
      },
      cells: {
        market: market ? marketLabel(market) : item.marketId,
        position: item.position === null ? null : Math.round(item.position),
        checked: item.checkedAt ? formatMoment(item.checkedAt) : null
      },
      group: item.pageId
    }
  })
  return {
    kind: 'items',
    id: 'allpages:wrong-page',
    title: 'Wrong page cited',
    description:
      'Questions where the AI Overview cites another of your pages instead of the tracked page, latest check in each market. Select a row to open that question in that market and check.',
    noun: ['case', 'cases'],
    primaryLabel: 'Question',
    columns: [
      { id: 'market', label: 'Market', width: '120px' },
      { id: 'position', label: 'Position', align: 'end', width: '72px' },
      { id: 'checked', label: 'Checked', width: '96px' }
    ],
    items,
    summary: [...pages.entries()].map(([group, label]) => ({ label, group })),
    scope: projectScope(domain)
  }
}

/** FR-20.5. The citations behind "cited N times for M tracked pages". */
export function untrackedDrill(
  item: UntrackedCitation,
  markets: ReadonlyMap<string, Market>,
  domain: string
): ItemDrill {
  const pages = new Map<string, string>()
  const items = item.refs.map((ref, index): DrillItem => {
    pages.set(ref.pageId, ref.pageLabel)
    const market = markets.get(ref.marketId)
    return {
      id: `${ref.pageId}|${ref.marketId}|${ref.promptId}|${index}`,
      primary: `Question ${ref.promptPosition} · ${ref.promptLabel.split('**').join('')}`,
      secondary: `For ${ref.pageLabel}`,
      target: {
        kind: 'prompt',
        pageId: ref.pageId,
        promptId: ref.promptId,
        marketId: ref.marketId,
        runId: ref.runId
      },
      cells: {
        market: market ? marketLabel(market) : ref.marketId,
        position: ref.position
      },
      group: ref.pageId
    }
  })
  const path = pathOf(item.url)
  return {
    kind: 'items',
    id: untrackedDrillId(item),
    title: `Citations of ${path}`,
    description: `Questions of your tracked pages whose AI Overview cites ${path}, one row per citation, latest check in each market. ${countNoun(item.citedFor, 'tracked page', 'tracked pages')}.`,
    noun: ['citation', 'citations'],
    primaryLabel: 'Question',
    columns: [
      { id: 'market', label: 'Market', width: '120px' },
      { id: 'position', label: 'Position', align: 'end', width: '72px' }
    ],
    items,
    summary: [...pages.entries()].map(([group, label]) => ({ label, group })),
    scope: projectScope(domain)
  }
}

export function untrackedDrillId(item: UntrackedCitation): string {
  return `allpages:untracked:${item.normalizedUrl}`
}

/**
 * Pages due today (`schedule:listDue`), one row per page. A page due in two
 * markets, or for a fix follow-up too, is one row.
 */
export function dueDrill(
  due: DueList,
  markets: ReadonlyMap<string, Market>,
  domain: string
): ItemDrill {
  const byPage = new Map<string, DrillItem>()
  for (const page of due.pages) {
    const current = byPage.get(page.pageId)
    const names = page.marketIds.map((id) => {
      const market = markets.get(id)
      return market ? marketLabel(market) : id
    })
    if (current) {
      const before = String(current.cells?.markets ?? '')
      const merged = [...new Set([...before.split(', ').filter(Boolean), ...names])]
      byPage.set(page.pageId, {
        ...current,
        cells: { ...current.cells, markets: merged.join(', ') }
      })
      continue
    }
    byPage.set(page.pageId, {
      id: page.pageId,
      primary: page.label ?? page.title ?? pathOf(page.url),
      secondary: pathOf(page.url),
      target: { kind: 'page', pageId: page.pageId },
      cells: {
        markets: names.join(', '),
        reason: page.reason === 'follow_up' ? 'Fix follow-up' : 'Scheduled',
        every: intervalDaysText(page.intervalDays)
      }
    })
  }
  return {
    kind: 'items',
    id: 'allpages:due-today',
    title: 'Pages due today',
    description:
      'Pages the scheduler checks today, from the tray during the day. Select a page to open its results.',
    noun: ['page', 'pages'],
    primaryLabel: 'Page',
    columns: [
      { id: 'markets', label: 'Markets', width: 'minmax(96px, 0.8fr)' },
      { id: 'reason', label: 'Why', width: '108px' },
      { id: 'every', label: 'Interval', width: '84px' }
    ],
    items: [...byPage.values()],
    note: 'Use Check now to run them all at once instead of waiting for the tray.',
    scope: projectScope(domain)
  }
}
