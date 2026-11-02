export {
  mergeWithExisting,
  type ClusterPlan,
  type ExistingCluster,
  type ExistingClusterPage,
  type PlannedCluster
} from './cluster-merge'

/**
 * FR-19.4 clustering without Claude: URL folders, topic words, and shared
 * target queries. Pure functions; the service stores the result.
 */

export interface ClusterInputPage {
  id: string
  url: string
  title: string | null
  /** Labels and texts of the page's active prompts. Empty when it has none. */
  promptTexts: readonly string[]
  tracked: boolean
}

export interface ProposedCluster {
  /** Stable topic key, like `blog|10dlc`. Stored as `clusters.topic_key`. */
  key: string
  name: string
  pillarPageId: string | null
  pageIds: string[]
  orphanPageIds: string[]
  themes: string[]
}

const STOPWORDS = new Set(
  (
    'a an and are as at be by can do does for from get how i in into is it its me my of on or ' +
    'our out so than that the their them this to up us use using vs was we what when where which ' +
    'who why will with without you your yours www com html htm php index page amp best top new ' +
    'all any more most way ways'
  ).split(' ')
)

/**
 * Content-marketing modifiers and generic verbs. They describe the article
 * format ("tips for", "explained", "checklist") rather than its topic, so they
 * never become a cluster topic on their own or inside a two-word topic.
 */
const GENERIC = new Set(
  (
    'tip guide faq explained practice example checklist template step mistake troubleshooting ' +
    'setting setup set cost idea ultimate complete beginner introduction intro overview review ' +
    'list small business team company free simple easy quick common work working help support ' +
    'add edit delete remove import export connect verify send create change update manage find ' +
    'make fix start stop turn read learn know need want try thing type kind reason benefit ' +
    'versus compared comparison vs alternative option today year month week day net org io'
  ).split(' ')
)

/** Words kept upper-case in names and anchors. */
const ACRONYMS = new Set([
  'sms',
  'mms',
  'api',
  'tcpa',
  'crm',
  'seo',
  'faq',
  'it',
  'hr',
  'ai',
  'b2b',
  'b2c',
  'saas',
  'smtp',
  'ivr',
  'otp',
  'pos',
  'hipaa',
  'gdpr',
  'usa',
  'uk',
  'us'
])

/** Topics per folder: 12, rising to 24 for a large flat folder (about one per 60 pages). */
const MIN_TOPICS_PER_FOLDER = 12
const MAX_TOPICS_PER_FOLDER = 24
const SMALL_FOLDER = 8
const OTHER_TERM = '_other'
const FOLDER_TERM = '*'

/** Lower-case words, stopwords removed, light plural stemming, pure numbers dropped. */
export function splitWords(text: string): string[] {
  const out: string[] = []
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length === 0 || STOPWORDS.has(raw)) continue
    if (/^\d+$/.test(raw)) continue
    const word = stem(raw)
    if (word.length < 2 || STOPWORDS.has(word)) continue
    out.push(word)
  }
  return out
}

function stem(word: string): string {
  if (/\d/.test(word) || ACRONYMS.has(word)) return word
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 4 && /(sses|xes|ches|shes)$/.test(word)) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1)
  return word
}

/** Path segments of a URL (lower-case). Empty for the root or an invalid URL. */
export function pathSegments(url: string): string[] {
  try {
    return new URL(url).pathname
      .split('/')
      .filter((part) => part.length > 0)
      .map((part) => decodeSegment(part).toLowerCase())
  } catch {
    return []
  }
}

function decodeSegment(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

/** Top-level folder like `/blog/`; `/` for root pages. */
export function topFolderOf(url: string): string {
  const segments = pathSegments(url)
  if (segments.length < 2) return '/'
  return `/${segments[0] ?? ''}/`
}

/** A folder's landing page (`/features/`) joins that folder when other pages are in it. */
function landingFolder(url: string, known: ReadonlySet<string>): string {
  const folder = topFolderOf(url)
  if (folder !== '/') return folder
  const segments = pathSegments(url)
  const own = segments.length === 1 ? `/${segments[0] ?? ''}/` : '/'
  return known.has(own) ? own : '/'
}

/** `blog` for `/blog/`, `root` for `/`. */
export function folderKeyOf(folder: string): string {
  const trimmed = folder.replace(/^\/+|\/+$/g, '')
  return trimmed.length === 0 ? 'root' : trimmed
}

function slugWords(url: string): string[] {
  const segments = pathSegments(url)
  const slug = segments.length < 2 ? (segments[0] ?? '') : segments.slice(1).join('-')
  return splitWords(slug)
}

/** Words from the slug and title, each once, slug words first. */
export function pageTokens(url: string, title: string | null): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const word of [...slugWords(url), ...splitWords(title ?? '')]) {
    if (seen.has(word)) continue
    seen.add(word)
    out.push(word)
  }
  return out
}

