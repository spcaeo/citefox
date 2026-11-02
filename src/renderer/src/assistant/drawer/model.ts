import { usePermissions } from '../../ui'
import type { AiContext, AiEntityRef } from '../context/types'
import { parseAbout } from '../openAsk'

export const CONNECTIONS_HREF = '#/connections?tab=claude'

/**
 * `unchecked`: Claude Code was not checked yet; a click checks it first (as
 * every AI step does) and asks only when the check says ready.
 */
export type ClaudeReadiness = 'ready' | 'unchecked' | 'checking' | 'not-ready'

export interface ClaudeGate {
  readiness: ClaudeReadiness
  /** After a click: the cached status when ready, else a checkup. True when Claude is ready. */
  ensure: () => Promise<boolean>
}

const READY: ClaudeGate = { readiness: 'ready', ensure: async () => true }

/** Ready when the app says so; outside the permissions provider (tests) it is ready. */
export function useClaudeGate(): ClaudeGate {
  const permissions = usePermissions()
  if (permissions === null) return READY
  const ensure = async (): Promise<boolean> =>
    (await permissions.ensureClaude().catch(() => null))?.state === 'ready'
  const state = permissions.claude?.state ?? null
  if (state === 'ready') return { readiness: 'ready', ensure }
  if (permissions.loading || permissions.checking || state === null) {
    return { readiness: 'checking', ensure }
  }
  if (state === 'unchecked') return { readiness: 'unchecked', ensure }
  return { readiness: 'not-ready', ensure }
}

/** The entity an `ask.about` value names, with the label the screen shows for it. */
export function aboutEntity(value: string | null, context: AiContext): AiEntityRef | null {
  const parsed = parseAbout(value)
  if (!parsed) return null
  const same = (item: AiEntityRef): boolean =>
    item.kind === parsed.kind && (item.id ?? null) === parsed.id
  const named = context.entities.find(same) ?? context.selection.find(same)
  if (named) return named
  if (parsed.kind === 'kpi' || parsed.kind === 'section') {
    return { kind: parsed.kind, id: parsed.id, label: context.screenLabel }
  }
  return { kind: parsed.kind, id: parsed.id, label: `This ${parsed.kind}` }
}
