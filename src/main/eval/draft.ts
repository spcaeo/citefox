// Dev-only prompt test bench (scripts/prompt-eval.mjs). Not imported by the app.
import {
  DEFAULT_PROMPT_MIX,
  SETUP_LISTS,
  type FillFromWebsiteResult,
  type PromptMix,
  type SetupContext,
  type SetupListId,
  type SetupRow,
  type SetupSectionId,
  type SetupSectionResult
} from '@shared/ipc'

/**
 * The setup draft as the bench chains it: a copy of the renderer's draft logic for a
 * user who ticks every AI row and types nothing (`onboarding/setupApply.ts` `applyFill`,
 * `replaceAiRows`; `onboarding/setupDraft.ts` `contextFromDraft`). With no user rows, a
 * read or a redo replaces a list with the new rows, near-duplicate names left out. Pure.
 */
export interface EvalDraft {
  domain: string
  country: string
  language: string
  summary: string
  lists: Record<SetupListId, SetupRow[]>
  topic: string
  mix: PromptMix
}

export function emptyDraft(domain: string, country: string, language: string): EvalDraft {
  const lists = Object.fromEntries(SETUP_LISTS.map((id) => [id, []])) as unknown as Record<
    SetupListId,
    SetupRow[]
  >
  return { domain, country, language, summary: '', lists, topic: '', mix: DEFAULT_PROMPT_MIX }
}

/** "Text-Em-All" and "textemall" are the same name (setupApply `fold`). */
export function fold(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/** The rows trimmed, each name once (setupApply `replaceAiRows` with no user rows). */
export function freshRows(rows: readonly SetupRow[]): SetupRow[] {
  const seen = new Set<string>()
  const out: SetupRow[] = []
  for (const row of rows) {
    const key = fold(row.name)
    if (key.length === 0 || seen.has(key)) continue
    seen.add(key)
    out.push({
      name: row.name.trim(),
      detail: row.detail.trim(),
      url: row.url && row.url.trim().length > 0 ? row.url.trim() : null,
      tag: row.tag && row.tag.trim().length > 0 ? row.tag.trim() : null,
      ...(row.tier !== undefined ? { tier: row.tier } : {})
    })
  }
  return out
}

export function withRows(
  draft: EvalDraft,
  list: SetupListId,
  rows: readonly SetupRow[]
): EvalDraft {
  return { ...draft, lists: { ...draft.lists, [list]: freshRows(rows) } }
}

const nameRow = (name: string, url: string | null = null): SetupRow => ({
  name,
  detail: '',
  url,
  tag: null
})

/** Step 3's site read into the draft (setupApply `applyFill`). */
export function applyFill(draft: EvalDraft, fill: FillFromWebsiteResult): EvalDraft {
  const products = fill.products ?? []
  const summary = (fill.summary ?? '').trim()
  let next: EvalDraft = summary.length > 0 ? { ...draft, summary } : draft
  next = withRows(
    next,
    'brands',
    fill.brands.map((brand) => nameRow(brand.name))
  )
  next = withRows(
    next,
    'products',
    products.map((product) => ({
      name: product.name,
      detail: product.job,
      url: product.evidence?.path ?? null,
      tag: null
    }))
  )
  const productName = (id: string | null | undefined): string | null =>
    products.find((product) => product.id === id)?.name ?? null
  next = withRows(
    next,
    'competitors',
    fill.competitors.map((company) => ({
      name: company.name,
      detail: company.reason,
      url: company.domain,
      tag: productName(company.product),
      tier: company.tier ?? null
    }))
  )
  next = withRows(
    next,
    'switchingFrom',
    fill.switchingFrom.map((company) => nameRow(company.name, company.domain))
  )
  next = withRows(
    next,
    'integrations',
    fill.integrations.map((company) => nameRow(company.name, company.domain))
  )
  return next
}

/** A section's result into the draft, as the step that ran it does. */
export function applySection(
  draft: EvalDraft,
  section: SetupSectionId,
  result: SetupSectionResult
): EvalDraft {
  if (section === 'summary') {
    const text = (result.text ?? '').trim()
    return text.length > 0 ? { ...draft, summary: text } : draft
  }
  if (section === 'topic') {
    const text = (result.text ?? result.rows[0]?.name ?? '').trim()
    return text.length > 0 ? { ...draft, topic: text } : draft
  }
  return withRows(draft, section, result.rows)
}

/** What Claude knows so far (setupDraft `contextFromDraft`, the mix included). */
export function contextFor(draft: EvalDraft): SetupContext {
  const names = (list: SetupListId): string[] => draft.lists[list].map((row) => row.name)
  return {
    domain: draft.domain,
    country: draft.country,
    language: draft.language,
    summary: draft.summary,
    brands: names('brands'),
    products: draft.lists.products,
    buyers: draft.lists.buyers,
    triggers: names('triggers'),
    competitors: draft.lists.competitors,
    switchingFrom: names('switchingFrom'),
    integrations: names('integrations'),
    topic: draft.topic,
    mix: draft.mix
  }
}
