import { TOPIC_STAGE_LABEL } from '@shared/domain'
import { GOOGLE_WORDS, type ResultWords } from '../../../ui/resultWords'
import { compareSearches, resultLabel, whatToDo } from './results'
import type { Search } from './types'

export interface SearchesBriefInput {
  /** "Problem searches where you are not cited", or the topic's name. */
  title: string
  topicName: string
  marketName: string
  /** The page to improve; null when the searches have none yet. */
  targetUrl: string | null
  searches: readonly Search[]
  /** Searches from several topics: each names its own page to improve. */
  perSearchTarget?: boolean
  /** The picked engine's words: "No answer" on ChatGPT. Default Google's. */
  words?: ResultWords
}

/** Prompt text can carry `**` emphasis. The brief is plain text. */
function plain(text: string): string {
  return text.split('**').join('')
}

/**
 * A plain-text fix brief for several searches, built only from stored data (the
 * prompt page's fix brief, for a group): the target page, what to do, each search best
 * win odds first with the sites Google cites instead, and the sites that come up most.
 * Nothing is invented and nothing is sent anywhere; the screen copies it.
 */
export function searchesBrief(input: SearchesBriefInput): string {
  const words = input.words ?? GOOGLE_WORDS
  const searches = [...input.searches].sort(compareSearches)
  const lines: string[] = []
  lines.push(`Fix brief: ${plain(input.title)} (${input.marketName})`)
  lines.push(`Topic: ${plain(input.topicName)}`)
  lines.push(
    input.perSearchTarget
      ? 'Page to improve: listed under each search'
      : `Page to improve: ${input.targetUrl ?? 'none yet (write a new page)'}`
  )
  const results = new Set(searches.map((search) => search.result))
  if (results.size === 1) {
    const [only] = [...results]
    if (only) lines.push(`What to do: ${whatToDo(only, null, words)}`)
  }
  lines.push('', `Searches (${searches.length}), best win odds first:`)
  for (const search of searches) {
    const facts = [
      search.kind === 'question' ? 'question' : 'keyword',
      search.stage ? TOPIC_STAGE_LABEL[search.stage] : null,
      resultLabel(search.result, words),
      search.winOdds === null ? null : `win odds ${search.winOdds}`
    ].filter((part): part is string => part !== null)
    lines.push(`- ${search.ref}: ${plain(search.text)} (${facts.join(', ')})`)
    if (input.perSearchTarget)
      lines.push(`  Page to improve: ${search.targetUrl ?? 'none yet (write a new page)'}`)
    if (search.citedInstead.length > 0)
      lines.push(`  Google cites instead: ${search.citedInstead.join(', ')}`)
    if (search.pageCited) lines.push(`  Your page cited: ${search.pageCited}`)
  }
  const sites = new Map<string, number>()
  for (const search of searches)
    for (const domain of new Set(search.citedInstead))
      sites.set(domain, (sites.get(domain) ?? 0) + 1)
  const top = [...sites.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5)
  if (top.length > 0) {
    lines.push('', 'Sites Google trusts most for these:')
    for (const [domain, count] of top)
      lines.push(`- ${domain}: ${count} ${count === 1 ? 'search' : 'searches'}`)
  }
  return lines.join('\n')
}
