import type { BuyerPrompt, CoverageLevel, PromptSource } from '@shared/domain'
import type { DrillScope, ItemDrill } from '../drill'
import { promptItemsDrill } from './drills'
import { coverageLabel, sourceLabel, stageLabel } from './labels'

/** Coverage levels in the order the Prompts tab lists them. */
export const COVERAGE_ORDER: readonly CoverageLevel[] = ['strong', 'partial', 'weak', 'none']

/** The sources in `prompts`, in first-seen order, with how many prompts have each. */
export function sourceOptions(
  prompts: readonly BuyerPrompt[]
): { source: PromptSource; count: number }[] {
  const counts = new Map<PromptSource, number>()
  for (const prompt of prompts) counts.set(prompt.source, (counts.get(prompt.source) ?? 0) + 1)
  return [...counts].map(([source, count]) => ({ source, count }))
}

/** A row's second line in a prompts drawer: stage and source. */
function promptMeta(prompt: BuyerPrompt): string {
  return `${stageLabel(prompt.intentStage)} · ${sourceLabel(prompt.source)}`
}

/**
 * "Coverage against the page": one drawer per coverage level, built from the
 * stored coverage matrix. Each drawer lists exactly the prompts of that level
 * in this set, so its total equals the number shown (NFR-14). Levels with no
 * prompts are left out.
 */
export function coverageDrills(
  prompts: readonly BuyerPrompt[],
  coverage: ReadonlyMap<string, CoverageLevel>,
  scope: DrillScope
): { level: CoverageLevel; drill: ItemDrill }[] {
  return COVERAGE_ORDER.flatMap((level) => {
    const ids = prompts
      .filter((prompt) => coverage.get(prompt.id) === level)
      .map((prompt) => prompt.id)
    if (ids.length === 0) return []
    const label = coverageLabel(level)
    return [
      {
        level,
        drill: promptItemsDrill(
          {
            id: `coverage:${level}`,
            title: `${label} coverage`,
            description: `Questions the page covers at **${label.toLowerCase()}** in the latest Content gaps check. Open one to see its AI Overview.`
          },
          prompts,
          ids,
          scope,
          promptMeta
        )
      }
    ]
  })
}

/**
 * Brand names from the stored brand sentence ("A prompt contains Example Co or
 * Text Bolt.", optionally followed by advice). Empty when it is not that warning.
 */
export function brandNamesFromMessage(message: string): string[] {
  const match = /^A (?:prompt|question) contains (.+?)\.(?:\s|$)/.exec(message.trim())
  if (!match?.[1] || match[1] === 'a brand name') return []
  return match[1]
    .split(' or ')
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
}

/** Prompts whose wording (any market) contains one of `names`, case-insensitive. */
export function promptsNaming(
  prompts: readonly BuyerPrompt[],
  names: readonly string[]
): BuyerPrompt[] {
  const needles = names.map((name) => name.toLowerCase())
  if (needles.length === 0) return []
  return prompts.filter((prompt) =>
    prompt.variants.some((variant) => {
      const text = variant.text.toLowerCase()
      return needles.some((needle) => text.includes(needle))
    })
  )
}

/** The drawer behind the brand warning: the prompts that name a brand. */
export function brandDrill(
  prompts: readonly BuyerPrompt[],
  message: string,
  scope: DrillScope
): ItemDrill | null {
  const names = brandNamesFromMessage(message)
  const naming = promptsNaming(prompts, names)
  if (naming.length === 0) return null
  return promptItemsDrill(
    {
      id: 'prompts:brand',
      title: 'Questions that name a brand',
      description: `These questions contain ${names.join(' or ')}. Buyers rarely search with the brand name, so remove it before the next check.`
    },
    prompts,
    naming.map((prompt) => prompt.id),
    scope,
    promptMeta
  )
}

/** Prompts that pass the source facet. No sources picked: every prompt. */
export function passesSources(prompt: BuyerPrompt, sources: readonly PromptSource[]): boolean {
  return sources.length === 0 || sources.includes(prompt.source)
}

/** Adds `value` to a facet if missing, removes it if present. */
export function toggled<T>(current: readonly T[], value: T): T[] {
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
}
