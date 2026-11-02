import { patchHashQuery, readHashQuery } from '../../utils/hashQuery'
import { opaqueId } from '../ids'

/**
 * A drill page's filters in the hash URL (topic mock-up TopicBigDrill): each
 * filter is `f.<name>=<value>`, so "Problem · Not cited" in a topic is
 * `#/topics/t1?f.stage=problem&f.result=not_cited`. Values are fixed words
 * (a result key, a stage id) or opaque ids from `drillValue`, never names,
 * paths or URLs. Back, Forward and a copied link reopen the same list.
 */
export const DRILL_PREFIX = 'f.'

/** An opaque value for free text such as a folder path or a keyword group. */
export function drillValue(text: string): string {
  return `v${opaqueId(text)}`
}

/** The URL key of filter `name`. */
export function drillKey(name: string): string {
  return `${DRILL_PREFIX}${name}`
}

/** `base` (a hash, its query kept) with these filters set; null drops one. */
export function drillHref(
  base: string,
  filters: Readonly<Record<string, string | null | undefined>>
): string {
  const patch: Record<string, string | null> = {}
  for (const [name, value] of Object.entries(filters)) {
    if (value !== undefined) patch[drillKey(name)] = value
  }
  return patchHashQuery(base || '#/', patch)
}

/** The filters named in `hash`, by name. Missing ones are null. */
export function readDrillFilters<N extends string>(
  hash: string,
  names: readonly N[]
): Readonly<Record<N, string | null>> {
  const values = readHashQuery(names.map(drillKey), hash)
  const out = {} as Record<N, string | null>
  for (const name of names) out[name] = values[drillKey(name)] ?? null
  return out
}

/** Every filter name in `hash` (any `f.*` key), in URL order. */
export function drillNames(hash: string): string[] {
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
  const names: string[] = []
  new URLSearchParams(query).forEach((value, key) => {
    if (key.startsWith(DRILL_PREFIX) && value) names.push(key.slice(DRILL_PREFIX.length))
  })
  return names
}

/** True when `hash` names any drill filter: the screen shows its drill page. */
export function hasDrillFilters(hash: string): boolean {
  return drillNames(hash).length > 0
}

/** `hash` without filter `name`: a chip's ✕. */
export function withoutDrillFilter(hash: string, name: string): string {
  return patchHashQuery(hash || '#/', { [drillKey(name)]: null })
}

/** `hash` with every filter gone: "Back to all N". Other query values stay. */
export function withoutDrillFilters(hash: string): string {
  const patch: Record<string, null> = {}
  for (const name of drillNames(hash)) patch[drillKey(name)] = null
  return patchHashQuery(hash || '#/', patch)
}
