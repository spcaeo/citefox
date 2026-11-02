/** `pick.for`: which group or cluster the picked pages go to. */
export type PickFor =
  | { kind: 'group'; id: string }
  | { kind: 'cluster'; id: string }
  | { kind: 'pillar'; id: string }
  | { kind: 'new-cluster' }

/** `group:<id>`, `cluster:<id>`, `pillar:<cluster id>` or `cluster:new`. Null for anything else. */
export function parsePickFor(value: string): PickFor | null {
  const at = value.indexOf(':')
  if (at < 0) return null
  const kind = value.slice(0, at)
  const id = value.slice(at + 1)
  if (id.length === 0) return null
  if (kind === 'cluster' && id === 'new') return { kind: 'new-cluster' }
  if (kind === 'group' || kind === 'cluster' || kind === 'pillar') return { kind, id }
  return null
}
