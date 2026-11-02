import { TOPIC_STAGE_LABEL } from '@shared/domain'
import type { Search } from '../model'

/** While a check runs, an unchecked search says so: "Checking…" or "Waiting". */
export function liveText(live: Search['live']): string | null {
  return live === 'checking' ? 'Checking…' : live === 'waiting' ? 'Waiting' : null
}

export function pctText(pct: number | null): string {
  return pct === null ? '—' : `${pct}%`
}

export function stageText(search: Search): string {
  return search.stage ? TOPIC_STAGE_LABEL[search.stage] : '—'
}
