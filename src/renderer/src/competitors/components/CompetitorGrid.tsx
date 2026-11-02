import type { JSX } from 'react'
import type { GridSortKey } from '@shared/domain'
import type { CitedSiteRow } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { askColumn } from '../../assistant/sparkle/askColumn'
import { DrillNumber } from '../../drill'
import { GOOGLE_ONLY, useEngineFilter } from '../../engines/useEngineFilter'
import { siteColumns } from '../../sites/siteColumns'
import { siteGroup } from '../../sites/siteRows'
import type { SourceLine } from '../../sites/sources'
import type { SourceActions } from '../../sites/useSourceActions'
import {
  EmptyState,
  ListGrid,
  ResultDot,
  type FilterGroup,
  type ListColumn,
  type MenuItem
} from '../../ui'
import {
  barScale,
  DEFAULT_SORT,
  filterByKind,
  KIND_OPTIONS,
  kindCounts,
  newSites,
  percent,
  pointsText,
  type KindKey,
  type SiteGroupOf
} from '../model'
import { siteRef } from '../aiContext'
import { citationsDrill, namedDrill, questionsDrill, type CompetitorDrillScope } from '../drills'

/**
 * Left out first, in order, when the list is narrower than its row; the drillable counts
 * stay longest. The Website column never goes (icon | name | domain | type, owner rule):
 * the share bar goes before it (audit2 #9).
 */
const NARROW_DROPS: readonly string[] = ['named', 'questions', 'change', 'share', 'gaps']

/** What a row's menu can do; each opens the competitor drawer or acts with an Undo. */
export interface CompetitorRowActions {
  onEdit: (row: CitedSiteRow) => void
  onRemove: (row: CitedSiteRow) => void
  onMerge: (row: CitedSiteRow) => void
}

/**
 * Every cited site, saved competitor and the project itself in the one list grid, one
 * line per row: the site's icon, name, website and type in their own columns, then a
 * share bar and the counts. One Filter ▾ holds the site type (the same kinds and counts
 * as the table above, audit2 #9) and "New this period". The project's row carries the
 * highlighter mark and is not counted. Citations, Questions and Named open the links or
 * questions behind each number. The kind, New, search, sort and open row are the caller's (the URL).
 */
