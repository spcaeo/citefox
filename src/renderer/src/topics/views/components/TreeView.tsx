import { useMemo, type JSX, type ReactNode } from 'react'
import { TOPIC_STAGE_LABEL, TOPIC_STAGES, type TopicStage } from '@shared/domain'
import {
  Dropdown,
  ListGrid,
  ResultBar,
  ResultDot,
  UrlText,
  type ListColumn,
  type ListTree,
  type ListTreeGroup,
  type ListTreeStep
} from '../../../ui'
import {
  matchText,
  OTHER_KEYWORDS,
  pathOf,
  resultHeading,
  SEARCH_RESULTS,
  totalsOf,
  TREE_MODE_LABEL,
  whatToDo,
  wordGroupIndex,
  wordGroups,
  type Search,
  type SearchFilter,
  type SearchResult,
  type TreeMode
} from '../model'
import { navigateHash } from '../../../shell/routes'
import type { ViewEnv } from '../types'
import { CitedCell, CountLink, RefCell, ResultCell, TargetPctLink } from './cells'
import { kindFilter, kindMatches } from './kindFilter'

/** A group key's prefix, so a group row knows its filter. */
const STAGE = 'stage:'
const RESULT = 'result:'
const WORDS = 'words:'
const SOURCE = 'source:'

function resultStep(
  result: SearchResult,
  live: Search['live'],
  words: ViewEnv['words']
): ListTreeStep {
  return {
    key: `${RESULT}${result}`,
    // While a check runs its unchecked searches are on their way, not missing.
    label: result === 'not_checked' && live ? 'Still checking' : resultHeading(result, words),
    ...(result === 'not_checked' ? {} : { lead: <ResultDot result={result} /> })
  }
}

/** The filter a group row stands for, read from its keys. */
function groupFilter(path: readonly string[], type: Search['kind'] | null): SearchFilter {
  const filter: SearchFilter = type ? { kind: type } : {}
  for (const key of path) {
    if (key.startsWith(STAGE)) {
      const stage = key.slice(STAGE.length)
      filter.stage = stage === 'none' ? 'none' : (stage as TopicStage)
      filter.kind = 'question'
    } else if (key === 'kw') filter.kind = 'keyword'
    else if (key.startsWith(WORDS)) filter.words = key.slice(WORDS.length)
    else if (key.startsWith(RESULT)) filter.result = key.slice(RESULT.length) as SearchResult
    else if (key.startsWith(SOURCE)) filter.source = key.slice(SOURCE.length)
  }
  return filter
}

function treeOf(
  mode: TreeMode | 'source',
  words: ReadonlyMap<string, string>,
  env: ViewEnv
): ListTree<Search> {
  const path = (row: Search): readonly ListTreeStep[] => {
    if (mode === 'result') return [resultStep(row.result, row.live ?? null, env.words)]
    if (mode === 'source')
      return [
        // A tracked page shows as its path (its site icon in front); a topic by its name.
        {
          key: `${SOURCE}${row.sourceId}`,
          label: row.sourceUrl ? pathOf(row.sourceUrl) : row.sourceName
        },
        resultStep(row.result, row.live ?? null, env.words)
      ]
    if (row.kind === 'keyword') {
      const label = words.get(row.id) ?? OTHER_KEYWORDS
      return [
        { key: 'kw', label: 'Keywords' },
        { key: `${WORDS}${label}`, label: label === OTHER_KEYWORDS ? label : `"${label}"` }
      ]
    }
    return [
      {
        key: `${STAGE}${row.stage ?? 'none'}`,
        label: row.stage ? TOPIC_STAGE_LABEL[row.stage] : 'No stage'
      },
      resultStep(row.result, row.live ?? null, env.words)
    ]
  }
  return {
    path,
    order: [
      ...TOPIC_STAGES.map((stage) => `${STAGE}${stage}`),
      `${STAGE}none`,
      'kw',
      // Word groups biggest first (their index order), "Other keywords" last.
      ...[...new Set(words.values())].map((label) => `${WORDS}${label}`),
      `${WORDS}${OTHER_KEYWORDS}`,
      ...SEARCH_RESULTS.map((result) => `${RESULT}${result}`)
    ],
    totalRow: 'All',
    renderGroup: (group) => groupLabel(group, mode, env),
    onActivateGroup: (group) => navigateHash(env.drillHref(groupFilter(group.path, env.type)))
  }
}

function groupLabel(
  group: ListTreeGroup<Search>,
  mode: TreeMode | 'source',
  env: ViewEnv
): ReactNode {
  const last = group.key
  const pageUrl = last.startsWith(SOURCE) ? (group.rows[0]?.sourceUrl ?? null) : null
  if (pageUrl) {
    return (
      <span className="tv-group">
        <UrlText url={pageUrl} label={group.label} className="tv-group-label" />
      </span>
    )
  }
  let note: ReactNode = null
  if (last === 'kw') note = <span className="tv-note">· grouped by shared words</span>
  else if (last.startsWith(RESULT)) {
    const result = last.slice(RESULT.length) as SearchResult
    if (mode === 'result') {
      note = (
        <span className="ui-group-hint">
          <b>{result === 'no_overview' || result === 'target' ? '' : 'What to do: '}</b>
          {whatToDo(result, env.nextCheck, env.words)}
        </span>
      )
    } else if (result === 'other_page') {
      const counts = new Map<string, number>()
      for (const row of group.rows)
        if (row.pageCited) counts.set(row.pageCited, (counts.get(row.pageCited) ?? 0) + 1)
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
      if (top) note = <span className="tv-note">· mostly {pathOf(top[0])}</span>
    }
    if (group.rows.length > 3 && result !== 'no_overview') {
      note = (
        <>
          {note}
          <a className="tv-open-all" href={env.drillHref(groupFilter(group.path, env.type))}>
            Open all {group.rows.length} ›
          </a>
        </>
      )
    }
  }
  return (
    <span className="tv-group">
      {group.lead}
      <span className="tv-group-label">{group.label}</span>
      {note}
    </span>
  )
}

