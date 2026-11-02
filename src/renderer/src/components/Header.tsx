import type { JSX, ReactNode } from 'react'
import { marketLabel, pageDetailTags } from '../shell/model'
import type { PageChrome } from '../projects/chrome'
import { openDrawer } from '../shell/drawers'
import { landingHash, pageHash, sectionHash } from '../shell/routes'
import { Chip } from '../ui/Chip'
import { IconButton } from '../ui/IconButton'
import { PageNav, type PageNavProps } from '../ui/PageNav'
import { PickerSelect } from '../ui/PickerSelect'
import { UrlText } from '../ui/UrlText'
import {
  HeaderActions,
  type HeaderMoreItem,
  type HeaderPrimary,
  type HeaderTool
} from './HeaderActions'

export type { HeaderConfirm, HeaderMoreItem, HeaderPrimary, HeaderTool } from './HeaderActions'

/**
 * A screen's header: the h1 and its actions. With `nav`, `meta` or
 * `titleAction` it is the v2 header (Theme.dc.html): the PageNav row (back
 * link, path, pager), then one title row with the h1, its chips (`meta`) and
 * the actions, every field label inline. Without them it renders as it always
 * has.
 *
 * Actions sit on the right only (Docs/HEADER.md), in a fixed order: `tools`
 * (icon only), then ⋯ (`more`; red items ask first in ui/Confirm), then
 * `primary`, the screen's one green button, at the far right.
 * The older `actions` slot still renders, before them, until every screen
 * has moved over.
 *
 * `title` takes rich content because Prompt detail's heading keeps its inline
 * Markdown; a plain string works as before.
 */
export function ScreenHeader({
  title,
  subtitle,
  tools,
  actions,
  primary,
  more,
  moreLabel,
  page = false,
  nav,
  meta,
  titleAction,
  className
}: {
  /** The h1's content: text, or inline rich content such as a Markdown span. */
  title: ReactNode
  subtitle?: ReactNode
  /** Tool icons (Download, Print, Copy link…), first at the right end. */
  tools?: readonly HeaderTool[]
  /** Older free-form actions. New screens use `tools`, `primary` and `more`. */
  actions?: ReactNode
  /** The one main action, as the green button (or a ready-made control such as a split button). */
  primary?: HeaderPrimary | ReactNode
  /** The ⋯ menu's items: everything that is not the main action. */
  more?: readonly HeaderMoreItem[]
  /** The ⋯ button's name. Default "More actions". */
  moreLabel?: string
  page?: boolean
  /** The row above the title: back link, path, pager (ui PageNav). */
  nav?: PageNavProps
  /** Chips after the title, on the same row (they wrap under it when there is no room). */
  meta?: ReactNode
  /**
   * One small control right after the h1, such as an Edit pencil. It stays on
   * the h1's first line while a long title wraps beside it.
   */
  titleAction?: ReactNode
  className?: string
}): JSX.Element {
  const hasActions =
    (tools?.length ?? 0) > 0 || Boolean(actions) || Boolean(primary) || (more?.length ?? 0) > 0
  const end = hasActions ? (
    <HeaderActions
      {...(tools ? { tools } : {})}
      actions={actions}
      primary={primary}
      {...(more ? { more } : {})}
      {...(moreLabel ? { moreLabel } : {})}
    />
  ) : null
  if (!nav && meta === undefined && titleAction === undefined) {
    return (
      <header
        className={className ? `screen-header ${className}` : 'screen-header'}
        data-guide="screen-header"
      >
        <div className={page ? 'screen-title page' : 'screen-title'}>
          <h1>{title}</h1>
          {subtitle}
        </div>
        {end ? <div className={page ? 'header-actions end' : 'header-actions'}>{end}</div> : null}
      </header>
    )
  }
  return (
    <header
      className={['screen-header ui-head', className ?? ''].filter(Boolean).join(' ')}
      data-guide="screen-header"
    >
      {nav ? <PageNav {...nav} className="ui-head-nav" /> : null}
      <div className="ui-head-row">
        <div className={titleAction ? 'ui-head-title ui-head-title-has-action' : 'ui-head-title'}>
          <h1>{title}</h1>
          {titleAction ? <span className="ui-head-title-action">{titleAction}</span> : null}
          {meta ? <div className="ui-head-meta">{meta}</div> : null}
        </div>
        {end ? <div className="ui-head-actions">{end}</div> : null}
      </div>
      {subtitle ? <div className="ui-head-sub">{subtitle}</div> : null}
    </header>
  )
}

/**
 * A header control with its label on the same line, such as "Market [US · EN]".
 * The label names the control (a wrapping `<label>`).
 */
export function HeaderField({
  label,
  children,
  className
}: {
  label: string
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <label className={className ? `ui-head-field ${className}` : 'ui-head-field'}>
      <span className="ui-head-field-label">{label}</span>
      {children}
    </label>
  )
}

/**
 * A page's v2 header: back link (named after the project) and the page's URL
 * and settings in one row, then the title, Market, ⋯ (Export report, Pin) and
 * Check now in one row. The top bar shows the path, so there is no in-page
 * breadcrumb.
 */
