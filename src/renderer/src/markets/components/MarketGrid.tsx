import type { JSX, ReactNode } from 'react'
import type { Market, PageResults } from '@shared/domain'
import { LINK_COUNT_LABELS } from '@shared/report-copy'
import { askColumn } from '../../assistant/sparkle/askColumn'
import { DrillNumber, drillCount, type DrillRequest } from '../../drill'
import { countNoun } from '../../m3/model'
import { marketLabel } from '../../shell/model'
import { pageHash } from '../../shell/routes'
import { EmptyState, ListGrid, type ListColumn, type MenuItem } from '../../ui'
import { formatMoment } from '../../utils/dates'
import type { MarketResults } from '../types'
import { marketCitationsDrill, marketResultsDrill } from '../utils/drills'
import {
  deviceLabel,
  marketKindLabel,
  promptLanguageLabel,
  scoreChangeLabel,
  scoreTone
} from '../utils/model'
import { SearchesPopover } from './SearchesPopover'

/** What a market row can do from its `⋯` menu. */
export interface MarketRowActions {
  onCheck: (market: Market) => void
  /** Asks to remove the market (the screen confirms first). */
  onRemove: (market: Market) => void
  /** Makes it the page's default market (with Undo). */
  onMakeDefault?: (market: Market) => void
  /** Runs a per-market assist ("What's different", "Write local prompts"). */
  onAssist: (assistId: 'markets.whatsDifferent' | 'markets.localPrompts', market: Market) => void
}

function Count({ drill, what }: { drill: DrillRequest | null; what: string }): JSX.Element {
  if (!drill) return <>0</>
  return <DrillNumber drill={drill} label={`${drillCount(drill)} ${what}`} />
}

/** A checked market's results, or null while it has none. */
function checked(entry: MarketResults): PageResults | null {
  return entry.results?.run ? entry.results : null
}

function marketColumns(
  pageId: string,
  defaultMarketId: string | null,
  prompts: number,
  samples: number
): ListColumn<MarketResults>[] {
  const dash = (entry: MarketResults, cell: (results: PageResults) => ReactNode): ReactNode => {
    const results = checked(entry)
    return results ? cell(results) : <span className="faint">—</span>
  }
  return [
    {
      id: 'market',
      label: 'Market',
      width: 'fill',
      minWidth: 160,
      sort: (entry) => marketLabel(entry.market),
      render: ({ market }) => (
        <span className="mk-name">
          <a className="mk-head-link" href={pageHash(pageId, 'results', { marketId: market.id })}>
            {marketLabel(market)}
          </a>
          <span className="faint mk-kind">
            {[
              marketKindLabel(market, defaultMarketId),
              promptLanguageLabel(market),
              deviceLabel(market.device)
            ].join(' · ')}
          </span>
        </span>
      )
    },
    {
      id: 'score',
      label: 'Score',
      width: 140,
      sort: (entry) => checked(entry)?.run?.visibilityScore ?? null,
      render: (entry) => {
        const name = marketLabel(entry.market)
        if (entry.error) return <span className="faint">Could not load</span>
        const results = checked(entry)
        if (!results?.run) return <span className="faint">Not checked yet</span>
        return (
          <a
            className="mk-score-row mk-score-link"
            href={pageHash(pageId, 'results', { marketId: entry.market.id })}
          >
            <span className="mk-score num">
              <span className="sr-only">Visibility score </span>
              {results.run.visibilityScore ?? '—'}
            </span>
            <span className={scoreTone(results)}>{scoreChangeLabel(results)}</span>
            <span className="sr-only"> · open Results in {name}</span>
          </a>
        )
      }
    },
    {
      id: 'cited',
      label: 'Page cited',
      width: 92,
      numeric: true,
      sort: (entry) => checked(entry)?.run?.pageCited ?? null,
      render: (entry) =>
        dash(entry, (results) => {
          const name = marketLabel(entry.market)
          const cited = marketResultsDrill(pageId, entry.market, results, 'funnel:this_page')
          const aio = marketResultsDrill(pageId, entry.market, results, 'funnel:aio_shown')
          return (
            <span className="mk-count">
              <Count drill={cited} what={`questions with this page cited in ${name}`} /> of{' '}
              <Count drill={aio} what={`questions with an AI Overview in ${name}`} />
            </span>
          )
        })
    },
    {
      id: 'links',
      label: LINK_COUNT_LABELS.ownDomain,
      width: 104,
      numeric: true,
      sort: (entry) => {
        const run = checked(entry)?.run
        return run ? run.citationsThisPage + run.citationsOtherOwn : null
      },
      render: (entry) =>
        dash(entry, (results) => {
          const name = marketLabel(entry.market)
          const links = marketCitationsDrill(pageId, entry.market, results)
          return (
            <span className="mk-count">
              <DrillNumber
                drill={links}
                label={`${countNoun(links.items.length, 'citation', 'citations')} of your domain in ${name}`}
              />
            </span>
          )
        })
    },
    {
      id: 'aio',
      label: 'AI Overview shown',
      width: 112,
      numeric: true,
      sort: (entry) => checked(entry)?.run?.promptsWithAio ?? null,
      render: (entry) =>
        dash(entry, (results) => {
          const name = marketLabel(entry.market)
          const aio = marketResultsDrill(pageId, entry.market, results, 'funnel:aio_shown')
          const all = marketResultsDrill(pageId, entry.market, results, 'funnel:checked')
          return (
            <span className="mk-count">
              <Count drill={aio} what={`questions with an AI Overview in ${name}`} /> of{' '}
              <Count drill={all} what={`questions checked in ${name}`} />
            </span>
          )
        })
    },
    {
      id: 'searches',
      label: 'Searches per check',
      width: 96,
      numeric: true,
      render: ({ market }) => (
        <SearchesPopover prompts={prompts} samples={samples} marketName={marketLabel(market)} />
      )
    },
    {
      id: 'last',
      label: 'Last checked',
      width: 100,
      sort: (entry) => entry.results?.run?.finishedAt ?? null,
      render: ({ market, results }) => {
        const run = results?.run
        if (!run) return <span className="faint">Never</span>
        return (
          <a
            className="m3-link"
            href={pageHash(pageId, 'history', { marketId: market.id })}
            aria-label={`Last checked ${formatMoment(run.finishedAt)}: open History for ${marketLabel(market)}`}
          >
            {formatMoment(run.finishedAt)}
          </a>
        )
      }
    }
  ]
}