function columns(env: ViewEnv, mode: TreeMode | 'source'): ListColumn<Search>[] {
  const heading =
    mode === 'source'
      ? 'Topic or page › Result › Search'
      : mode === 'result'
        ? 'Result › Search'
        : 'Stage › Result › Search'
  return [
    {
      id: 'text',
      label: heading,
      width: 'fill',
      minWidth: 240,
      sort: (row) => row.text.toLowerCase(),
      copy: (row) => row.text,
      render: (row) => (
        <span className="tv-leaf">
          <RefCell search={row} />
          <span className="tv-leaf-text">{row.text}</span>
        </span>
      )
    },
    {
      id: 'searches',
      label: 'Searches',
      width: 96,
      numeric: true,
      sort: false,
      render: () => '',
      total: (rows, group) => (
        <CountLink
          count={rows.length}
          filter={groupFilter(group?.path ?? [], env.type)}
          drillHref={env.drillHref}
          label={`${group?.label ?? 'All'}: open these ${rows.length} searches`}
        />
      ),
      totalSort: (rows) => rows.length
    },
    {
      id: 'results',
      label: 'Results',
      width: 156,
      sort: false,
      render: (row) => <CitedCell search={row} site={env.site} />,
      total: (rows, group) => {
        const filter = groupFilter(group?.path ?? [], env.type)
        return (
          <ResultBar
            counts={totalsOf(rows).counts}
            label={`${group?.label ?? 'All'} searches`}
            hrefFor={(result) => env.drillHref({ ...filter, result })}
          />
        )
      }
    },
    {
      id: 'target',
      label: 'Target cited',
      width: 108,
      numeric: true,
      sort: false,
      render: (row) => (row.result === 'target' ? <ResultCell result="target" /> : ''),
      total: (rows, group) => (
        <TargetPctLink
          totals={totalsOf(rows)}
          filter={groupFilter(group?.path ?? [], env.type)}
          drillHref={env.drillHref}
          label={group?.label ?? 'All'}
        />
      ),
      totalSort: (rows) => totalsOf(rows).targetPct
    },
    {
      id: 'work',
      label: 'Needs work',
      width: 104,
      numeric: true,
      sort: false,
      render: () => '',
      // Not cited plus Your other page, opened together (`work=1`).
      total: (rows, group) => {
        const count = totalsOf(rows).needsWork
        return (
          <CountLink
            count={count}
            filter={{ ...groupFilter(group?.path ?? [], env.type), work: true }}
            drillHref={env.drillHref}
            label={`${group?.label ?? 'All'} · Needs work: open these ${count} searches`}
          />
        )
      },
      totalSort: (rows) => totalsOf(rows).needsWork
    },
    {
      id: 'odds',
      label: 'Win odds',
      width: 96,
      numeric: true,
      // Questions › Tree has no win odds yet: the column stays out while every row is empty.
      hideWhenEmpty: (row) => row.winOdds,
      sort: (row) => row.winOdds,
      render: (row) => (row.winOdds === null ? '' : row.winOdds),
      total: (rows, group) => {
        const totals = totalsOf(rows)
        if (group?.key.startsWith(RESULT))
          return totals.winAvg === null ? '—' : `avg ${totals.winAvg}`
        return totals.winMax === null ? '—' : `up to ${totals.winMax}`
      },
      totalSort: (rows) => totalsOf(rows).winMax
    }
  ]
}

/**
 * The Tree view (TopicBig): Stage › Result › Search, with Keywords › word group ›
 * Search; or Result › Search (a small topic, a first check); or Topic › Result ›
 * Search (Questions). Group rows show their totals in the same columns; every count
 * opens its drill. Every group starts closed; Expand all opens them.
 */
export function TreeView({
  env,
  mode,
  label
}: {
  env: ViewEnv
  /** Default: the URL's tree grouping. */
  mode?: TreeMode | 'source'
  label: string
}): JSX.Element {
  const shown = mode ?? env.tree
  const rows = useMemo(
    () =>
      matchText(
        env.searches.filter((search) => kindMatches(search, env.type)),
        env.q
      ),
    [env.searches, env.type, env.q]
  )
  const words = useMemo(
    () => wordGroupIndex(wordGroups(env.searches.filter((search) => search.kind === 'keyword'))),
    [env.searches]
  )
  const tree = useMemo(() => treeOf(shown, words, env), [shown, words, env])
  const cols = useMemo(() => columns(env, shown), [env, shown])
  return (
    <ListGrid
      label={label}
      engine={env.engine}
      noun={['search', 'searches']}
      rows={rows}
      rowKey={(row) => row.id}
      rowLabel={(row) => `${row.ref} ${row.text}`}
      columns={cols}
      tree={tree}
      search={{
        text: (row) => `${row.ref} ${row.text}`,
        placeholder: `Search ${env.searches.length} searches`
      }}
      searchValue={env.q}
      onSearchChange={env.setQ}
      filter={kindFilter(env)}
      toolbar={
        mode === undefined ? (
          <Dropdown
            title="Tree grouping"
            prefix="Tree:"
            size="sm"
            value={env.tree}
            options={(['stage', 'result'] as const).map((value) => ({
              value,
              label: TREE_MODE_LABEL[value]
            }))}
            onChange={(value) => env.setTree(value === 'result' ? 'result' : 'stage')}
          />
        ) : null
      }
      onActivate={env.openSearch}
      empty={<p className="tv-empty">No searches match.</p>}
    />
  )
}
