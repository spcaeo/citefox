import type { CitedSiteRow } from '@shared/ipc'
import type { AiEntityRef } from '../assistant/context/types'
import { kindLabel, percent } from './model'

/** A cited site as Ask CiteFox names it: a saved competitor by name, any other site by its domain. */
export function siteRef(row: CitedSiteRow): AiEntityRef | null {
  if (row.kind === 'you') return null
  const detail = `${kindLabel(row)} · ${percent(row.share)} of citations`
  if (row.kind === 'competitor') return { kind: 'competitor', id: row.id, label: row.name, detail }
  return { kind: 'domain', id: row.id, label: row.domain ?? row.name, detail }
}
