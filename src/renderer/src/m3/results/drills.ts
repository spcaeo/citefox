import { useMemo } from 'react'
import type { Market, PageResults, PromptCheckRow } from '@shared/domain'
import {
  ownLinksDrill,
  promptTarget,
  resultsDrill,
  resultsScope,
  type DrillItem,
  type DrillScope,
  type DrillTarget,
  type ItemDrill,
  type OwnLinkPart,
  type PromptDrill
} from '../../drill'
import { displayUrl } from '../model'

/** Every drill the Results screens need, built once per results payload. */
export interface ResultsDrills {
  scope: DrillScope
  /** A `drillFor` id (`funnel:…`, `bucket:…`, `domain:…`, `stage:x:page`, `named`, …). */
  get: (id: string) => PromptDrill | null
  /** Own-domain links, one row per link. `prompts` limits it to some prompts. */
  links: (part?: OwnLinkPart, prompts?: readonly PromptCheckRow[], id?: string) => ItemDrill
  /** Where a domain sits in each overview that cites it. */
  positions: (domain: string) => ItemDrill | null
  /** Prompt detail for one prompt in this market and check. */
  prompt: (row: PromptCheckRow) => DrillTarget | null
}

export function buildResultsDrills(results: PageResults, scope: DrillScope): ResultsDrills {
  const cache = new Map<string, PromptDrill | null>()
  return {
    scope,
    get: (id) => {
      if (!cache.has(id)) cache.set(id, resultsDrill(results, id, scope))
      return cache.get(id) ?? null
    },
    links: (part = 'all', prompts, id) =>
      ownLinksDrill(results, scope, {
        part,
        ...(prompts ? { prompts } : {}),
        ...(id ? { id } : {})
      }),
    positions: (domain) => {
      const items: DrillItem[] = []
      for (const row of results.prompts) {
        const refs = row.references.filter((ref) => ref.domain === domain)
        const first = refs[0]
        if (!first) continue
        items.push({
          id: row.promptId,
          primary: `Question ${row.promptPosition} · ${row.label.split('**').join('')}`,
          secondary: refs.map((ref) => displayUrl(ref.url)).join(' · '),
          target: promptTarget(scope, row),
          cells: { position: first.position, links: refs.length }
        })
      }
      if (items.length === 0) return null
      items.sort((a, b) => Number(a.cells?.position ?? 0) - Number(b.cells?.position ?? 0))
      return {
        kind: 'items',
        id: `positions:${domain}`,
        title: `Where ${domain} sits`,
        description: `Each AI Overview that cites ${domain}, by its highest source position (1 = first).`,
        noun: ['question', 'questions'],
        primaryLabel: 'Question',
        columns: [
          { id: 'position', label: 'Position', align: 'end', width: '72px' },
          { id: 'links', label: 'Links', align: 'end', width: '56px' }
        ],
        items,
        note: 'Select a question to open its sources.',
        scope
      }
    },
    prompt: (row) => promptTarget(scope, row)
  }
}

/** Results drills for one page, market and (pinned) check. */
export function useResultsDrills(
  results: PageResults,
  options: { pageId: string; market: Market | undefined; runId: string | null }
): ResultsDrills {
  const { pageId, market, runId } = options
  return useMemo(
    () =>
      buildResultsDrills(results, resultsScope(results, { pageId, market: market ?? null, runId })),
    [results, pageId, market, runId]
  )
}
