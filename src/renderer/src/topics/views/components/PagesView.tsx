import { useMemo, useState, type JSX } from 'react'
import {
  Button,
  Chip,
  FilterBar,
  IconButton,
  SearchBox,
  SegmentedControl,
  UiIcon,
  UrlText
} from '../../../ui'
import { filterSearches, pagesView, pathOf, type OwnPageRow, type SiteRow } from '../model'
import type { ViewEnv } from '../types'
import { CountLink } from './cells'
import { kindFilter, kindMatches } from './kindFilter'

/** Rows shown in a section before "Show N more". */
const SHOWN = 3

function Toggle({
  open,
  label,
  onToggle
}: {
  open: boolean
  label: string
  onToggle: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className="tv-arrow"
      aria-expanded={open}
      aria-label={open ? `Close ${label}` : `Open ${label}`}
      onClick={onToggle}
    >
      <UiIcon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
    </button>
  )
}

function pageKey(page: OwnPageRow): string {
  return page.url ?? 'none'
}

function PageLine({
  page,
  env,
  open,
  onToggle
}: {
  page: OwnPageRow
  env: ViewEnv
  open: boolean
  onToggle: () => void
}): JSX.Element {
  const [all, setAll] = useState(false)
  const name = page.url === null ? 'No target page yet' : pathOf(page.url)
  const parts = all ? page.breakdown : page.breakdown.slice(0, SHOWN)
  const rest = page.breakdown.slice(SHOWN)
  return (
    <>
      <tr className="tv-pages-row">
        <th scope="row">
          <span className="tv-pages-name">
            {page.breakdown.length > 0 ? (
              <Toggle open={open} label={name} onToggle={onToggle} />
            ) : (
              <span className="tv-arrow-space" />
            )}
            {page.url === null ? (
              <b>{name}</b>
            ) : (
              <UrlText path={name} site={env.site} icon={false} />
            )}
          </span>
        </th>
        <td>
          {page.url === null ? (
            <Chip tone="warn" size="sm">
              Write a new page
            </Chip>
          ) : page.role === 'target' ? (
            <Chip tone="ok" size="sm">
              Target
            </Chip>
          ) : (
            <Chip tone="info" size="sm">
              Your other page
            </Chip>
          )}
        </td>
        <td className="num">
          <CountLink
            count={page.citedFor}
            filter={page.filter}
            drillHref={env.drillHref}
            label={`${name}: open the ${page.citedFor} searches it is cited for`}
          />
        </td>
        <td className="num">
          {page.role === 'target' ? (
            <CountLink
              count={page.stillToWin}
              filter={{ ...page.filter, result: 'not_cited' }}
              drillHref={env.drillHref}
              label={`${name}: open the ${page.stillToWin} searches still to win`}
            />
          ) : (
            '—'
          )}
        </td>
        <td className="ui-lg-action">
          {page.role === 'target' && page.stillToWin > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                env.openBrief(filterSearches(env.searches, { ...page.filter, result: 'not_cited' }))
              }
            >
              Get fix brief
            </Button>
          ) : page.role === 'other' && env.chooseOwner ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => env.chooseOwner?.(filterSearches(env.searches, page.filter))}
            >
              Choose owner
            </Button>
          ) : null}
        </td>
      </tr>
      {open
        ? parts.map((part) => (
            <tr key={part.id} className="tv-pages-sub">
              <th scope="row">
                <span className="tv-pages-subname">
                  <span>{part.label}</span>
                  <span className="tv-muted">
                    {' '}
                    · {part.cited} cited, {part.toWin} to win
                  </span>
                </span>
              </th>
              <td />
              <td className="num">{part.cited}</td>
              <td className="num">
                <CountLink
                  count={part.toWin}
                  filter={{ ...page.filter, ...part.filter, result: 'not_cited' }}
                  drillHref={env.drillHref}
                  label={`${name} · ${part.label}: open the ${part.toWin} searches to win`}
                />
              </td>
              <td />
            </tr>
          ))
        : null}
      {open && !all && rest.length > 0 ? (
        <tr className="tv-pages-sub">
          <td colSpan={5}>
            <Button size="sm" variant="ghost" icon="chevron-down" onClick={() => setAll(true)}>
              Show{' '}
              {rest
                .map((part) => part.label)
                .join(', ')
                .replace(/, ([^,]*)$/, ' and $1')}
            </Button>
          </td>
        </tr>
      ) : null}
    </>
  )
}

function SiteLine({ site, env }: { site: SiteRow; env: ViewEnv }): JSX.Element {
  return (
    <tr className="tv-pages-row">
      <th scope="row">
        <span className="tv-pages-name">
          <span className="tv-arrow-space" />
          <UrlText domain={site.domain} />
        </span>
      </th>
      <td>
        <Chip tone="neutral" size="sm" className="tv-chip-other">
          Other site
        </Chip>
      </td>
      <td className="num">
        <CountLink
          count={site.searches}
          filter={site.filter}
          drillHref={env.drillHref}
          label={`${site.domain}: open the ${site.searches} searches that cite it`}
        />
      </td>
      <td />
      <td />
    </tr>
  )
}

