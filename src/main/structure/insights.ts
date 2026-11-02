import { createHash } from 'node:crypto'
import type { ClusterRole, StructureInsight, StructureInsightKind } from '@shared/domain'
import { pageTokens, pathSegments, topFolderOf } from './cluster-rules'

/**
 * FR-19.8 "Claude noticed", found by rules over stored data. No Claude call:
 * own-page citations, near-duplicate pages, orphans, thin coverage, and
 * template pages that differ only by one word.
 */

export interface InsightPage {
  id: string
  url: string
  title: string | null
  tracked: boolean
  clusterId: string | null
  role: ClusterRole | null
  wordCount: number | null
  promptCount: number
}

/** Google cited `citedPageId` for a prompt tracked on `pageId`. */
export interface OwnCitationPair {
  pageId: string
  citedPageId: string
  promptLabel: string
}

export interface InsightInput {
  pages: readonly InsightPage[]
  clusters: readonly { id: string; name: string; pageIds: readonly string[] }[]
  ownCitations: readonly OwnCitationPair[]
}

const MAX_INSIGHTS = 8
const MAX_PAGE_IDS = 20
const DUPLICATE_THRESHOLD = 0.8
/** Caps that keep near-duplicate search linear on large, repetitive folders. */
const MAX_DUPLICATE_PAIRS = 50
const MAX_POSTINGS = 200
const TEMPLATE_MIN = 5
const SHORT_PAGE_WORDS = 300
const THIN_CLUSTER_PAGES = 10

export function findInsights(input: InsightInput): StructureInsight[] {
  const byId = new Map(input.pages.map((page) => [page.id, page]))
  const groups: StructureInsight[][] = [
    citationInsights(input.ownCitations, byId).slice(0, 2),
    duplicateInsights(input.pages).slice(0, 2),
    thinInsights(input, byId).slice(0, 2),
    templateInsights(input.pages).slice(0, 2),
    orphanInsights(input)
  ]
  const out: StructureInsight[] = []
  const seen = new Set<string>()
  for (let round = 0; out.length < MAX_INSIGHTS; round += 1) {
    let added = false
    for (const group of groups) {
      const next = group[round]
      if (next === undefined || seen.has(next.id)) continue
      seen.add(next.id)
      out.push(next)
      added = true
      if (out.length >= MAX_INSIGHTS) break
    }
    if (!added) break
  }
  return out.map((item) => ({
    ...item,
    pages: item.pageIds.slice(0, 6).flatMap((id) => {
      const page = byId.get(id)
      return page === undefined ? [] : [{ id, label: label(page) }]
    })
  }))
}

function insight(
  kind: StructureInsightKind,
  key: string,
  title: string,
  body: string,
  pageIds: readonly string[],
  clusterId: string | null
): StructureInsight {
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 12)
  return {
    id: `${kind}:${hash}`,
    kind,
    title,
    body,
    pageIds: pageIds.slice(0, MAX_PAGE_IDS),
    pageCount: pageIds.length,
    pages: [],
    clusterId
  }
}

function label(page: InsightPage): string {
  return page.title?.trim() || pathOf(page.url)
}

function pathOf(url: string): string {
  const segments = pathSegments(url)
  return segments.length === 0 ? '/' : `/${segments.join('/')}/`
}

function citationInsights(
  pairs: readonly OwnCitationPair[],
  byId: ReadonlyMap<string, InsightPage>
): StructureInsight[] {
  const grouped = new Map<string, { a: InsightPage; b: InsightPage; prompts: string[] }>()
  for (const pair of pairs) {
    if (pair.pageId === pair.citedPageId) continue
    const a = byId.get(pair.pageId)
    const b = byId.get(pair.citedPageId)
    if (!a || !b) continue
    const key = [a.id, b.id].sort().join('\u0000')
    const found = grouped.get(key)
    const prompt = pair.promptLabel.trim()
    if (found) {
      if (prompt && !found.prompts.includes(prompt)) found.prompts.push(prompt)
    } else grouped.set(key, { a, b, prompts: prompt ? [prompt] : [] })
  }
  return [...grouped.entries()]
    .sort(
      (left, right) =>
        right[1].prompts.length - left[1].prompts.length || left[0].localeCompare(right[0])
    )
    .map(([key, { a, b, prompts }]) => {
      const first = prompts[0]
      const promptBit =
        first === undefined
          ? 'a prompt you track on'
          : prompts.length === 1
            ? `"${first}", a prompt you track on`
            : `"${first}" and ${prompts.length - 1} more prompts you track on`
      return insight(
        'cannibalization',
        `cite:${key}`,
        `"${label(a)}" and "${label(b)}" compete for the same prompt`,
        `AI Overviews cited ${pathOf(b.url)} for ${promptBit} ${pathOf(a.url)}. Merge the two pages, or differentiate them so each one answers its own question.`,
        [a.id, b.id],
        a.clusterId
      )
    })
}