function rowMenu(
  entry: MarketResults,
  pageId: string,
  defaultMarketId: string | null,
  canRemove: boolean,
  busy: boolean,
  actions: MarketRowActions
): MenuItem[] {
  const { market } = entry
  const name = marketLabel(market)
  const items: MenuItem[] = [
    {
      id: 'check',
      label: `Check ${name}`,
      icon: 'refresh',
      disabled: busy,
      onSelect: () => actions.onCheck(market)
    },
    {
      id: 'results',
      label: 'Open Results',
      icon: 'arrow-right',
      onSelect: () => {
        window.location.hash = pageHash(pageId, 'results', { marketId: market.id })
      }
    }
  ]
  if (market.id !== defaultMarketId && actions.onMakeDefault) {
    const makeDefault = actions.onMakeDefault
    items.push({
      id: 'default',
      label: 'Make default market',
      icon: 'check',
      disabled: busy,
      onSelect: () => makeDefault(market)
    })
  }
  if (market.id !== defaultMarketId) {
    items.push(
      {
        id: 'different',
        label: `What's different in ${name}?`,
        icon: 'sparkle',
        tone: 'ai',
        onSelect: () => actions.onAssist('markets.whatsDifferent', market)
      },
      {
        id: 'local',
        label: 'Write local questions',
        icon: 'sparkle',
        tone: 'ai',
        onSelect: () => actions.onAssist('markets.localPrompts', market)
      }
    )
  }
  if (canRemove) {
    items.push({
      id: 'remove',
      label: `Remove ${name}`,
      icon: 'trash',
      tone: 'danger',
      disabled: busy,
      onSelect: () => actions.onRemove(market)
    })
  }
  return items
}

/**
 * FR-9.7 markets of this page as one list grid. Numbers come from each market's
 * `results:get`, like Results, and every count opens the drawer of exactly what
 * it counts in that market (NFR-14). Check, Results, the market assists and
 * Remove sit behind each row's `⋯`.
 */
export function MarketGrid({
  pageId,
  markets,
  defaultMarketId,
  prompts,
  samples,
  busy,
  ai,
  add,
  actions
}: {
  pageId: string
  markets: readonly MarketResults[]
  defaultMarketId: string | null
  prompts: number
  samples: number
  busy: boolean
  /** The section's one AI menu, in the toolbar after the search. */
  ai?: ReactNode
  /** The one add action, in the toolbar before the AI menu. */
  add?: ReactNode
  actions: MarketRowActions
}): JSX.Element {
  const canRemove = markets.length > 1
  return (
    <ListGrid
      urlKey="mkt"
      label="Markets"
      noun={['market', 'markets']}
      rows={markets}
      rowKey={(entry) => entry.market.id}
      rowLabel={(entry) => marketLabel(entry.market)}
      columns={[
        ...marketColumns(pageId, defaultMarketId, prompts, samples),
        askColumn<MarketResults>((entry) => ({
          kind: 'market',
          id: entry.market.id,
          label: marketLabel(entry.market),
          detail: entry.market.id === defaultMarketId ? 'Default market' : null
        }))
      ]}
      search={{ text: (entry) => marketLabel(entry.market), placeholder: 'Search markets' }}
      actions={add}
      ai={ai}
      rowMenu={(entry) => rowMenu(entry, pageId, defaultMarketId, canRemove, busy, actions)}
      empty={
        <EmptyState
          title="No markets yet"
          body="Add the countries and languages your buyers search in."
          action={add}
        />
      }
    />
  )
}