/**
 * The Pages view (TopicPages, for writers): your pages, target first, with what each is
 * cited for and what the target still has to win; the sites Google cites instead; and
 * the searches that need no page. Every count opens its drill.
 */
export function PagesView({ env }: { env: ViewEnv }): JSX.Element {
  const searches = useMemo(
    () => env.searches.filter((search) => kindMatches(search, env.type)),
    [env.searches, env.type]
  )
  const view = useMemo(() => pagesView(searches), [searches])
  const [query, setQuery] = useState('')
  const [allSites, setAllSites] = useState(false)
  // Pages start closed (owner 2026-10-30), with one Expand all / Collapse all.
  const [openPages, setOpenPages] = useState<ReadonlySet<string>>(() => new Set())
  const needle = query.trim().toLowerCase()
  const pages = view.pages.filter(
    (page) => needle === '' || (page.url ?? 'no target page').toLowerCase().includes(needle)
  )
  const sites = view.sites.filter((site) => needle === '' || site.domain.includes(needle))
  const shownSites = allSites ? sites : sites.slice(0, SHOWN)
  const foldable = pages.filter((page) => page.breakdown.length > 0).map(pageKey)
  const allOpen = foldable.length > 0 && foldable.every((key) => openPages.has(key))
  const togglePage = (key: string): void =>
    setOpenPages((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const segment = kindFilter(env)
  const citedParts = view.pages.filter((page) => page.citedFor > 0).map((page) => page.citedFor)
  return (
    <section className="ui-panel tv-pages" aria-label="Pages">
      <FilterBar
        label="Pages filters"
        end={
          <>
            <SearchBox label="Search pages" value={query} onChange={setQuery} />
            {foldable.length > 0 ? (
              <IconButton
                icon={allOpen ? 'chevron-up' : 'chevron-down'}
                label={allOpen ? 'Collapse all' : 'Expand all'}
                tip
                size="sm"
                onClick={() => setOpenPages(allOpen ? new Set() : new Set(foldable))}
              />
            ) : null}
          </>
        }
      >
        {env.engine?.control}
        <SegmentedControl
          size="sm"
          label={segment.label}
          options={segment.options}
          value={segment.value}
          onChange={segment.onChange}
        />
      </FilterBar>
      <table className="tv-pages-table">
        <thead>
          <tr>
            <th scope="col">Page</th>
            <th scope="col">Role</th>
            <th scope="col" className="num">
              Cited for
            </th>
            <th scope="col" className="num">
              Still to win
            </th>
            <th scope="col">
              <span className="sr-only">Action</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="tv-pages-section">
            <th scope="rowgroup" colSpan={5}>
              Your pages
            </th>
          </tr>
          {pages.length === 0 ? (
            <tr>
              <td colSpan={5} className="tv-muted">
                No page of yours is cited or aimed at yet.
              </td>
            </tr>
          ) : (
            pages.map((page) => (
              <PageLine
                key={pageKey(page)}
                page={page}
                env={env}
                open={openPages.has(pageKey(page))}
                onToggle={() => togglePage(pageKey(page))}
              />
            ))
          )}
          <tr className="tv-pages-section">
            <th scope="rowgroup" colSpan={5}>
              Cited instead of you
            </th>
          </tr>
          {shownSites.map((site) => (
            <SiteLine key={site.domain} site={site} env={env} />
          ))}
          {!allSites && sites.length > SHOWN ? (
            <tr>
              <td colSpan={5}>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="chevron-down"
                  onClick={() => setAllSites(true)}
                >
                  Show {sites.length - SHOWN} more sites
                </Button>
              </td>
            </tr>
          ) : null}
          <tr className="tv-pages-section">
            <th scope="rowgroup" colSpan={5}>
              No page needed
            </th>
          </tr>
          <tr className="tv-pages-row">
            <th scope="row">
              <span className="tv-pages-name">
                <span className="tv-arrow-space" />
                <b>{env.words.none}</b>
              </span>
            </th>
            <td className="tv-muted">
              {env.words.engine
                ? `${env.words.engine} gave no answer`
                : 'Google answered without one'}
            </td>
            <td className="num">
              <CountLink
                count={view.noAio}
                filter={{ result: 'no_overview' }}
                drillHref={env.drillHref}
                label={`Open the ${view.noAio} searches with ${env.words.noneLegend}`}
              />
            </td>
            <td />
            <td />
          </tr>
        </tbody>
      </table>
      <p className="tv-footer num">
        Your pages: {citedParts.length > 0 ? citedParts.join(' + ') : '0'} cited · {view.stillToWin}{' '}
        still to win · {view.noAio} need no page
        {view.notChecked > 0 ? ` · ${view.notChecked} not checked yet` : ''} = {view.total}
      </p>
    </section>
  )
}
