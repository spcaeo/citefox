import { TOPIC_STAGE_LABEL, TOPIC_STAGES } from '@shared/domain'
import { GOOGLE_WORDS, type ResultWords } from '../../../ui/resultWords'
import { compareSearches, resultHeading, totalsOf, whatToDo } from './results'
import { pathOf } from './paths'
import { SEARCH_RESULTS, type Search, type SearchFilter, type TreeNode } from './types'
import { wordGroups } from './wordGroups'

/**
 * The tree view's rows. Every group row carries the totals of the searches under it,
 * so each row adds up to its parent and the top rows add up to the footer.
 */

export type TreeMode = 'stage' | 'result'

export const TREE_MODE_LABEL: Readonly<Record<TreeMode, string>> = {
  stage: 'Stage › Result',
  result: 'Result'
}

function leaf(search: Search, depth: number): TreeNode {
  return {
    id: search.id,
    label: search.text,
    depth,
    totals: totalsOf([search]),
    filter: {},
    children: [],
    search
  }
}

function group(
  id: string,
  label: string,
  depth: number,
  searches: readonly Search[],
  filter: SearchFilter,
  children: readonly TreeNode[],
  extra: Partial<Pick<TreeNode, 'note' | 'result'>> = {}
): TreeNode {
  return { id, label, depth, totals: totalsOf(searches), filter, children, ...extra }
}

/** "mostly /blog/nagios-setup/": the own page cited most for these searches. */
function mostlyNote(searches: readonly Search[]): string | undefined {
  const counts = new Map<string, number>()
  for (const search of searches) {
    if (search.pageCited) counts.set(search.pageCited, (counts.get(search.pageCited) ?? 0) + 1)
  }
  let best: [string, number] | null = null
  for (const entry of counts) if (best === null || entry[1] > best[1]) best = entry
  return best ? `mostly ${pathOf(best[0])}` : undefined
}

/** One branch per result with searches, each holding its searches best win odds first. */
function resultBranches(
  searches: readonly Search[],
  parentId: string,
  depth: number,
  filter: SearchFilter,
  options: { notes: 'mostly' | 'what-to-do'; nextCheck?: string | null; words?: ResultWords }
): TreeNode[] {
  return SEARCH_RESULTS.flatMap((result) => {
    const mine = searches.filter((search) => search.result === result).sort(compareSearches)
    if (mine.length === 0) return []
    const note =
      options.notes === 'what-to-do'
        ? whatToDo(result, options.nextCheck ?? null, options.words)
        : result === 'other_page'
          ? mostlyNote(mine)
          : undefined
    return [
      group(
        `${parentId}result:${result}`,
        resultHeading(result, options.words ?? GOOGLE_WORDS),
        depth,
        mine,
        { ...filter, result },
        mine.map((search) => leaf(search, depth + 1)),
        { result, ...(note ? { note } : {}) }
      )
    ]
  })
}

/** The Keywords branch: word groups, then their keywords. */
function keywordsBranch(keywords: readonly Search[], depth: number): TreeNode | null {
  if (keywords.length === 0) return null
  const byId = new Map(keywords.map((search) => [search.id, search]))
  const groups = wordGroups(keywords)
  return group(
    'kw',
    'Keywords',
    depth,
    keywords,
    { kind: 'keyword' },
    groups.map((wordGroup) => {
      const mine = wordGroup.ids
        .map((id) => byId.get(id))
        .filter((search): search is Search => search !== undefined)
        .sort(compareSearches)
      return group(
        `kw/words:${wordGroup.label}`,
        wordGroup.label === 'Other keywords' ? wordGroup.label : `"${wordGroup.label}"`,
        depth + 1,
        mine,
        { kind: 'keyword', words: wordGroup.label },
        mine.map((search) => leaf(search, depth + 2))
      )
    }),
    { note: 'grouped by shared words' }
  )
}

/**
 * Stage › Result › Search for questions, then Keywords › word group › Search. Questions
 * without a stage get a "No stage" branch.
 */
export function stageTree(searches: readonly Search[]): TreeNode[] {
  const questions = searches.filter((search) => search.kind === 'question')
  const rows: TreeNode[] = []
  for (const stage of TOPIC_STAGES) {
    const mine = questions.filter((search) => search.stage === stage)
    if (mine.length === 0) continue
    const id = `stage:${stage}/`
    rows.push(
      group(
        `stage:${stage}`,
        TOPIC_STAGE_LABEL[stage],
        0,
        mine,
        { stage, kind: 'question' },
        resultBranches(mine, id, 1, { stage, kind: 'question' }, { notes: 'mostly' })
      )
    )
  }
  const loose = questions.filter((search) => search.stage === null)
  if (loose.length > 0) {
    const filter: SearchFilter = { stage: 'none', kind: 'question' }
    rows.push(
      group(
        'stage:none',
        'No stage',
        0,
        loose,
        filter,
        resultBranches(loose, 'stage:none/', 1, filter, {
          notes: 'mostly'
        })
      )
    )
  }
  const keywords = keywordsBranch(
    searches.filter((search) => search.kind === 'keyword'),
    0
  )
  if (keywords) rows.push(keywords)
  return rows
}

/** Result › Search, with each result's "What to do" line: a small topic, a first check. */
export function resultTree(
  searches: readonly Search[],
  nextCheck: string | null = null,
  words: ResultWords = GOOGLE_WORDS
): TreeNode[] {
  return resultBranches(searches, '', 0, {}, { notes: 'what-to-do', nextCheck, words })
}

/** Topic › Result › Search for the Questions screen (topics and pages in list order). */
export function sourceTree(searches: readonly Search[]): TreeNode[] {
  const order: string[] = []
  const bySource = new Map<string, Search[]>()
  for (const search of searches) {
    const list = bySource.get(search.sourceId)
    if (list) list.push(search)
    else {
      bySource.set(search.sourceId, [search])
      order.push(search.sourceId)
    }
  }
  return order.map((sourceId) => {
    const mine = bySource.get(sourceId) ?? []
    const filter: SearchFilter = { source: sourceId }
    return group(
      `source:${sourceId}`,
      mine[0]?.sourceName ?? sourceId,
      0,
      mine,
      filter,
      resultBranches(mine, `source:${sourceId}/`, 1, filter, { notes: 'mostly' })
    )
  })
}