export function PageHeader({
  projectName,
  page,
  marketId,
  onMarketChange,
  checkHref = sectionHash('check'),
  exportHref = sectionHash('export'),
  checkPrimary = true,
  productField,
  checkControl,
  pin,
  back,
  pageId,
  paused = false,
  onMarketAdded
}: {
  projectName: string
  page: PageChrome
  marketId: string
  onMarketChange: (marketId: string) => void
  /** Page header Check now. Defaults to the queue screen. */
  checkHref?: string
  /** Export report. Pass `exportHash(pageId)` so Export starts on this page. */
  exportHref?: string
  /**
   * False before the first check: the page tab's review shows the one primary
   * ("Start first check"), so Check now steps back to an outline button.
   */
  checkPrimary?: boolean
  /** The product picker (prompt audit PC), before the market. Omitted: none. */
  productField?: ReactNode
  /** The back link above the title. Default: the page list, named after the project. */
  back?: { href: string; label: string }
  /** Replaces the plain Check now link (the page's "Check now ▾" split button). */
  checkControl?: ReactNode
  /** Pin to sidebar / Unpin from sidebar, under ⋯ after Export report. Omitted: none. */
  pin?: { pinned: boolean; onToggle: () => void }
  /**
   * The page's id: its chips become buttons that open Page settings
   * (`drawer=page-settings`) and the prompt-set chip opens the Prompts tab.
   * Omitted (previews): the chips are plain tags.
   */
  pageId?: string
  /** Shows a "Paused" chip first. */
  paused?: boolean
  /**
   * With `pageId`, the market picker ends with "+ New market…" (the
   * window-wide Add market drawer for this page); called with the new market.
   */
  onMarketAdded?: (marketId: string) => void
}): JSX.Element {
  const tags = pageDetailTags(page)
  // pageDetailTags order: markets, interval, samples, then the prompt set.
  const sections = ['markets', 'schedule', 'schedule'] as const
  const market =
    page.markets.length > 0 && pageId && onMarketAdded ? (
      <PickerSelect
        className="select"
        value={marketId}
        onChange={onMarketChange}
        options={page.markets.map((option) => ({ value: option.id, label: marketLabel(option) }))}
        createLabel="+ New market…"
        onCreate={() =>
          openDrawer(
            'add-market',
            { 'am.page': pageId },
            {
              onResult: (result) => {
                if (typeof result === 'string') onMarketAdded(result)
              }
            }
          )
        }
      />
    ) : page.markets.length > 0 ? (
      <select
        className="select"
        value={marketId}
        onChange={(event) => onMarketChange(event.target.value)}
      >
        {page.markets.map((option) => (
          <option key={option.id} value={option.id}>
            {marketLabel(option)}
          </option>
        ))}
      </select>
    ) : null

  return (
    <ScreenHeader
      page
      className="ui-head-page"
      nav={{
        // Back to the project home, named like it (the project), not like the sidebar item.
        back: back ?? { href: landingHash(), label: projectName },
        // A topic has no URL of its own.
        detail: page.href ? <UrlText url={page.href} label={page.displayUrl} /> : undefined,
        end: (
          <ul className="ui-head-chips" aria-label="Page settings">
            {paused ? (
              <li>
                {pageId ? (
                  <button
                    type="button"
                    className="ui-chip ui-chip-warn ui-chip-sm ui-chip-btn"
                    onClick={() => openDrawer('page-settings', { 'ps.section': 'status' })}
                  >
                    Paused
                  </button>
                ) : (
                  <Chip size="sm" tone="warn">
                    Paused
                  </Chip>
                )}
              </li>
            ) : null}
            {tags.map((tag, index) => {
              const section = sections[index]
              return (
                <li key={tag}>
                  {!pageId ? (
                    <Chip size="sm">{tag}</Chip>
                  ) : section === undefined ? (
                    <a
                      className="ui-chip ui-chip-sm ui-chip-btn"
                      href={pageHash(pageId, 'prompts')}
                    >
                      {tag}
                    </a>
                  ) : (
                    <button
                      type="button"
                      className="ui-chip ui-chip-sm ui-chip-btn"
                      aria-label={`${tag}: change in Page settings`}
                      onClick={() => openDrawer('page-settings', { 'ps.section': section })}
                    >
                      {tag}
                    </button>
                  )}
                </li>
              )
            })}
            {pageId ? (
              <li>
                <IconButton
                  icon="sliders"
                  size="sm"
                  label="Page settings"
                  title="Page settings"
                  onClick={() => openDrawer('page-settings')}
                />
              </li>
            ) : null}
          </ul>
        )
      }}
      title={page.title}
      // The filters stay in view; Export and Pin go under ⋯; Check now is the one green button.
      actions={
        <>
          {productField}
          {market ? (
            <HeaderField label="Market">{market}</HeaderField>
          ) : (
            <span className="ui-head-none">No market yet</span>
          )}
        </>
      }
      more={[
        ...(checkControl || checkPrimary
          ? []
          : [{ id: 'check', label: 'Check now', icon: 'refresh' as const, href: checkHref }]),
        { id: 'export', label: 'Export report', icon: 'download', href: exportHref },
        ...(pin
          ? [
              {
                id: 'pin',
                label: pin.pinned ? 'Unpin from sidebar' : 'Pin to sidebar',
                onSelect: pin.onToggle
              }
            ]
          : [])
      ]}
      primary={
        checkControl ??
        (checkPrimary ? { label: 'Check now', icon: 'refresh', href: checkHref } : undefined)
      }
    />
  )
}
