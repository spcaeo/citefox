import type { BuyerPrompt, Market } from '@shared/domain'
import type { DrillItem, DrillScope, ItemDrill } from '../drill'
import { marketLabel } from '../shell/model'

/**
 * Drills for the page-setup tabs (Page read, Buyer profile, Prompts, Content
 * gaps). These tabs list buyer prompts that may not have been checked yet,
 * so their drawers are item drills of prompts: one row per prompt, each
 * opening Prompt detail in the page's market. The drawer total is the
 * number of ids passed, so it equals the number clicked (NFR-14).
 */

/** The drawer scope for a page-setup tab: this page, its picked market, the latest check. */
export function setupScope(pageId: string, market: Market | null | undefined): DrillScope {
  return {
    pageId,
    marketId: market?.id ?? null,
    runId: null,
    marketLabel: market ? marketLabel(market) : '',
    checkDateLabel: '',
    brand: '',
    domain: ''
  }
}

/** A prompt's plain label (labels can carry `**bold**` marks). */
export function plainLabel(label: string): string {
  return label.split('**').join('')
}

/**
 * One drawer row per prompt id, in the order given. An id with no prompt in
 * `prompts` still gets a row ("Prompt no longer in the set"), so the total
 * never drops below the number clicked.
 */
export function promptItems(
  prompts: readonly BuyerPrompt[],
  ids: readonly string[],
  scope: DrillScope,
  secondary?: (prompt: BuyerPrompt) => string | null
): DrillItem[] {
  const byId = new Map(prompts.map((prompt) => [prompt.id, prompt]))
  return ids.map((id) => {
    const prompt = byId.get(id)
    if (!prompt) {
      return { id, primary: 'Question no longer in the set', secondary: id, target: null }
    }
    return {
      id,
      primary: `${prompt.position}. ${plainLabel(prompt.label)}`,
      secondary: secondary ? secondary(prompt) : null,
      target: scope.pageId
        ? { kind: 'prompt', pageId: scope.pageId, promptId: id, marketId: scope.marketId }
        : null
    }
  })
}

/** A drawer of buyer prompts by id. */
export function promptItemsDrill(
  copy: { id: string; title: string; description: string; note?: string },
  prompts: readonly BuyerPrompt[],
  ids: readonly string[],
  scope: DrillScope,
  secondary?: (prompt: BuyerPrompt) => string | null
): ItemDrill {
  return {
    kind: 'items',
    id: copy.id,
    title: copy.title,
    description: copy.description,
    noun: ['question', 'questions'],
    primaryLabel: 'Question',
    items: promptItems(prompts, ids, scope, secondary),
    ...(copy.note ? { note: copy.note } : {}),
    scope
  }
}
