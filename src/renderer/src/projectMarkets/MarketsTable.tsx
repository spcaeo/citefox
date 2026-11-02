import { useCallback, useEffect, useState, type JSX } from 'react'
import type { Market } from '@shared/domain'
import type { ProjectMarketsView } from '@shared/ipc'
import { errorText } from '../components/errorText'
import { openDrawer } from '../shell/drawers'
import { marketLabel } from '../shell/model'
import { navigateHash, pagesHash } from '../shell/routes'
import {
  Button,
  Chip,
  Confirm,
  EmptyState,
  ListGrid,
  showUndo,
  type ListColumn,
  type MenuItem
} from '../ui'
import { countText, pagesIn, pagesText } from './model'
import type { ProjectMarketsSource } from './source'
import '../pageSettings/page-settings.css'

type Pending = { kind: 'default'; market: Market } | { kind: 'remove'; market: Market } | null

function label(market: Market): string {
  return `${marketLabel(market)}${market.device === 'mobile' ? ' · Mobile' : ''}`
}

/**
 * Project settings › Markets as a table (deep audit setup S5.2): each market
 * with the pages and topics checked in it and its searches per check; Make
 * default, Remove (Undo puts every page's link back with its baseline) and
 * "+ Add market" (the window-wide `add-market` drawer).
 */
