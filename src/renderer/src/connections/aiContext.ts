import type { ApiKeyProvider, ConnectionState } from '@shared/domain'
import type { ConnectionsOverview } from '@shared/ipc'
import { claudeModelLabel } from '../settings/modelLabel'
import { keysInRotation } from './utils/model'

const STATE_WORD: Readonly<Record<ConnectionState, string>> = {
  ok: 'connected',
  warning: 'needs attention',
  off: 'off',
  unchecked: 'not checked'
}

/**
 * What Ask CiteFox knows about the connections, as short facts: each
 * provider's state and how many keys it has. Only counts and states: never
 * a key, its hint, a key name or a file path.
 */
export function connectionFacts(
  overview: ConnectionsOverview,
  claudeModel: string | null = null
): string[] {
  const facts = [
    `SerpApi: ${STATE_WORD[overview.serpapi]} · ${keyCount(overview, 'serpapi')} · rotation ${overview.serpapiRotation.replace(/_/g, ' ')}`,
    `Claude: ${STATE_WORD[overview.claudeCode]} · model ${claudeModelLabel(claudeModel)}`,
    `Jina Reader: ${STATE_WORD[overview.jina]} · ${keyCount(overview, 'jina')}`,
    `YouTube: ${STATE_WORD[overview.youtube]}`
  ]
  const anthropic = keysInRotation(overview.keys, 'anthropic').length
  if (anthropic > 0) facts.push(`Anthropic API keys: ${anthropic}`)
  if (overview.searchesLeft !== null) {
    facts.push(`SerpApi searches left this month: ${overview.searchesLeft.toLocaleString('en-US')}`)
  }
  const checkup = overview.claudeCheckup
  if (checkup) facts.push(`Claude checkup: ${checkup.ready ? 'ready' : 'not ready'}`)
  if (overview.issueCount > 0) facts.push(`Connection issues: ${overview.issueCount}`)
  return facts
}

/** "2 keys, 1 off". */
function keyCount(overview: ConnectionsOverview, provider: ApiKeyProvider): string {
  const keys = keysInRotation(overview.keys, provider)
  const off = keys.filter((key) => !key.on).length
  const count = `${keys.length} ${keys.length === 1 ? 'key' : 'keys'}`
  return off > 0 ? `${count}, ${off} off` : count
}
