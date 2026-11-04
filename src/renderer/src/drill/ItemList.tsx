import { useMemo, useState, type JSX } from 'react'
import { Markdown } from '../components/Markdown'
import { SiteIcon } from '../siteIcon/SiteIcon'
import { Button, CopyText, ListGrid, UrlText, type ListColumn } from '../ui'
import { FIRST_ROWS, isExternal, safeExternalUrl, targetHref } from './targets'
import type { DrillItem, DrillItemColumn, DrillTarget } from './types'

const PRIMARY_TRACK = 'minmax(140px, 2fr)'
const DEFAULT_TRACK = 'minmax(72px, 0.6fr)'

/** A drawer column's CSS track as a ListGrid width: `110px` is fixed, anything else is a track. */
function columnWidth(track: string | undefined): Pick<ListColumn<DrillItem>, 'width' | 'track'> {
  const fixed = track ? /^(\d+)px$/.exec(track.trim()) : null
  if (fixed) return { width: Number(fixed[1]) }
  const floor = /(\d+)px/.exec(track ?? DEFAULT_TRACK)
  return { width: floor ? Number(floor[1]) : 72, track: track ?? DEFAULT_TRACK }
}

function TargetLink({
  target,
  className,
  children
}: {
  target: DrillTarget
  className?: string
  children: string
}): JSX.Element {
  const href = targetHref(target)
  if (!href) return <span className={className}>{children}</span>
  return isExternal(target) ? (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="sr-only"> (opens in your browser)</span>
    </a>
  ) : (
    <a className={className} href={href}>
      {children}
    </a>
  )
}

function Primary({ item }: { item: DrillItem }): JSX.Element {
  const url = safeExternalUrl(item.url)
  const primaryClass = item.mono ? 'mono drill-primary' : 'drill-primary'
  const copyClass = item.mono ? 'drill-copy-mono' : ''
  return (
    <span className="drill-cell-stack">
      {url && item.mono ? (
        // An address: the site's icon, Copy and Open, cut in the middle when long.
        <UrlText url={url} label={item.primary} className="drill-primary" />
      ) : url ? (
        // A title that links to its page: the title wraps, the site's icon in front.
        <UrlText url={url} icon={false} plain>
          <a className={primaryClass} href={url} target="_blank" rel="noopener noreferrer">
            <SiteIcon domain={url} spaced />
            {item.primary}
            <span className="sr-only"> (opens in your browser)</span>
          </a>
        </UrlText>
      ) : item.target ? (
        // Opens a screen: the link keeps its own focus; Copy sits after it.
        <CopyText
          text={item.primary}
          interactiveLabel
          className={copyClass}
          wrap
          label={
            <TargetLink target={item.target} className={primaryClass}>
              {item.primary}
            </TargetLink>
          }
        />
      ) : (
        // A plain value (an email address, a claim, a market code): Copy on hover or focus.
        <CopyText text={item.primary} className={copyClass} wrap />
      )}
      {item.secondary ? (
        url && item.target ? (
          <TargetLink target={item.target} className="faint drill-secondary">
            {item.secondary}
          </TargetLink>
        ) : (
          <span className="faint drill-secondary">{item.secondary}</span>
        )
      ) : null}
    </span>
  )
}

/**
 * The non-prompt drawer's list (links, claims, pages, domains or checks) on
 * the kit ListGrid: every row drawn (the drawer scrolls), the first column
 * wrapping, rows with a `detail` expanding to its Markdown. Rows carry
 * `data-drill-row` (their place in the list) for the specs.
 */
export function ItemList({
  label,
  primaryLabel,
  columns,
  items,
  onOpen
}: {
  label: string
  primaryLabel: string
  columns: readonly DrillItemColumn[]
  items: readonly DrillItem[]
  onOpen: (target: DrillTarget) => void
}): JSX.Element | null {
  const [all, setAll] = useState(false)
  const shown = useMemo(() => (all ? items : items.slice(0, FIRST_ROWS)), [all, items])
  const opens = items.some((item) => item.target)
  const expandable = items.some((item) => item.detail)
  const hasMenu = items.some((item) => item.menu)
  const gridColumns = useMemo<ListColumn<DrillItem>[]>(
    () => [
      {
        id: 'primary',
        label: primaryLabel,
        width: 'fill',
        minWidth: 140,
        track: PRIMARY_TRACK,
        wrap: true,
        render: (item) => <Primary item={item} />
      },
      ...columns.map((column): ListColumn<DrillItem> => ({
        id: column.id,
        label: column.label,
        ...columnWidth(column.width),
        ...(column.align ? { align: column.align } : {}),
        numeric: column.align === 'end',
        render: (item) => item.cells?.[column.id] ?? '—'
      }))
    ],
    [columns, primaryLabel]
  )
  if (items.length === 0) return null

  return (
    <div className="drill-scroll">
      <ListGrid<DrillItem>
        label={label}
        noun={['row', 'rows']}
        rows={shown}
        rowKey={(item) => item.id}
        rowLabel={(item) => item.primary}
        columns={gridColumns}
        pageSize="all"
        virtualize={false}
        footer="paged"
        empty={null}
        className="drill-lg"
        rowProps={(_item, index) => ({ 'data-drill-row': index })}
        {...(opens
          ? {
              onActivate: (item: DrillItem) => {
                if (item.target) onOpen(item.target)
              }
            }
          : {})}
        {...(hasMenu ? { rowMenu: (item: DrillItem) => item.menu?.() ?? [] } : {})}
        {...(expandable
          ? {
              renderDetail: (item: DrillItem) => (
                <div className="drill-overview-text">
                  <Markdown baseLevel={4}>{item.detail ?? ''}</Markdown>
                </div>
              ),
              hasDetail: (item: DrillItem) => Boolean(item.detail),
              detailLabel: (item: DrillItem) => `more about ${item.primary}`
            }
          : {})}
      />
      {shown.length < items.length ? (
        <Button size="sm" className="drill-more" onClick={() => setAll(true)}>
          Show all {items.length}
        </Button>
      ) : null}
    </div>
  )
}