export function CompetitorGrid({
  rows,
  lines,
  siteActions,
  onlyNew,
  kind,
  search,
  sort,
  selectedId,
  saving,
  drillScope,
  actions,
  onNew,
  onKind,
  onSearch,
  onSort,
  onOpen,
  onAdd,
  onPin
}: {
  rows: readonly CitedSiteRow[]
  /** Each row's type, by row id, with the user's choices applied. */
  lines: ReadonlyMap<string, SourceLine>
  /** The Type column's menu and its "Mark as competitor". */
  siteActions: SourceActions
  /** Only the sites first cited in this period (`view=new`). */
  onlyNew: boolean
  /** The site type filter. Null: every type. */
  kind: KindKey | null
  search: string
  sort: readonly GridSortKey[]
  selectedId: string | null
  /** Row id whose "Mark as competitor" is saving. */
  saving: string | null
  drillScope: CompetitorDrillScope
  actions: CompetitorRowActions
  onNew: (onlyNew: boolean) => void
  onKind: (kind: KindKey | null) => void
  onSearch: (value: string) => void
  onSort: (sort: readonly GridSortKey[]) => void
  onOpen: (row: CitedSiteRow) => void
  onAdd: (row: CitedSiteRow) => void
  /** Pin to Summary: a Competitor watch widget for this site. */
  onPin?: (row: CitedSiteRow) => void
}): JSX.Element {
  // Cited sites come from Google AI Overview checks: its logo holds the engine spot (audit #4).
  const engine = useEngineFilter(GOOGLE_ONLY)
  const lineOf = (row: CitedSiteRow): SourceLine => lines.get(row.id) ?? fallbackLine(row)
  const groupOf: SiteGroupOf = (row) => siteGroup(lineOf(row))
  const ofNew = newSites(rows, onlyNew)
  const shown = filterByKind(ofNew, kind)
  const scale = barScale(rows)
  const counts = kindCounts(ofNew)
  const others = (list: readonly CitedSiteRow[]): number =>
    list.filter((row) => row.kind !== 'you').length
  const filters: FilterGroup[] = [
    {
      id: 'kind',
      label: 'Site type',
      value: kind ?? 'all',
      resetValue: 'all',
      choices: [
        { value: 'all', label: 'Every site type', count: others(ofNew) },
        ...KIND_OPTIONS.flatMap((option) =>
          option.value !== '' && ((counts.get(option.value) ?? 0) > 0 || option.value === kind)
            ? [{ value: option.value, label: option.label, count: counts.get(option.value) ?? 0 }]
            : []
        )
      ],
      onChange: (value) => onKind(value === 'all' ? null : (value as KindKey))
    },
    {
      id: 'new',
      label: 'Show',
      value: onlyNew ? 'new' : 'all',
      resetValue: 'all',
      choices: [
        { value: 'all', label: 'Every site', count: others(filterByKind(rows, kind)) },
        {
          value: 'new',
          label: 'New this period',
          count: others(filterByKind(newSites(rows, true), kind))
        }
      ],
      onChange: (value) => onNew(value === 'new')
    }
  ]
  const columns: readonly ListColumn<CitedSiteRow>[] = [
    ...siteColumns<CitedSiteRow>({
      site: (row) => ({
        domain: row.domain,
        name: row.name,
        own: row.kind === 'you',
        isNew: row.isNew
      }),
      line: lineOf,
      actions: siteActions,
      typeHint: (row) =>
        row.kind === 'competitor'
          ? row.tier === 'partial'
            ? 'Partial competitor: competes with part of what you offer.'
            : 'One of your saved competitors.'
          : undefined,
      websiteWidth: 152,
      typeWidth: 196,
      nameMinWidth: 128
    }),
    {
      id: 'share',
      label: 'Share of citations',
      width: 136,
      sort: (row) => row.share,
      render: (row) => <ShareBar row={row} scale={scale} />
    },
    {
      id: 'change',
      label: 'Change',
      width: 76,
      numeric: true,
      // No check old enough to compare: the column would be all dashes (audit2 #14).
      hideWhenEmpty: true,
      sort: (row) => row.shareChange,
      render: (row) => <ChangeCell change={row.shareChange} you={row.kind === 'you'} />
    },
    {
      id: 'citations',
      label: 'Citations',
      width: 84,
      numeric: true,
      sort: (row) => row.citations,
      render: (row) =>
        row.citations === 0 ? (
          0
        ) : (
          <DrillNumber
            drill={citationsDrill(row, drillScope)}
            label={`${row.citations} links to ${row.name}`}
          />
        )
    },
    {
      id: 'questions',
      label: 'Searches',
      hint: 'Searches whose AI Overview links to this site (questions and keywords).',
      width: 88,
      numeric: true,
      sort: (row) => row.questions,
      render: (row) =>
        row.questions === 0 ? (
          0
        ) : (
          <DrillNumber
            drill={questionsDrill(row, drillScope)}
            label={`${pluralize(row.questions, 'search', 'searches')} citing ${row.name}`}
          />
        )
    },
    {
      id: 'named',
      label: 'Named',
      width: 72,
      numeric: true,
      sort: (row) => row.named,
      render: (row) =>
        row.named === null ? (
          <span className="faint">—</span>
        ) : row.named === 0 ? (
          0
        ) : (
          <DrillNumber
            drill={namedDrill(row, drillScope)}
            label={`${pluralize(row.named, 'search', 'searches')} naming ${row.name}`}
          />
        )
    },
    {
      id: 'gaps',
      label: 'Cited, not you',
      hint: 'Searches whose AI Overview cites this site and not yours: Not cited for you.',
      width: 104,
      numeric: true,
      sort: (row) => (row.kind === 'you' ? null : row.gaps.length),
      render: (row) =>
        row.kind === 'you' ? (
          <span className="faint">—</span>
        ) : row.gaps.length === 0 ? (
          0
        ) : (
          <button
            type="button"
            className="cmp-link cmp-not-cited num"
            aria-label={`${pluralize(row.gaps.length, 'search', 'searches')} cite ${row.name} and not you`}
            onClick={() => onOpen(row)}
          >
            <ResultDot result="not_cited" />
            {row.gaps.length}
          </button>
        )
    }
  ]

  function menu(row: CitedSiteRow): MenuItem[] {
    if (row.kind === 'you') return []
    const items: MenuItem[] = [
      {
        id: 'gaps',
        label: 'Where it’s cited and you’re not',
        icon: 'eye',
        onSelect: () => onOpen(row)
      }
    ]
    if (onPin && row.domain) {
      items.push({ id: 'pin', label: 'Pin to Summary', icon: 'pin', onSelect: () => onPin(row) })
    }
    // A known platform (Reddit, YouTube, G2) is where buyers look, never a competitor.
    if (row.kind === 'other' && groupOf(row) !== 'platform') {
      items.push({
        id: 'add',
        label: 'Mark as competitor',
        icon: 'plus',
        disabled: saving !== null,
        onSelect: () => onAdd(row)
      })
    }
    if (row.kind === 'competitor') {
      items.push(
        { id: 'edit', label: 'Edit…', icon: 'pencil', onSelect: () => actions.onEdit(row) },
        { id: 'merge', label: 'Merge with…', icon: 'merge', onSelect: () => actions.onMerge(row) },
        {
          id: 'remove',
          label: 'Remove from competitors',
          icon: 'trash',
          onSelect: () => actions.onRemove(row)
        }
      )
    }
    return items
  }

  return (
    <section className="cmp-sites" aria-label="Every cited site">
      <ListGrid<CitedSiteRow>
        label="Cited sites"
        noun={['site', 'sites']}
        rows={shown}
        rowKey={(row) => row.id}
        rowLabel={(row) => row.name}
        narrowDrops={NARROW_DROPS}
        columns={[...columns, askColumn(siteRef)]}
        sort={sort.length > 0 ? sort : DEFAULT_SORT}
        onSortChange={onSort}
        searchValue={search}
        onSearchChange={onSearch}
        search={{
          text: (row) => `${row.name} ${row.domain ?? ''}`,
          placeholder: 'Search sites'
        }}
        engine={engine.slot}
        filters={filters}
        // Your own row is there to compare with, not counted (the same as the filter's counts).
        summary={(info) => {
          const sites = info.matching - (shown.some((row) => row.kind === 'you') ? 1 : 0)
          return info.last - info.first + 1 < info.matching
            ? `${info.first}–${info.last} of ${info.matching}`
            : `${pluralize(sites, 'site')}${shown.some((row) => row.kind === 'you') ? ', and yours to compare' : ''}`
        }}
        // A page of rows shows whole; the screen scrolls, not a box inside it.
        fitPage
        onActivate={onOpen}
        isRowCurrent={(row) => row.id === selectedId}
        rowMenu={menu}
        empty={
          <EmptyState
            title="No sites cited yet."
            body="Once a page or topic has a check, the sites its AI Overviews cite show here."
          />
        }
      />
    </section>
  )
}

