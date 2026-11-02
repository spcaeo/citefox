import { useCallback, useMemo, type JSX } from 'react'
import type { PageResults } from '@shared/domain'
import { DrillButton, DrillNumber, useDrill } from '../drill'
import { siteColumns } from '../sites/siteColumns'
import { useSiteTypeSettings } from '../sites/useSiteTypeSettings'
import {
  leaderLine,
  leaderLines,
  siteGroup,
  SITE_GROUP_FILTERS,
  type SiteGroupFilter
} from '../sites/siteRows'
import { useHashQuery } from '../utils/hashQuery'
import { ListGrid, SectionHead, type ListColumn, type MenuItem } from '../ui'
import { aiOverviewLabel } from './model'
import type { ResultsDrills } from './results/drills'

type LeaderRow = PageResults['leaderboard'][number]

const CITED_QUERY = ['citedType'] as const

function groupFilterFrom(value: string | null): SiteGroupFilter {
  return SITE_GROUP_FILTERS.find((item) => item.id === value)?.id ?? 'all'
}

/**
 * "Who gets cited": every site in the overviews' sources, one line each (icon, name,
 * website, type), with a type filter (`citedType` in the URL) and sorting. Types follow
 * the project's hand-picked choices. A site's name opens the questions that cite it.
 */
export function Leaderboard({
  results,
  aio,
  drills,
  projectId = null
}: {
  results: PageResults
  aio: number
  drills: ResultsDrills
  /** The project, so the types follow its hand-picked choices. Null: automatic types. */
  projectId?: string | null
}): JSX.Element {
  const domain = drills.scope.domain
  const { open } = useDrill()
  const [query, setQuery] = useHashQuery(CITED_QUERY)
  const type = groupFilterFrom(query.citedType)
  const setType = (value: SiteGroupFilter): void =>
    setQuery({ citedType: value === 'all' ? null : value })
  const types = useSiteTypeSettings(projectId)
  const all = results.leaderboard
  const lines = useMemo(() => leaderLines(all, types.competitors, types.settings), [all, types])
  const lineOf = useCallback((row: LeaderRow) => leaderLine(lines, row), [lines])
  const rows = useMemo(
    () => (type === 'all' ? all : all.filter((row) => siteGroup(lineOf(row)) === type)),
    [all, type, lineOf]
  )
  const domainDrill = useCallback(
    (row: LeaderRow) =>
      row.badge === 'you' ? drills.get('funnel:own_domain') : drills.get(`domain:${row.domain}`),
    [drills]
  )

  const columns = useMemo(
    (): ListColumn<LeaderRow>[] => [
      ...siteColumns<LeaderRow>({
        site: (row) => ({ domain: row.domain, own: row.badge === 'you' }),
        drill: domainDrill,
        drillLabel: (row) => `${row.domain}: show the questions that cite it`,
        line: lineOf,
        websiteWidth: 176,
        typeWidth: 128
      }),
      {
        id: 'overviews',
        label: 'Overviews',
        width: 96,
        numeric: true,
        sort: (row) => row.aioCount,
        render: (row) => {
          const drill = domainDrill(row)
          return drill ? <DrillNumber drill={drill} /> : row.aioCount
        }
      },
      {
        id: 'overlap',
        label: 'Overlap',
        width: 88,
        numeric: true,
        sort: (row) => row.overlap,
        render: (row) => {
          if (row.overlap === null) return '—'
          const drill = row.badge === 'you' ? null : drills.get(`overlap:${row.domain}`)
          return drill ? <DrillNumber drill={drill} /> : row.overlap
        }
      },
      {
        id: 'gap',
        label: 'Gap',
        width: 72,
        numeric: true,
        sort: (row) => row.gap,
        render: (row) => {
          if (row.gap === null) return '—'
          const drill = row.gap > 0 ? drills.get(`gap:${row.domain}`) : null
          return drill ? <DrillNumber drill={drill} /> : row.gap
        }
      },
      {
        id: 'avg',
        label: 'Avg position',
        width: 104,
        numeric: true,
        sort: (row) => row.averagePosition,
        render: (row) => {
          const positions = drills.positions(row.domain)
          const text = row.averagePosition.toFixed(1)
          return positions ? (
            <DrillButton
              drill={positions}
              untracked
              className="m3-cell-btn"
              label={`Average position ${text}: where ${row.domain} sits in each overview`}
            >
              {text}
            </DrillButton>
          ) : (
            text
          )
        }
      }
    ],
    [domainDrill, drills, lineOf]
  )

  const rowMenu = useCallback(
    (row: LeaderRow): MenuItem[] => {
      const items: MenuItem[] = []
      const cites = domainDrill(row)
      if (cites) {
        items.push({
          id: 'cites',
          label: 'Show the questions that cite it',
          icon: 'eye',
          onSelect: () => open(cites)
        })
      }
      const gap = row.gap !== null && row.gap > 0 ? drills.get(`gap:${row.domain}`) : null
      if (gap) {
        items.push({
          id: 'gap',
          label: `Cited where ${domain} is not`,
          icon: 'target',
          onSelect: () => open(gap)
        })
      }
      const positions = drills.positions(row.domain)
      if (positions) {
        items.push({
          id: 'positions',
          label: 'Where it sits in each overview',
          icon: 'layers',
          onSelect: () => open(positions)
        })
      }
      return items
    },
    [domain, domainDrill, drills, open]
  )

  return (
    <section className="m3-section" id="m3-leaders" aria-labelledby="m3-lb-h">
      <SectionHead
        id="m3-lb-h"
        title="Who gets cited"
        description={`Every domain in the sources of the ${aiOverviewLabel(aio)}. Overlap: overviews citing both them and ${domain}. Gap: overviews citing them but no ${domain} page — the list to attack.`}
      />
      <ListGrid
        label="Domains cited in the AI Overviews"
        noun={['domain', 'domains']}
        rows={rows}
        rowKey={(row) => row.domain}
        rowLabel={(row) => row.domain}
        columns={columns}
        search={{ text: (row) => row.domain }}
        filter={{
          label: 'Type',
          options: SITE_GROUP_FILTERS.filter(
            (item) => item.id === 'all' || all.some((row) => siteGroup(lineOf(row)) === item.id)
          ).map((item) => ({
            value: item.id,
            label: item.label,
            count:
              item.id === 'all'
                ? all.length
                : all.filter((row) => siteGroup(lineOf(row)) === item.id).length
          })),
          value: type,
          onChange: (value) => setType(value as SiteGroupFilter),
          resetValue: 'all'
        }}
        rowMenu={rowMenu}
        pageSize={10}
        empty={<p className="muted">No sources were cited in this check.</p>}
      />
    </section>
  )
}
