import type { ListFilter } from '../../../ui'
import type { Search } from '../model'
import type { ViewEnv } from '../types'

export function kindMatches(search: Search, type: Search['kind'] | null): boolean {
  return type === null || search.kind === type
}

/** The All · Questions · Keywords segment, with counts, kept in the URL (`type`). */
export function kindFilter(env: Pick<ViewEnv, 'searches' | 'type' | 'setType'>): ListFilter {
  const questions = env.searches.filter((search) => search.kind === 'question').length
  return {
    label: 'Questions or keywords',
    value: env.type ?? 'all',
    onChange: (value) => env.setType(value === 'question' || value === 'keyword' ? value : null),
    options: [
      { value: 'all', label: 'All', count: env.searches.length },
      { value: 'question', label: 'Questions', count: questions },
      { value: 'keyword', label: 'Keywords', count: env.searches.length - questions }
    ]
  }
}
