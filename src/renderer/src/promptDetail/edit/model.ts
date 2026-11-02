import { SEARCHES_PER_PROMPT_MAX, SEARCHES_PER_PROMPT_MIN, type Market } from '@shared/domain'
import type { PromptTextRules, PromptVersions } from '@shared/ipc'
import type { PromptPanelId } from '../../shell/routes'

/** What `?panel=` opens on Prompt detail: the wording editor, or a re-check of the prompt as it is. */
export type PromptPanel = PromptPanelId

export function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/u).length
}

/**
 * The engine's checks for new wording (main `engine/prompt-reword.ts`), so the editor
 * says what is wrong before Save. The engine checks again when it saves.
 */
export function textProblem(text: string, rules: PromptTextRules): string | null {
  const trimmed = text.trim()
  if (trimmed.length === 0) return 'Write the wording before saving.'
  const words = wordCount(trimmed)
  if (rules.kind === 'buyer_prompt') {
    if (words > rules.maxWords) {
      return `A buyer question is ${words} words. Google reads at most ${rules.maxWords}, so keep it to ${rules.maxWords} or fewer.`
    }
    if (words < rules.minWords) {
      return `A buyer question is ${words} words. Write it as a full situational question of at least ${rules.minWords} words.`
    }
    const lower = trimmed.toLowerCase()
    const brand = rules.brands.find((name) => {
      const needle = name.trim().toLowerCase()
      return needle.length > 0 && lower.includes(needle)
    })
    return brand === undefined ? null : `A buyer question contains the brand name "${brand}".`
  }
  const noun = rules.kind === 'keyword' ? 'keyword' : 'question'
  if (words > rules.maxWords) {
    return `The ${noun} is ${words} words. Google reads at most ${rules.maxWords}, so keep it to ${rules.maxWords} or fewer.`
  }
  if (rules.brands.some((name) => namesWord(trimmed, name))) {
    return `The ${noun} names your brand. Write it as a buyer who has not found you yet would.`
  }
  return null
}

/** Whole-word, case- and accent-folded, like the topic rules. */
function namesWord(text: string, name: string): boolean {
  const fold = (value: string): string =>
    value
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
      .replace(/\s+/gu, ' ')
      .trim()
  const needle = fold(name)
  if (needle.length === 0) return false
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(fold(text))
}

/** "14 words · 8 to 32 for a buyer prompt". */
export function wordHint(text: string, rules: PromptTextRules): string {
  const words = wordCount(text)
  const count = `${words} ${words === 1 ? 'word' : 'words'}`
  if (rules.kind === 'buyer_prompt') {
    return `${count} · ${rules.minWords} to ${rules.maxWords} for a buyer question, without your brand`
  }
  return `${count} · up to ${rules.maxWords}, without your brand`
}

/** "US · EN" or "US · Austin · EN", without the flag. */
export function plainMarket(market: Pick<Market, 'country' | 'language' | 'location'>): string {
  const language = market.language.split('-')[0]?.toUpperCase() ?? market.language
  const place = market.location ? `${market.country} · ${market.location}` : market.country
  return `${place} · ${language}`
}

/** One search per sample and market, plus a second when Google loads the overview separately. */
export function searchRange(samples: number, markets: number): { min: number; max: number } {
  return {
    min: samples * markets * SEARCHES_PER_PROMPT_MIN,
    max: samples * markets * SEARCHES_PER_PROMPT_MAX
  }
}

function joinMarkets(markets: readonly Market[]): string {
  const names = markets.map(plainMarket)
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`
}

/** "Uses 3 searches in US · EN, up to 6 if Google loads the overview separately · 31,898 left". */
export function costLine(
  samples: number,
  markets: readonly Market[],
  searchesLeft: number | null
): string {
  if (markets.length === 0) return 'Pick a market to re-check.'
  const { min, max } = searchRange(samples, markets.length)
  const uses = `Uses ${min.toLocaleString('en-US')} ${min === 1 ? 'search' : 'searches'} in ${joinMarkets(markets)}`
  const most =
    max > min
      ? `, up to ${max.toLocaleString('en-US')} if Google loads the overview separately`
      : ''
  const left = searchesLeft === null ? '' : ` · ${searchesLeft.toLocaleString('en-US')} left`
  return `${uses}${most}${left}`
}

/** Why the re-check cannot start, or null. The engine also stops at the project's cap. */
export function costProblem(
  samples: number,
  markets: number,
  searchesLeft: number | null
): string | null {
  if (markets === 0) return 'Pick at least one market.'
  const { min } = searchRange(samples, markets)
  if (searchesLeft !== null && min > searchesLeft) {
    return `Not enough searches left this month: this uses ${min.toLocaleString('en-US')} and ${searchesLeft.toLocaleString('en-US')} ${searchesLeft === 1 ? 'is' : 'are'} left.`
  }
  return null
}

/** The prompt to read for one prompt-set version, and its wording there when it differs. */
export interface VersionLink {
  promptId: string
  /** The wording in that version when it is not the current wording in this market. */
  earlierWording: string | null
}

function textIn(step: PromptVersions['steps'][number], marketId: string): string | null {
  return step.texts.find((text) => text.marketId === marketId)?.text ?? null
}

/** Prompt-set version → the same prompt in that version (Over time reads each check with it). */
export function versionLinks(
  versions: PromptVersions | null,
  marketId: string
): Map<number, VersionLink> {
  const links = new Map<number, VersionLink>()
  const first = versions?.steps[0]
  if (!versions || !first) return links
  const current = textIn(first, marketId)
  for (const step of versions.steps) {
    const text = textIn(step, marketId)
    links.set(step.promptSetVersion, {
      promptId: step.promptId,
      earlierWording: text !== null && text !== current ? text : null
    })
  }
  return links
}

/** When this market's current wording was saved, and the wording before it. Null when it never changed. */
export function wordingChange(
  versions: PromptVersions | null,
  marketId: string
): { changedAt: string; previous: string } | null {
  const steps = versions?.steps ?? []
  const current = steps[0] ? textIn(steps[0], marketId) : null
  for (let index = 0; index + 1 < steps.length; index += 1) {
    const step = steps[index]
    const older = steps[index + 1]
    if (!step || !older) break
    const before = textIn(older, marketId)
    if (before !== null && before !== current) return { changedAt: step.savedAt, previous: before }
  }
  return null
}

/** The wording of this prompt in a market from its saved versions, or null. */
export function currentWording(versions: PromptVersions | null, marketId: string): string | null {
  const first = versions?.steps[0]
  if (!first) return null
  return textIn(first, marketId) ?? first.texts[0]?.text ?? null
}
