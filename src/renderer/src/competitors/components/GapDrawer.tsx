import { useId, useMemo, type JSX } from 'react'
import type { Market } from '@shared/domain'
import type { CitedSiteRow, CompetitorProductOption } from '@shared/ipc'
import type { FixSearch } from '@shared/page-fixes'
import { pluralize } from '@shared/pluralize'
import {
  SITE_KIND_LABELS,
  SORTABLE_SITE_KINDS,
  isSortableSiteKind,
  type SortableSiteKind
} from '@shared/report/site-kinds'
import { marketLabel } from '../../shell/model'
import {
  Drawer,
  DrawerFacts,
  DrawerGrid,
  DrawerMain,
  DrawerRail,
  DrawerSection,
  UrlText
} from '../../ui'
import { RivalSearchGrid } from '../gaps/RivalSearchGrid'
import { GAP_VIEW_LABEL, rivalSearches, viewCounts, type GapView } from '../gaps/rivalSearches'
import type { GapActions } from '../hooks/useGapActions'
import { kindLabel, percent } from '../model'
import '../drawer/competitor-drawer.css'

/**
 * "Where X is cited": every search whose latest overview cites the site, in the
 * shared grid, opening on They win (cited, you're not). Both cited, All and
 * Their pages (grouped by the site's cited page) are one click away, the view
 * on the URL. Picked questions go to a topic or a logged fix; a site that is not
 * saved becomes a competitor, and its kind of site can be set. The rail keeps a
 * few facts, each count opening its view, and the products it is cited for.
 */
export function GapDrawer({
  row,
  markets,
  products,
  searches,
  view,
  onView,
  productHref,
  saving,
  actions,
  addable = true,
  onAdd,
  onEdit,
  onClose
}: {
  row: CitedSiteRow
  markets: readonly Market[]
  products: readonly CompetitorProductOption[]
  /** What to fix's searches, for your result and the win odds. */
  searches: readonly FixSearch[]
  view: GapView
  onView: (view: GapView) => void
  /** The screen filtered to one product, this drawer still open. */
  productHref: (productId: string | null) => string
  saving: boolean
  actions: GapActions
  /** False for a known platform (Reddit, YouTube, G2): never offered as a competitor. */
  addable?: boolean
  onAdd: (row: CitedSiteRow) => void
  /** Opens the competitor drawer for a saved competitor. */
  onEdit: (row: CitedSiteRow) => void
  onClose: () => void
}): JSX.Element {
  const base = useId()
  const marketName = (id: string): string => {
    const market = markets.find((item) => item.id === id)
    return market ? marketLabel(market) : 'Removed market'
  }
  const rows = useMemo(() => rivalSearches(row, searches), [row, searches])
  const counts = viewCounts(rows)
  const cited = row.byProduct.filter((item) => item.citations > 0)
  const viewButton = (target: GapView, value: number): JSX.Element => (
    <button
      type="button"
      className="cmp-fact-link num"
      aria-label={`${value.toLocaleString('en-US')}: show ${GAP_VIEW_LABEL[target]}`}
      onClick={() => onView(target)}
    >
      {value.toLocaleString('en-US')}
    </button>
  )
  return (
    <Drawer
      id="competitor-gaps"
      title={`Where ${row.name} is cited`}
      heading={
        <>
          Where {row.name} is cited ·{' '}
          <span className="num" data-drill-total="">
            {counts.all}
          </span>
        </>
      }
      subtitle={`${kindLabel(row)} · ${percent(row.share)} of citations`}
      focusOnOpen="close"
      onClose={onClose}
      footer={{
        cancel: 'Close',
        summary: actions.message ? (
          <span role={actions.error ? 'alert' : 'status'}>{actions.message}</span>
        ) : undefined,
        secondary:
          row.gaps.length > 0
            ? { label: 'Log a fix', icon: 'pencil', onClick: () => actions.logFix(row.gaps) }
            : undefined,
        primary:
          row.kind === 'other' && addable
            ? {
                label: 'Add as competitor',
                icon: 'plus',
                busy: saving,
                disabled: saving,
                onClick: () => onAdd(row)
              }
            : row.kind === 'competitor'
              ? { label: 'Edit competitor', icon: 'pencil', onClick: () => onEdit(row) }
              : undefined
      }}
    >
      <DrawerGrid>
        <DrawerMain>
          <RivalSearchGrid
            name={row.name}
            rows={rows}
            view={view}
            onView={onView}
            marketName={marketName}
            actions={actions}
          />
        </DrawerMain>
        <DrawerRail label="About this site">
          <DrawerSection title="This site">
            <DrawerFacts
              label="This site"
              items={[
                ...(row.kind === 'competitor'
                  ? [{ label: 'Saved as', value: kindLabel(row) }]
                  : []),
                ...(row.domain ? [{ label: 'Site', value: <UrlText domain={row.domain} /> }] : []),
                { label: 'Searches it’s cited for', value: viewButton('all', counts.all) },
                { label: 'Their pages cited', value: viewButton('pages', counts.pages) }
              ]}
            />
          </DrawerSection>
          {row.kind === 'other' ? (
            <DrawerSection
              title="Kind of site"
              description="Not a saved competitor. Set what kind of site it is, or add it as a competitor."
            >
              <label className="cmp-field" htmlFor={`${base}-kind`}>
                <span className="sr-only">Kind of site</span>
                <select
                  id={`${base}-kind`}
                  className="select"
                  value={isSortableSiteKind(row.siteKind) ? row.siteKind : ''}
                  disabled={actions.sorting}
                  onChange={(event) => {
                    const kind = event.target.value
                    if (isSortableSiteKind(kind)) void actions.setKind(row, kind)
                  }}
                >
                  <option value="" disabled>
                    Not sorted yet
                  </option>
                  {SORTABLE_SITE_KINDS.map((kind: SortableSiteKind) => (
                    <option key={kind} value={kind}>
                      {SITE_KIND_LABELS[kind]}
                    </option>
                  ))}
                </select>
              </label>
            </DrawerSection>
          ) : null}
          {cited.length > 0 ? (
            // Only the products it is cited for: a product with no citation says nothing.
            <DrawerSection title="By product">
              <ul className="cmp-products" aria-label="By product">
                {cited.map((item) => (
                  <li key={item.productId ?? 'none'} className="cmp-product">
                    <a href={productHref(item.productId)}>
                      {productName(products, item.productId)}
                    </a>
                    <span className="num muted">
                      {percent(item.share)} · {pluralize(item.citations, 'citation')}
                    </span>
                  </li>
                ))}
              </ul>
            </DrawerSection>
          ) : null}
        </DrawerRail>
      </DrawerGrid>
    </Drawer>
  )
}

function productName(
  products: readonly CompetitorProductOption[],
  productId: string | null
): string {
  if (productId === null) return 'No product'
  return products.find((item) => item.id === productId)?.name ?? 'Removed product'
}
