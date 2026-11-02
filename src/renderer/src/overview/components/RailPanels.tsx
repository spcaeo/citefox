import type { JSX, ReactNode } from 'react'
import type { OverviewCitedSite, OverviewFirstReport } from '@shared/ipc'
import { PAGE_FIX_KIND_COPY, type PageFix } from '@shared/page-fixes'
import { pluralize } from '@shared/pluralize'
import { DrillButton, DrillNumber, type ItemDrill } from '../../drill'
import { openPageFix } from '../../fixes/todo/openPageFix'
import { drawerHref } from '../../shell/drawers'
import { startHash } from '../../shell/routes'
import { BarFill, Panel, UrlText } from '../../ui'
import { OVERVIEW_LINKS, firstReportLine, siteUrl } from '../model'

/**
 * Top cited sites and the project (marked), as bars of questions cited. With a
 * compared check, a faint bar under each shows its count then. Each count opens
 * the questions citing that site.
 */
export function CitedSitesPanel({
  sites,
  compared,
  drillFor,
  tools
}: {
  sites: readonly OverviewCitedSite[]
  /** How the compared check reads ("the previous check"). Null: no earlier bars. */
  compared: string | null
  /** The questions behind a site's count. */
  drillFor: (site: OverviewCitedSite) => ItemDrill
  /** The widget's own controls (its engine filter), after the head link. */
  tools?: ReactNode
}): JSX.Element {
  const showBefore = compared !== null && sites.some((site) => site.before !== null)
  const top = Math.max(
    1,
    ...sites.map((site) => Math.max(site.count, showBefore ? (site.before ?? 0) : 0))
  )
  return (
    <Panel
      title="Who gets cited"
      padding={16}
      actions={
        <>
          <a className="ov-link" href={OVERVIEW_LINKS.competitors}>
            Competitors →
          </a>
          {tools}
        </>
      }
    >
      {sites.every((site) => site.count === 0 && (site.before ?? 0) === 0) ? (
        <p className="ov-note">No overview cites a site yet.</p>
      ) : (
        <>
          <ul className="ov-sites" aria-label="Questions citing each site">
            {sites.map((site) => (
              <li key={`${site.own ? 'own' : 'site'}:${site.name}`} className="ov-site">
                <span className={site.own ? 'ov-site-name ov-own' : 'ov-site-name'}>
                  {site.domain ? (
                    // The site's icon, its name, and Copy / Open for its home page. The own
                    // row's highlighter is .ov-own around it.
                    <UrlText
                      url={siteUrl(site.domain ?? site.name)}
                      label={site.name}
                      variant="domain"
                    />
                  ) : (
                    <span title={site.name}>{site.name}</span>
                  )}
                </span>
                <span className="ov-site-bars" aria-hidden="true">
                  <BarFill share={site.count / top} tone={site.own ? 'cited' : 'other'} />
                  {showBefore ? (
                    <BarFill share={(site.before ?? 0) / top} tone="past" faint />
                  ) : null}
                </span>
                <span className="ov-site-count num">
                  <SiteCount
                    site={site}
                    drill={drillFor(site)}
                    before={
                      showBefore && site.before !== null ? `, ${site.before} at ${compared}` : ''
                    }
                  />
                </span>
              </li>
            ))}
          </ul>
          {showBefore ? (
            <p className="ov-legend">
              <span className="ov-legend-swatch" aria-hidden="true" /> Faint bar: {compared}
            </p>
          ) : null}
        </>
      )}
    </Panel>
  )
}

/** A site's count: it opens the questions citing the site (plain text at zero). */
function SiteCount({
  site,
  drill,
  before
}: {
  site: OverviewCitedSite
  drill: ItemDrill
  before: string
}): JSX.Element {
  const count = drill.items.length
  return (
    <DrillNumber drill={drill} label={`${site.name}: ${pluralize(count, 'question')}${before}`} />
  )
}

/**
 * The top page fixes of What to fix (its order: improve, then pick an owner, then new
 * pages, most searches first), with a link to all of them. The count is the Fixes
 * badge's. Null fixes: still loading, or the list could not be read.
 */
export function NextFixesPanel({
  fixes,
  total,
  domain,
  allDrill = null,
  searchesDrillFor,
  tools
}: {
  fixes: readonly PageFix[] | null
  total: number | null
  domain: string
  /** Every page fix to do, which "All N" opens over Summary. Null while loading. */
  allDrill?: ItemDrill | null
  /** The searches one fix covers, which its "N searches" opens. */
  searchesDrillFor?: (fix: PageFix) => ItemDrill
  /** The widget's own controls, after the head link. */
  tools?: ReactNode
}): JSX.Element {
  return (
    <Panel
      title="Next fixes"
      padding={16}
      actions={
        <>
          {allDrill !== null && allDrill.items.length > 0 ? (
            <DrillButton
              drill={allDrill}
              className="ov-link ov-all-fixes"
              label={`All ${allDrill.items.length.toLocaleString('en-US')} page fixes: open them`}
            >
              All <span data-nfr-figure={allDrill.id}>{allDrill.items.length}</span> →
            </DrillButton>
          ) : (
            <a className="ov-link" href={OVERVIEW_LINKS.fixes}>
              {total !== null && total > 0 ? `All ${total} →` : 'All fixes →'}
            </a>
          )}
          {tools}
        </>
      }
    >
      {fixes === null ? (
        <p className="ov-note" role="status">
          Loading the page fixes…
        </p>
      ) : fixes.length === 0 ? (
        <p className="ov-note">
          No page fixes now: every search with an AI Overview already cites its target page.
        </p>
      ) : (
        <ul className="ov-fixes">
          {fixes.map((fix) => (
            <li key={fix.id} className="ov-fix">
              <span className="ov-fix-head">
                <a
                  className="ov-fix-title"
                  href={drawerHref('page-fix', { 'pfx.id': fix.id })}
                  title={fixTitle(fix)}
                  onClick={(event) => {
                    // Over the live URL, so nothing the screen changed since it drew is lost.
                    event.preventDefault()
                    openPageFix([fix.id])
                  }}
                >
                  {fixTitle(fix)}
                </a>
                <span className="ov-fix-count num">
                  {searchesDrillFor ? (
                    <DrillNumber
                      drill={searchesDrillFor(fix)}
                      suffix={fix.searches.length === 1 ? ' search' : ' searches'}
                      label={`${pluralize(fix.searches.length, 'search', 'searches')} in this fix`}
                    />
                  ) : (
                    pluralize(fix.searches.length, 'search', 'searches')
                  )}
                </span>
              </span>
              <span className="ov-fix-meta">
                {fix.page ? (
                  <UrlText url={fix.page.url} label={pathOf(fix.page.url)} site={domain} />
                ) : (
                  <span>{fix.proposed ?? 'No target page yet'}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/** What the fix asks for, in What to fix's words. */
function fixTitle(fix: PageFix): string {
  return PAGE_FIX_KIND_COPY[fix.kind].title
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}` || '/'
  } catch {
    return url
  }
}

/** What the first check from setup found, with its report and the pages it suggested. */
export function FirstReportPanel({ report }: { report: OverviewFirstReport }): JSX.Element {
  return (
    <Panel title="First check report" padding={16}>
      <p className="ov-note">{firstReportLine(report)}</p>
      <div className="ov-report-links">
        <a className="ov-link" href={startHash('results')}>
          Open report
        </a>
        {report.untrackedSuggested > 0 ? (
          <a className="ov-link" href={startHash('plan')}>
            Track the {pluralize(report.untrackedSuggested, 'page')}
          </a>
        ) : null}
      </div>
    </Panel>
  )
}