function duplicateInsights(pages: readonly InsightPage[]): StructureInsight[] {
  const byFolder = new Map<string, { page: InsightPage; tokens: string[] }[]>()
  for (const page of pages) {
    const tokens = pageTokens(page.url, page.title)
    if (tokens.length < 2) continue
    const folder = topFolderOf(page.url)
    const list = byFolder.get(folder)
    const entry = { page, tokens }
    if (list) list.push(entry)
    else byFolder.set(folder, [entry])
  }
  const found: { score: number; a: InsightPage; b: InsightPage }[] = []
  for (const entries of byFolder.values()) {
    const df = new Map<string, number>()
    for (const entry of entries)
      for (const token of entry.tokens) df.set(token, (df.get(token) ?? 0) + 1)
    const sets = entries.map((entry) => new Set(entry.tokens))
    // A word set shared by three or more pages is a template, not a duplicate pair.
    const signatures = new Map<string, number>()
    const signatureOf = sets.map((set) => [...set].sort().join(' '))
    for (const signature of signatureOf) {
      signatures.set(signature, (signatures.get(signature) ?? 0) + 1)
    }
    const index = new Map<string, number[]>()
    entries.forEach((entry, position) => {
      if ((signatures.get(signatureOf[position] ?? '') ?? 0) > 2) return
      if (found.length >= MAX_DUPLICATE_PAIRS) return
      const ordered = [...entry.tokens].sort(
        (left, right) => (df.get(left) ?? 0) - (df.get(right) ?? 0) || left.localeCompare(right)
      )
      const prefix = ordered.length - Math.ceil(DUPLICATE_THRESHOLD * ordered.length) + 1
      const checked = new Set<number>()
      for (const token of ordered.slice(0, prefix)) {
        const postings = index.get(token) ?? []
        if (postings.length > MAX_POSTINGS) continue
        for (const other of postings) {
          if (checked.has(other)) continue
          checked.add(other)
          const score = jaccard(sets[position], sets[other])
          const left = entries[other]
          if (score >= DUPLICATE_THRESHOLD && left)
            found.push({ score, a: left.page, b: entry.page })
        }
        const list = index.get(token)
        if (list) list.push(position)
        else index.set(token, [position])
      }
    })
  }
  found.sort((left, right) => right.score - left.score || left.a.id.localeCompare(right.a.id))
  return found.map(({ a, b }) =>
    insight(
      'cannibalization',
      `dup:${[a.id, b.id].sort().join('\u0000')}`,
      `"${label(a)}" and "${label(b)}" look like the same page`,
      `${pathOf(a.url)} and ${pathOf(b.url)} share almost every word in their titles and URLs, so they may compete for the same AI Overview citations. Merge them, or differentiate them so each targets its own buyer question.`,
      [a.id, b.id],
      a.clusterId
    )
  )
}

function thinInsights(
  input: InsightInput,
  byId: ReadonlyMap<string, InsightPage>
): StructureInsight[] {
  const out: StructureInsight[] = []
  const thin = input.clusters
    .map((cluster) => ({
      cluster,
      tracked: cluster.pageIds.filter((id) => byId.get(id)?.tracked === true).length
    }))
    .filter((item) => item.cluster.pageIds.length >= THIN_CLUSTER_PAGES && item.tracked <= 1)
    .sort(
      (left, right) =>
        right.cluster.pageIds.length - left.cluster.pageIds.length ||
        left.cluster.name.localeCompare(right.cluster.name)
    )
  for (const { cluster, tracked } of thin) {
    out.push(
      insight(
        'thin_coverage',
        `cluster:${cluster.id}`,
        `Thin coverage in "${cluster.name}"`,
        `${cluster.pageIds.length} pages, ${tracked === 1 ? '1 tracked' : 'none tracked'}. Track the pillar and a few supporting pages to see whether AI Overviews cite this topic.`,
        cluster.pageIds,
        cluster.id
      )
    )
  }
  const short = input.pages
    .filter((page) => page.tracked && page.wordCount !== null && page.wordCount < SHORT_PAGE_WORDS)
    .sort(
      (left, right) =>
        (left.wordCount ?? 0) - (right.wordCount ?? 0) || left.id.localeCompare(right.id)
    )
  if (short.length > 0) {
    const first = short[0]
    out.push(
      insight(
        'thin_coverage',
        `short:${short
          .map((page) => page.id)
          .sort()
          .join('\u0000')}`,
        short.length === 1 ? '1 tracked page is short' : `${short.length} tracked pages are short`,
        `${first ? `"${label(first)}" has ${first.wordCount ?? 0} words. ` : ''}Pages under ${SHORT_PAGE_WORDS} words rarely answer a buyer's question in full. Open content gaps to see what to add.`,
        short.map((page) => page.id),
        first?.clusterId ?? null
      )
    )
  }
  return out
}