/** Topic unigrams plus consecutive slug bigrams, minus the folder word and format words. */
function pageTerms(url: string, title: string | null, folderWord: string): Set<string> {
  const terms = new Set<string>()
  const topical = (word: string): boolean => word !== folderWord && !GENERIC.has(word)
  for (const word of pageTokens(url, title)) if (topical(word)) terms.add(word)
  const slug = slugWords(url).filter(topical)
  for (let index = 0; index + 1 < slug.length; index += 1) {
    terms.add(`${slug[index]} ${slug[index + 1]}`)
  }
  return terms
}

/**
 * How much a term is worth per page it would cover. Two-word topics are more
 * specific; a single word on more than 12% of the folder (the site's core
 * vocabulary, like "text" on a texting site) is worth less.
 */
function termWeight(term: string, df: number, total: number): number {
  if (term.includes(' ')) return 1.25
  const share = df / total
  if (share > 0.2) return 0.25
  return share > 0.12 ? 0.55 : 1
}

/** Title-case with acronyms upper-cased: `10dlc` → `10DLC`, `email sms` → `Email SMS`. */
export function termLabel(term: string): string {
  return term
    .split(/[\s-]+/)
    .filter((word) => word.length > 0)
    .map((word, index) => {
      if (ACRONYMS.has(word) || /^\d+[a-z]+$/.test(word)) return word.toUpperCase()
      if (index === 0) return word.charAt(0).toUpperCase() + word.slice(1)
      return word
    })
    .join(' ')
}

function folderLabel(folder: string): string {
  if (folder === '/') return 'Other pages'
  const words = folderKeyOf(folder).split(/[-_/]+/)
  return termLabel(words.join(' '))
}

interface IndexedPage {
  page: ClusterInputPage
  terms: Set<string>
  slugLength: number
}

export function clusterByTopic(pages: readonly ClusterInputPage[]): ProposedCluster[] {
  const byFolder = new Map<string, ClusterInputPage[]>()
  const known = new Set(pages.map((page) => topFolderOf(page.url)))
  for (const page of pages) {
    const folder = landingFolder(page.url, known)
    const list = byFolder.get(folder)
    if (list) list.push(page)
    else byFolder.set(folder, [page])
  }
  const folders = [...byFolder.entries()].sort(
    (left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0])
  )
  const out: ProposedCluster[] = []
  for (const [folder, members] of folders) out.push(...clusterFolder(folder, members))
  return uniqueNames(out)
}

function clusterFolder(folder: string, members: readonly ClusterInputPage[]): ProposedCluster[] {
  const folderKey = folderKeyOf(folder)
  const label = folderLabel(folder)
  const folderWord = stem(folderKey)
  const indexed: IndexedPage[] = members.map((page) => ({
    page,
    terms: pageTerms(page.url, page.title, folderWord),
    slugLength: pathSegments(page.url).join('/').length
  }))
  if (members.length < SMALL_FOLDER) {
    return [
      {
        key: `${folderKey}|${FOLDER_TERM}`,
        name: label,
        pillarPageId: pickPillar(indexed, [], folder),
        pageIds: members.map((page) => page.id),
        orphanPageIds: [],
        themes: themesFor(indexed, [])
      }
    ]
  }
  const total = members.length
  const minDf = Math.max(3, Math.ceil(total * 0.015))
  const maxDf = Math.max(minDf, Math.floor(total * 0.4))
  const postings = new Map<string, number[]>()
  indexed.forEach((entry, index) => {
    for (const term of entry.terms) {
      const list = postings.get(term)
      if (list) list.push(index)
      else postings.set(term, [index])
    }
  })
  const candidates = [...postings.entries()].filter(
    ([, list]) => list.length >= minDf && list.length <= maxDf
  )
  const assigned = new Int32Array(total).fill(-1)
  const topics: string[] = []
  const topicLimit = Math.min(
    MAX_TOPICS_PER_FOLDER,
    Math.max(MIN_TOPICS_PER_FOLDER, Math.round(total / 60))
  )
  while (topics.length < topicLimit) {
    let best: string | null = null
    let bestGain = 0
    let bestScore = 0
    for (const [term, list] of candidates) {
      let gain = 0
      for (const index of list) if (assigned[index] === -1) gain += 1
      const score = gain * termWeight(term, list.length, total)
      if (
        score > bestScore ||
        (score === bestScore && score > 0 && best !== null && better(term, best))
      ) {
        best = term
        bestGain = gain
        bestScore = score
      }
    }
    if (best === null || bestGain < minDf) break
    const topicIndex = topics.length
    topics.push(best)
    for (const index of postings.get(best) ?? []) {
      if (assigned[index] === -1) assigned[index] = topicIndex
    }
  }
  const out: ProposedCluster[] = topics.map((term, topicIndex) => {
    const group = indexed.filter((_, index) => assigned[index] === topicIndex)
    return {
      key: `${folderKey}|${term}`,
      name: termLabel(term),
      pillarPageId: pickPillar(group, term.split(' '), null),
      pageIds: group.map((entry) => entry.page.id),
      orphanPageIds: [],
      themes: themesFor(group, [term])
    }
  })
  const rest = indexed.filter((_, index) => assigned[index] === -1)
  if (rest.length > 0) {
    const ids = rest.map((entry) => entry.page.id)
    out.push({
      key: `${folderKey}|${OTHER_TERM}`,
      name: topics.length === 0 ? label : `${label} · other topics`,
      pillarPageId: topics.length === 0 ? pickPillar(rest, [], folder) : null,
      pageIds: ids,
      orphanPageIds: topics.length === 0 ? [] : ids,
      themes: themesFor(rest, [])
    })
  }
  return out
}

