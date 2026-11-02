import type { DrillRequest } from '../drill'
import { SiteIcon } from '../siteIcon/SiteIcon'
import type { ListColumn } from '../ui'
import { SiteNameCell, SiteWebsiteCell } from './SiteCells'
import { shownName, siteTypeName, type SiteCellData } from './siteRows'
import { SiteTypeCell } from './SiteTypeCell'
import type { SourceLine } from './sources'
import { NO_SOURCE_ACTIONS, type SourceActions } from './useSourceActions'
import './sites.css'

export interface SiteColumnsSpec<Row> {
  site: (row: Row) => SiteCellData
  /** The name opens what the list counts for the site (in the app), such as the overviews citing it. */
  drill?: (row: Row) => DrillRequest | null
  /** The drill button's accessible name. Default: the name. */
  drillLabel?: (row: Row) => string
  /** The row's type, with the user's choices applied. Absent: no Type column. */
  line?: (row: Row) => SourceLine
  /** The Type column's menu and quick action. Default: read-only. */
  actions?: SourceActions
  /** A topic's list: its target is "Your target page". */
  topic?: boolean
  /** A fuller tooltip for a row's type, such as "Partial competitor". */
  typeHint?: (row: Row) => string | undefined
  /** Width of the Type column. Default 232, room for its quick action. */
  typeWidth?: number
  /** Width of the Website column. Default 208. */
  websiteWidth?: number
  /** Smallest width of the Name column. Default 160. */
  nameMinWidth?: number
  /** The Name column's header, such as "Competitor". Default "Name". */
  nameLabel?: string
}

/**
 * The four columns every list of sites starts with, one line per row: the site's icon
 * (a narrow column of its own), its name, its website with Copy and Open, and its type.
 * The website is never empty; a site with no name but its host shows the domain as its
 * name too, with the website muted. Column ids: `icon`, `name`, `website`, `type`.
 */
export function siteColumns<Row>(spec: SiteColumnsSpec<Row>): ListColumn<Row>[] {
  const actions = spec.actions ?? NO_SOURCE_ACTIONS
  const columns: ListColumn<Row>[] = [
    {
      id: 'icon',
      label: 'Site icon',
      hideLabel: true,
      width: 20,
      render: (row) => {
        const { domain } = spec.site(row)
        return domain ? <SiteIcon domain={domain} /> : null
      }
    },
    {
      id: 'name',
      label: spec.nameLabel ?? 'Name',
      width: 'fill',
      minWidth: spec.nameMinWidth ?? 160,
      sort: (row) => shownName(spec.site(row)).toLowerCase(),
      render: (row) => (
        <SiteNameCell
          site={spec.site(row)}
          drill={spec.drill?.(row) ?? null}
          drillLabel={spec.drillLabel?.(row)}
        />
      )
    },
    {
      id: 'website',
      label: 'Website',
      width: spec.websiteWidth ?? 208,
      sort: (row) => spec.site(row).domain,
      render: (row) => <SiteWebsiteCell site={spec.site(row)} />
    }
  ]
  const { line } = spec
  if (line) {
    columns.push({
      id: 'type',
      label: 'Type',
      width: spec.typeWidth ?? 232,
      sort: (row) => siteTypeName(line(row), spec.topic),
      render: (row) => (
        <SiteTypeCell
          line={line(row)}
          actions={actions}
          topic={spec.topic}
          hint={spec.typeHint?.(row)}
        />
      )
    })
  }
  return columns
}