function templateInsights(pages: readonly InsightPage[]): StructureInsight[] {
  const patterns = new Map<string, { display: string; ids: string[] }>()
  const byId = new Map(pages.map((page) => [page.id, page]))
  for (const page of pages) {
    const words = templateWords(page)
    if (words.length < 2) continue
    const folder = topFolderOf(page.url)
    for (let index = 0; index < words.length; index += 1) {
      const masked = words.map((word, position) => (position === index ? '…' : word))
      const key = `${folder}\u0000${masked.join(' ')}`
      const found = patterns.get(key)
      if (found) {
        if (!found.ids.includes(page.id)) found.ids.push(page.id)
      } else patterns.set(key, { display: masked.join(' '), ids: [page.id] })
    }
  }
  const ranked = [...patterns.entries()]
    .filter(([, value]) => value.ids.length >= TEMPLATE_MIN)
    .sort(
      (left, right) => right[1].ids.length - left[1].ids.length || left[0].localeCompare(right[0])
    )
  const used = new Set<string>()
  const out: StructureInsight[] = []
  for (const [key, { display, ids }] of ranked) {
    const fresh = ids.filter((id) => !used.has(id))
    if (fresh.length * 2 < ids.length) continue
    for (const id of ids) used.add(id)
    const examples = ids
      .slice(0, 2)
      .map((id) => byId.get(id))
      .filter((page): page is InsightPage => page !== undefined)
      .map((page) => `"${label(page)}"`)
    out.push(
      insight(
        'template_pages',
        `template:${key}`,
        `${ids.length} template pages differ only by one word`,
        `Pages like ${examples.join(' and ')} follow one pattern ("${display}"). AI Overviews usually cite only a few of them; give each page details its own buyers ask about, or track the strongest few.`,
        ids,
        byId.get(ids[0] ?? '')?.clusterId ?? null
      )
    )
  }
  return out
}

/** Title words (or slug words without a title), lower-case, stopwords kept. */
function templateWords(page: InsightPage): string[] {
  const source = page.title?.trim() || (pathSegments(page.url).at(-1) ?? '')
  return source
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0)
}

function orphanInsights(input: InsightInput): StructureInsight[] {
  const orphans = input.pages.filter((page) => page.role === 'orphan')
  if (orphans.length === 0) return []
  const counts = new Map<string, number>()
  for (const page of orphans) {
    if (page.clusterId !== null) counts.set(page.clusterId, (counts.get(page.clusterId) ?? 0) + 1)
  }
  const top = [...counts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
  )
  const names = top
    .slice(0, 2)
    .map(([id]) => input.clusters.find((cluster) => cluster.id === id)?.name)
    .filter((name): name is string => name !== undefined)
  const where =
    names.length === 0 ? '' : ` Most are in ${names.map((name) => `"${name}"`).join(' and ')}.`
  return [
    insight(
      'orphan',
      `orphan:${orphans
        .map((page) => page.id)
        .sort()
        .join('\u0000')}`,
      orphans.length === 1 ? '1 orphan page' : `${orphans.length} orphan pages`,
      `These pages fit no cluster topic, and CiteFox knows of no page that links to them.${where} Link them from a related pillar page, or move them into the cluster they belong to.`,
      orphans.map((page) => page.id),
      top[0]?.[0] ?? null
    )
  ]
}

function jaccard(
  left: ReadonlySet<string> | undefined,
  right: ReadonlySet<string> | undefined
): number {
  if (!left || !right || left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const item of left) if (right.has(item)) shared += 1
  return shared / (left.size + right.size - shared)
}