/** Tie-break between equal-gain terms: bigrams first, then alphabetical. */
function better(term: string, current: string): boolean {
  const termBigram = term.includes(' ')
  const currentBigram = current.includes(' ')
  if (termBigram !== currentBigram) return termBigram
  return term < current
}

function pickPillar(
  group: readonly IndexedPage[],
  words: readonly string[],
  folder: string | null
): string | null {
  let best: IndexedPage | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  for (const entry of group) {
    const path = pathSegments(entry.page.url).join('/')
    let score = -entry.slugLength / 100
    if (folder !== null && `/${path}/` === folder) score += 10
    if (words.length > 0 && words.every((word) => entry.terms.has(word))) score += 3
    if (/guide/.test(path)) score += 2
    if (/what-is|how-to/.test(path)) score += 1
    if (
      best === null ||
      score > bestScore ||
      (score === bestScore && entry.page.id < best.page.id)
    ) {
      best = entry
      bestScore = score
    }
  }
  return best?.page.id ?? null
}

function themesFor(group: readonly IndexedPage[], exclude: readonly string[]): string[] {
  const prompts = new Map<string, { text: string; count: number }>()
  for (const entry of group) {
    for (const raw of entry.page.promptTexts) {
      const text = raw.replace(/\s+/g, ' ').trim()
      if (text.length === 0) continue
      const key = text.toLowerCase()
      const found = prompts.get(key)
      if (found) found.count += 1
      else prompts.set(key, { text: text.slice(0, 80), count: 1 })
    }
  }
  if (prompts.size > 0) {
    return [...prompts.values()]
      .sort((left, right) => right.count - left.count || left.text.localeCompare(right.text))
      .slice(0, 3)
      .map((item) => item.text)
  }
  const skip = new Set(exclude.flatMap((term) => [term, ...term.split(' ')]))
  const counts = new Map<string, number>()
  for (const entry of group) {
    for (const term of entry.terms) {
      if (term.includes(' ') || skip.has(term)) continue
      counts.set(term, (counts.get(term) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2 || group.length < 3)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([term]) => termLabel(term))
}

function uniqueNames(clusters: ProposedCluster[]): ProposedCluster[] {
  const counts = new Map<string, number>()
  for (const cluster of clusters) {
    counts.set(cluster.name.toLowerCase(), (counts.get(cluster.name.toLowerCase()) ?? 0) + 1)
  }
  const used = new Set<string>()
  return clusters.map((cluster) => {
    let name = cluster.name
    if ((counts.get(name.toLowerCase()) ?? 0) > 1) {
      const folder = cluster.key.split('|')[0] ?? ''
      if (!name.includes(' · '))
        name = `${name} · ${folderLabel(folder === 'root' ? '/' : `/${folder}/`)}`
    }
    let unique = name
    for (let suffix = 2; used.has(unique.toLowerCase()); suffix += 1) unique = `${name} (${suffix})`
    used.add(unique.toLowerCase())
    return { ...cluster, name: unique }
  })
}

export function clusterBySharedQueries(pages: readonly ClusterInputPage[]): ProposedCluster[] {
  const withPrompts = pages.filter((page) => page.promptTexts.length > 0)
  const tokens = withPrompts.map(
    (page) => new Set(page.promptTexts.flatMap((text) => splitWords(text)))
  )
  const parent = withPrompts.map((_, index) => index)
  const find = (index: number): number => {
    let root = index
    while (parent[root] !== root) root = parent[root] ?? root
    let cursor = index
    while (parent[cursor] !== root) {
      const next = parent[cursor] ?? root
      parent[cursor] = root
      cursor = next
    }
    return root
  }
  const inverted = new Map<string, number[]>()
  tokens.forEach((set, index) => {
    for (const token of set) {
      const list = inverted.get(token)
      if (list) list.push(index)
      else inverted.set(token, [index])
    }
  })
  const compared = new Set<number>()
  const size = withPrompts.length
  for (let left = 0; left < size; left += 1) {
    compared.clear()
    for (const token of tokens[left] ?? []) {
      for (const right of inverted.get(token) ?? []) {
        if (right <= left || compared.has(right)) continue
        compared.add(right)
        if (jaccard(tokens[left], tokens[right]) >= 0.3) parent[find(left)] = find(right)
      }
    }
  }
  const groups = new Map<number, number[]>()
  for (let index = 0; index < size; index += 1) {
    const root = find(index)
    const list = groups.get(root)
    if (list) list.push(index)
    else groups.set(root, [index])
  }
  const out: ProposedCluster[] = []
  const fallback: ClusterInputPage[] = pages.filter((page) => page.promptTexts.length === 0)
  for (const members of groups.values()) {
    if (members.length < 2) {
      const only = withPrompts[members[0] ?? -1]
      if (only) fallback.push(only)
      continue
    }
    out.push(
      queryCluster(
        members.map((index) => withPrompts[index]).filter(isPage),
        members.map((index) => tokens[index] ?? new Set<string>())
      )
    )
  }
  out.sort(
    (left, right) =>
      right.pageIds.length - left.pageIds.length || left.name.localeCompare(right.name)
  )
  const order = new Map(pages.map((page, index) => [page.id, index]))
  fallback.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0))
  return uniqueNames([...out, ...clusterByTopic(fallback)])
}