export function MarketsTable({
  source,
  projectId,
  onChanged
}: {
  source: ProjectMarketsSource
  projectId: string
  /** The project's default market changed: reload the settings view. */
  onChanged: () => void
}): JSX.Element {
  const [view, setView] = useState<ProjectMarketsView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending>(null)
  const [alsoPages, setAlsoPages] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    void Promise.resolve()
      .then(() => source['projectSettings:markets']({ projectId }))
      .then(
        (next) => {
          setView(next)
          setError(null)
        },
        (cause: unknown) => setError(errorText(cause, 'Could not load the markets.'))
      )
  }, [source, projectId])

  useEffect(load, [load])

  async function makeDefault(market: Market, pages: boolean): Promise<void> {
    setBusy(true)
    try {
      const result = await source['projectSettings:setDefaultMarket']({
        projectId,
        marketId: market.id,
        pages: pages ? 'tracking' : 'none'
      })
      setView(result.view)
      setPending(null)
      onChanged()
      const previous = result.previousDefaultMarketId
      showUndo({
        message: `${label(market)} is the default market now.`,
        effect:
          result.changedPages.length > 0
            ? `Also the default on ${countText(result.changedPages.length, 'page', 'pages')}.`
            : 'New pages start in it.',
        ...(previous
          ? {
              undo: async () => {
                for (const page of result.changedPages) {
                  if (page.previousMarketId === null) continue
                  await source['pages:update']({
                    projectId,
                    pageId: page.pageId,
                    defaultMarketId: page.previousMarketId
                  })
                }
                const back = await source['projectSettings:setDefaultMarket']({
                  projectId,
                  marketId: previous,
                  pages: 'none'
                })
                setView(back.view)
                onChanged()
              }
            }
          : {})
      })
    } catch (cause) {
      setPending(null)
      setError(errorText(cause, 'Could not change the default market.'))
    } finally {
      setBusy(false)
    }
  }

  async function remove(market: Market): Promise<void> {
    setBusy(true)
    try {
      const result = await source['projectSettings:removeMarket']({
        projectId,
        marketId: market.id
      })
      setView(result.view)
      setPending(null)
      showUndo({
        message: `Removed ${label(market)} from ${countText(result.removed.length, 'page', 'pages')}.`,
        effect:
          result.skipped.length > 0
            ? `${countText(result.skipped.length, 'page keeps', 'pages keep')} it: it is their only market.`
            : 'Its history stays.',
        undo: async () => {
          const back = await source['projectSettings:restoreMarket']({
            projectId,
            marketId: market.id,
            links: result.removed
          })
          setView(back)
        }
      })
    } catch (cause) {
      setPending(null)
      setError(errorText(cause, 'Could not remove the market.'))
    } finally {
      setBusy(false)
    }
  }

  const addButton = (
    <Button
      size="sm"
      variant="secondary"
      icon="plus"
      onClick={() => openDrawer('add-market', {}, { onResult: load })}
    >
      Add market
    </Button>
  )

  if (view === null) {
    return error ? (
      <div role="alert">
        <EmptyState
          icon="warning"
          title="Could not load the markets"
          body={error}
          action={
            <Button size="sm" onClick={load}>
              Try again
            </Button>
          }
        />
      </div>
    ) : (
      <p className="hint" role="status">
        Loading markets…
      </p>
    )
  }

  const columns: ListColumn<Market>[] = [
    {
      id: 'market',
      label: 'Market',
      width: 'fill',
      minWidth: 200,
      sort: (market) => label(market),
      render: (market) => (
        <span className="pmk-name">
          {label(market)}
          {market.id === view.defaultMarketId ? (
            <Chip size="sm" tone="info">
              Default
            </Chip>
          ) : null}
        </span>
      )
    },
    {
      id: 'pages',
      label: 'Pages and topics',
      width: 160,
      numeric: true,
      sort: (market) => pagesIn(view, market.id).length,
      render: (market) => {
        const pages = pagesIn(view, market.id)
        return pages.length === 0 ? (
          <span className="faint">None</span>
        ) : (
          <a
            href={pagesHash({ market: market.id })}
            aria-label={`${label(market)}: ${pages.length.toLocaleString('en-US')} · show the pages in this market in All pages`}
          >
            {pages.length.toLocaleString('en-US')}
          </a>
        )
      }
    },
    {
      id: 'searches',
      label: 'Searches per check',
      width: 170,
      numeric: true,
      sort: (market) =>
        pagesIn(view, market.id).reduce((sum, page) => sum + page.questions * page.samples, 0),
      render: (market) => {
        const min = pagesIn(view, market.id).reduce(
          (sum, page) => sum + page.questions * page.samples,
          0
        )
        return min === 0
          ? '—'
          : `${min.toLocaleString('en-US')}–${(min * 2).toLocaleString('en-US')}`
      }
    }
  ]

  const rowMenu = (market: Market): MenuItem[] => {
    const isDefault = market.id === view.defaultMarketId
    return [
      {
        id: 'pages',
        label: 'Show its pages',
        icon: 'external',
        onSelect: () => navigateHash(pagesHash({ market: market.id }))
      },
      {
        id: 'default',
        label: isDefault ? 'Default market' : 'Make default…',
        icon: 'check',
        disabled: isDefault,
        groupStart: true,
        onSelect: () => {
          setAlsoPages(true)
          setPending({ kind: 'default', market })
        }
      },
      {
        id: 'remove',
        label: isDefault ? 'Remove (make another default first)' : 'Remove…',
        icon: 'trash',
        tone: 'danger',
        disabled: isDefault,
        groupStart: true,
        onSelect: () => setPending({ kind: 'remove', market })
      }
    ]
  }

  const pendingPages = pending ? pagesIn(view, pending.market.id) : []
  const onlyMarket = pendingPages.filter((page) => page.marketIds.length === 1)

  return (
    <div className="pmk" data-testid="project-markets">
      {error ? (
        <p className="pset-error" role="alert">
          {error}
        </p>
      ) : null}
      <ListGrid
        label="Project markets"
        noun={['market', 'markets']}
        rows={view.markets}
        rowKey={(market) => market.id}
        rowLabel={label}
        columns={columns}
        rowMenu={rowMenu}
        actions={addButton}
        pageSize="all"
        virtualize={false}
        footer="paged"
        empty={
          <EmptyState
            icon="inbox"
            title="No markets yet"
            body="Add the countries and languages your buyers search in."
            action={addButton}
          />
        }
      />
      {pending?.kind === 'default' ? (
        <Confirm
          title={`Make ${label(pending.market)} the default?`}
          tone="default"
          confirmLabel="Make default"
          busy={busy}
          body={
            <>
              <p>New pages start in this market.</p>
              {pendingPages.length > 0 ? (
                <label className="pmk-also">
                  <input
                    type="checkbox"
                    checked={alsoPages}
                    onChange={(event) => setAlsoPages(event.target.checked)}
                  />{' '}
                  Also make it the default market on the {pagesText(pendingPages)} checked in it
                </label>
              ) : null}
            </>
          }
          onConfirm={() => void makeDefault(pending.market, alsoPages && pendingPages.length > 0)}
          onCancel={() => setPending(null)}
          testId="pmk-confirm-default"
        />
      ) : null}
      {pending?.kind === 'remove' ? (
        <Confirm
          title={`Remove ${label(pending.market)}?`}
          confirmLabel="Remove market"
          busy={busy}
          body={
            <>
              <p>
                {pagesText(pendingPages.filter((page) => page.marketIds.length > 1))} stop checking
                in this market. Its history stays.
              </p>
              {onlyMarket.length > 0 ? (
                <p>
                  {pagesText(onlyMarket)} {onlyMarket.length === 1 ? 'keeps' : 'keep'} it: it is
                  their only market.
                </p>
              ) : null}
            </>
          }
          onConfirm={() => void remove(pending.market)}
          onCancel={() => setPending(null)}
          testId="pmk-confirm-remove"
        />
      ) : null}
    </div>
  )
}
