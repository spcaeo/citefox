import type { Market, PageResults, PromptCheckRow } from '@shared/domain'
import {
  brandName,
  displayUrl,
  drillFor,
  formatDay,
  ownDomain,
  rowsFor,
  type DrillSpec
} from '../m3/model'
import { marketLabel } from '../shell/model'
import { promptTarget } from './targets'
import type { DrillItem, DrillScope, ItemDrill, PromptDrill } from './types'

/** The drawer scope for one page's results in one market and check. */
export function resultsScope(
  results: PageResults,
  options: {
    pageId: string | null
    market?: Market | null
    /** The check the route pinned. Null: prompt links follow the latest check. */
    runId?: string | null
  }
): DrillScope {
  return {
    pageId: options.pageId,
    marketId: results.run?.marketId ?? options.market?.id ?? null,
    runId: options.runId ?? null,
    marketLabel: options.market ? marketLabel(options.market) : '',
    checkDateLabel: formatDay(results.scope.checkedAt),
    brand: brandName(results),
    domain: ownDomain(results)
  }
}

/** A prompt drill from a `DrillSpec`. Its rows are the spec's prompts in this check. */
export function specDrill(results: PageResults, spec: DrillSpec, scope: DrillScope): PromptDrill {
  return {
    kind: 'prompts',
    id: spec.id,
    title: spec.title,
    description: spec.description,
    omitCount: spec.omitCount,
    rows: rowsFor(results, spec.promptIds),
    scope
  }
}

/**
 * A Results drill by id (`funnel:…`, `drop:…`, `bucket:…`, `kpi:…`, `domain:…`,
 * `gap:…`, `overlap:…`, `stage:…`, `ugc`, …). Null for an id the results don't have.
 */
export function resultsDrill(
  results: PageResults,
  id: string,
  scope: DrillScope
): PromptDrill | null {
  const spec = drillFor(results, id)
  return spec ? specDrill(results, spec, scope) : null
}

/** Prompts by id, with a title of your own. */
export function idsDrill(
  results: PageResults,
  copy: { id: string; title: string; description: string },
  ids: readonly string[],
  scope: DrillScope
): PromptDrill {
  return { kind: 'prompts', ...copy, rows: rowsFor(results, ids), scope }
}

/** Prompts that pass a test, with a title of your own. */
export function whereDrill(
  results: PageResults,
  copy: { id: string; title: string; description: string },
  test: (row: PromptCheckRow) => boolean,
  scope: DrillScope
): PromptDrill {
  return { kind: 'prompts', ...copy, rows: results.prompts.filter(test), scope }
}

export type OwnLinkPart = 'all' | 'this_page' | 'other_own'

/**
 * Own-domain links (citations) in this check: one row per link, so the
 * drawer total is links, not prompts. Each row opens the prompt it is in.
 * `prompts` limits it to some prompts (one PromptGrid row).
 */
export function ownLinksDrill(
  results: PageResults,
  scope: DrillScope,
  options: { part?: OwnLinkPart; id?: string; prompts?: readonly PromptCheckRow[] } = {}
): ItemDrill {
  const part = options.part ?? 'all'
  const domain = ownDomain(results)
  const items: DrillItem[] = []
  for (const prompt of options.prompts ?? results.prompts) {
    for (const ref of prompt.references) {
      const group =
        ref.classification === 'target'
          ? 'this_page'
          : ref.classification === 'own'
            ? 'other_own'
            : null
      if (!group || (part !== 'all' && part !== group)) continue
      items.push({
        id: `${prompt.promptId}:${ref.id}`,
        primary: displayUrl(ref.url),
        mono: true,
        url: ref.url,
        secondary: `Question ${prompt.promptPosition} · ${prompt.label.split('**').join('')}`,
        target: promptTarget(scope, prompt),
        cells: {
          where: group === 'this_page' ? 'This page' : 'Your other page',
          position: ref.position
        },
        group
      })
    }
  }
  const title =
    part === 'this_page'
      ? 'Links to this page'
      : part === 'other_own'
        ? `Links to other ${domain} pages`
        : `Citations to ${domain}`
  return {
    kind: 'items',
    id: options.id ?? (part === 'all' ? 'links:own' : `links:${part}`),
    title,
    description:
      part === 'all'
        ? `Every ${domain} link in these AI Overviews, one row per link. An overview can link more than one ${domain} page.`
        : `Every link to ${part === 'this_page' ? 'this page' : `another ${domain} page`} in these AI Overviews.`,
    noun: ['link', 'links'],
    primaryLabel: 'Link',
    columns: [
      { id: 'where', label: 'Points to', width: '120px' },
      { id: 'position', label: 'Position', align: 'end', width: '72px' }
    ],
    items,
    ...(part === 'all'
      ? {
          summary: [
            { label: 'To this page', group: 'this_page' },
            { label: `To other ${domain} pages`, group: 'other_own' }
          ]
        }
      : {}),
    note: `Select a link's question to see that overview. Position is where the link sits in the overview's sources (1 = first).`,
    scope
  }
}