/** A row's type before the user's choices load: from its kind alone. */
function fallbackLine(row: CitedSiteRow): SourceLine {
  return {
    key: row.id,
    position: 0,
    url: '',
    domain: row.domain ?? '',
    site: row.domain ?? '',
    title: null,
    type: row.kind === 'you' ? 'yours' : row.kind === 'competitor' ? 'competitor' : 'web',
    customType: null,
    relation:
      row.kind === 'you'
        ? { kind: 'own', tracked: true }
        : row.kind === 'competitor'
          ? { kind: 'competitor', name: row.name, id: row.id }
          : { kind: 'neutral' },
    typeEdited: false,
    roleEdited: false,
    cited: null
  }
}

function ShareBar({ row, scale }: { row: CitedSiteRow; scale: number }): JSX.Element {
  const width = scale === 0 || row.share === null ? 0 : (row.share / scale) * 100
  return (
    <span className="cmp-share">
      <span className="cmp-bar" aria-hidden="true">
        <span
          className={row.kind === 'you' ? 'cmp-bar-fill cmp-bar-you' : 'cmp-bar-fill'}
          style={{ width: `${width}%` }}
        />
      </span>
      <span className="cmp-share-text num">{percent(row.share)}</span>
    </span>
  )
}

function ChangeCell({ change, you }: { change: number | null; you: boolean }): JSX.Element {
  if (change === null) return <span className="faint">—</span>
  const text = pointsText(change)
  if (text === null) return <span className="faint">0</span>
  // Your share going up is good; a competitor's going up is not.
  const good = change > 0 === you
  return <span className={good ? 'cmp-change-ok' : 'cmp-change-bad'}>{text}</span>
}
