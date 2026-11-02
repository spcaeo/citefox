import type { ImportCandidate } from '@shared/ipc'
import { NO_CLUSTER, RECENT_DAYS } from '../constants'
import type { ImportRule, SelectionState } from '../types'

const DAY_MS = 86_400_000

/** Stable key for a row: its page id, or the URL for a pasted page not in the project. */
export function rowKey(row: Pick<ImportCandidate, 'pageId' | 'url'>): string {
  return row.pageId ?? `url:${row.url}`
}

/**
 * The label an imported file gave the page, else its title, else words from the
 * last path segment when the page was never read.
 */
export function displayTitle(row: Pick<ImportCandidate, 'title' | 'path' | 'label'>): string {
  if (row.label && row.label.trim().length > 0) return row.label
  if (row.title && row.title.trim().length > 0) return row.title
  const pathOnly = row.path.split('?')[0] ?? row.path
  const parts = pathOnly.split('/').filter((part) => part.length > 0)
  const last = parts.at(-1)
  if (!last) return 'Home page'
  const words = safeDecode(last)
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim()
  if (words.length === 0) return pathOnly
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function clusterLabel(row: Pick<ImportCandidate, 'clusterName'>): string {
  return row.clusterName ?? NO_CLUSTER
}

/**
 * Candidates plus pasted rows. A pasted URL already in the project uses the project
 * row, with the label an imported file gave it (W3I-C2).
 */
export function mergePool(
  rows: readonly ImportCandidate[],
  pasted: readonly ImportCandidate[]
): ImportCandidate[] {
  const byUrl = new Set(rows.map((row) => row.url))
  const labels = new Map(
    pasted.flatMap((row) => (row.label ? [[row.url, row.label] as const] : []))
  )
  const extra = pasted.filter((row) => !byUrl.has(row.url))
  const merged =
    labels.size === 0
      ? [...rows]
      : rows.map((row) => {
          const label = labels.get(row.url)
          return label === undefined ? row : { ...row, label }
        })
  return extra.length === 0 ? merged : [...merged, ...extra]
}

/** Keys of project rows that match pasted URLs, so pasting an existing page selects it. */
export function pastedKeys(
  pool: readonly ImportCandidate[],
  pasted: readonly ImportCandidate[]
): Set<string> {
  const urls = new Set(pasted.map((row) => row.url))
  const keys = new Set<string>()
  for (const row of pool) if (urls.has(row.url)) keys.add(rowKey(row))
  return keys
}

export function ruleMatches(rule: ImportRule, row: ImportCandidate): boolean {
  const value = rule.value.trim().toLowerCase()
  if (value.length === 0) return false
  const path = row.path.toLowerCase()
  const url = row.url.toLowerCase()
  switch (rule.op) {
    case 'contains':
    case 'not_contains':
      return path.includes(value) || url.includes(value)
    case 'starts':
      return value.startsWith('http') ? url.startsWith(value) : path.startsWith(value)
    case 'title':
      return displayTitle(row).toLowerCase().includes(value)
  }
}

export function ruleMatchCount(rule: ImportRule, pool: readonly ImportCandidate[]): number {
  if (rule.value.trim().length === 0) return 0
  let count = 0
  for (const row of pool) if (ruleMatches(rule, row)) count += 1
  return count
}

/** FR-20.6 quick pick: `lastmod` within the last 90 days of `now`. */
export function isRecent(lastmod: string | null, now: number): boolean {
  if (!lastmod) return false
  const at = Date.parse(lastmod)
  if (Number.isNaN(at)) return false
  return at <= now + DAY_MS && now - at <= RECENT_DAYS * DAY_MS
}

/**
 * Rows in the preview: everything any source chose (folders, clusters,
 * inclusion rules, quick picks, Claude's pick, pasted rows), minus rows a
 * "doesn't contain" rule matches. Tracked rows stay visible; unticks stay.
 */
export function previewRows(
  pool: readonly ImportCandidate[],
  state: SelectionState,
  now: number
): ImportCandidate[] {
  const folders = new Set(state.folders)
  const clusters = new Set(state.clusters)
  const ai = new Set(state.aiKeys)
  const pasted = pastedKeys(pool, state.pasted)
  const include = state.rules.filter((rule) => rule.op !== 'not_contains')
  const exclude = state.rules.filter((rule) => rule.op === 'not_contains')
  const linked = state.picks.links ? mostLinkedKeys(pool) : new Set<string>()
  return pool.filter((row) => {
    if (exclude.some((rule) => ruleMatches(rule, row))) return false
    const key = rowKey(row)
    if (pasted.has(key) || ai.has(key) || linked.has(key)) return true
    if (folders.has(row.folder)) return true
    if (row.clusterId !== null && clusters.has(row.clusterId)) return true
    if (state.picks.money && row.moneyPage) return true
    if (state.picks.recent && isRecent(row.lastmod, now)) return true
    return include.some((rule) => ruleMatches(rule, row))
  })
}

/** Rows that will be tracked: in the preview, not tracked yet, and still ticked. */
export function selectedRows(
  rows: readonly ImportCandidate[],
  off: readonly string[]
): ImportCandidate[] {
  const unticked = new Set(off)
  return rows.filter((row) => !row.alreadyTracked && !unticked.has(rowKey(row)))
}

/** Pages with the most internal links: the top tenth (at least 1) of pages with link data. */
export function mostLinkedKeys(pool: readonly ImportCandidate[]): Set<string> {
  const linked = pool
    .filter((row) => row.internalLinks !== null && row.internalLinks > 0)
    .sort((a, b) => (b.internalLinks ?? 0) - (a.internalLinks ?? 0))
  const take = Math.max(1, Math.ceil(linked.length / 10))
  return new Set(linked.slice(0, take).map(rowKey))
}

export function quickPickCount(
  pool: readonly ImportCandidate[],
  pick: 'links' | 'recent' | 'money',
  now: number
): number {
  if (pick === 'links') return mostLinkedKeys(pool).size
  if (pick === 'money') return pool.filter((row) => row.moneyPage).length
  return pool.filter((row) => isRecent(row.lastmod, now)).length
}

/** The split `import:track` takes: existing page ids, new URLs and the file's labels. */
export function trackPayload(rows: readonly ImportCandidate[]): {
  pageIds: string[]
  urls: string[]
  labels: { url: string; label: string }[]
} {
  const pageIds: string[] = []
  const urls: string[] = []
  const labels: { url: string; label: string }[] = []
  for (const row of rows) {
    if (row.alreadyTracked) continue
    if (row.pageId === null) urls.push(row.url)
    else pageIds.push(row.pageId)
    const label = row.label?.trim() ?? ''
    if (label.length > 0) labels.push({ url: row.url, label })
  }
  return { pageIds, urls, labels }
}

/** Checked import rows as `url,label` CSV for `import:parseUrls` (labels kept, W3I-C2). */
export function fileRowsCsv(rows: readonly { url: string; label: string }[]): string {
  const cell = (value: string): string =>
    /[",;\t\n\r]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value
  return ['url,label', ...rows.map((row) => `${cell(row.url)},${cell(row.label)}`)].join('\n')
}
