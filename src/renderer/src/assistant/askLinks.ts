import { splitProjectRoute } from '@shared/project-route'
import { ASSISTANT_QUESTION_MAX } from '@shared/ipc'
import { drawerHref } from '../shell/drawers'
import { landingHash, pageHash } from '../shell/routes'

/**
 * What an old Ask link presets: `#/ask?page=<id>&market=<id>&q=<text>`. Ask
 * CiteFox was a screen; links into it (a topic's "Ask about this topic", the
 * tray, saved links) still work and open the drawer instead.
 */
export interface OldAskLink {
  pageId: string | null
  marketId: string | null
  question: string
}

const EMPTY: OldAskLink = { pageId: null, marketId: null, question: '' }

/** The preset in an old Ask hash. Empty values (and other routes) give an empty preset. */
export function askScopeFromHash(hash: string): OldAskLink {
  const { hash: plain } = splitProjectRoute(hash)
  const bare = plain.startsWith('#') ? plain.slice(1) : plain
  const [path = '', search = ''] = bare.split('?')
  const trimmed = (path.startsWith('/') ? path : `/${path}`).replace(/\/+$/, '')
  if (trimmed !== '/ask' || search.length === 0) return EMPTY
  const values = new URLSearchParams(search)
  const read = (key: string): string | null => {
    const value = values.get(key)?.trim() ?? ''
    return value.length > 0 ? value : null
  }
  return {
    pageId: read('page'),
    marketId: read('market'),
    question: (read('q') ?? '').slice(0, ASSISTANT_QUESTION_MAX)
  }
}

/** Where an old `#/ask?page=…&market=…&q=…` link lands: its screen with Ask CiteFox open. */
export function askRedirectHash(hash: string): string {
  const scope = askScopeFromHash(hash)
  const under = scope.pageId
    ? pageHash(scope.pageId, 'results', { marketId: scope.marketId })
    : landingHash()
  return drawerHref('ask', { 'ask.q': scope.question || null }, under)
}