function isPage(value: ClusterInputPage | undefined): value is ClusterInputPage {
  return value !== undefined
}

function queryCluster(
  members: readonly ClusterInputPage[],
  sets: readonly Set<string>[]
): ProposedCluster {
  const counts = new Map<string, number>()
  for (const set of sets) for (const token of set) counts.set(token, (counts.get(token) ?? 0) + 1)
  const top = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 2)
    .map(([token]) => token)
  let pillar: string | null = null
  let pillarScore = -1
  members.forEach((page, index) => {
    let score = 0
    sets.forEach((other, otherIndex) => {
      if (otherIndex !== index) score += jaccard(sets[index], other)
    })
    if (score > pillarScore || (score === pillarScore && pillar !== null && page.id < pillar)) {
      pillar = page.id
      pillarScore = score
    }
  })
  const name = termLabel(top.join(' ') || 'shared queries')
  const indexed = members.map((page) => ({ page, terms: new Set<string>(), slugLength: 0 }))
  return {
    key: `queries|${top.join('-') || 'shared'}`,
    name,
    pillarPageId: pillar,
    pageIds: members.map((page) => page.id),
    orphanPageIds: [],
    themes: themesFor(indexed, [])
  }
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

/** Sync: the cluster a new page belongs to by its folder and topic words. */
export function assignToCluster(
  page: { url: string; title: string | null },
  clusters: readonly { id: string; topicKey: string | null }[]
): string | null {
  const folderKey = folderKeyOf(topFolderOf(page.url))
  const terms = pageTerms(page.url, page.title, stem(folderKey))
  let folderMatch: string | null = null
  for (const cluster of clusters) {
    if (cluster.topicKey === null) continue
    const split = cluster.topicKey.indexOf('|')
    if (split < 0) continue
    const key = cluster.topicKey.slice(0, split)
    const term = cluster.topicKey.slice(split + 1)
    if (key !== folderKey || term === OTHER_TERM) continue
    if (term === FOLDER_TERM) {
      folderMatch ??= cluster.id
      continue
    }
    if (terms.has(term) || term.split(' ').every((word) => terms.has(word))) return cluster.id
  }
  return folderMatch
}
