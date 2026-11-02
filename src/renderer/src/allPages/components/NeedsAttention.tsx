import { useMemo, type JSX, type ReactNode } from 'react'
import type { Market } from '@shared/domain'
import type { CitationReview, UntrackedCitation, WrongPageCase } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { DrillButton, DrillFigure, DrillLink, DrillNumber, openTarget } from '../../drill'
import { marketLabel } from '../../shell/model'
import { pageHash } from '../../shell/routes'
import { SiteIcon } from '../../siteIcon/SiteIcon'
import {
  EmptyState,
  IconButton,
  ListGrid,
  SectionHead,
  UrlText,
  type ListColumn,
  type ListGroup,
  type MenuItem
} from '../../ui'
import { useAttentionActions, type AttentionActions } from '../hooks/useAttentionActions'
import type { AllPagesSource } from '../source'
import { untrackedDrill, wrongPageDrill } from '../utils/drills'
import { pathOf } from '../utils/format'
import { noiseLabel } from '../utils/noise'

/** Left out first, in order, when the list is narrower than its row (the page link opens the rest). */
const NARROW_DROPS: readonly string[] = ['market', 'prompt', 'status']

/** One row: a "Wrong page cited" case, or an own page cited but not tracked. */
export type AttentionRow =
  | { kind: 'wrong'; key: string; item: WrongPageCase }
  | { kind: 'untracked'; key: string; item: UntrackedCitation }

export type AttentionKind = AttentionRow['kind']

const KIND_LABELS: Readonly<Record<AttentionKind, string>> = {
  wrong: 'Wrong page cited',
  untracked: 'Cited but not tracked'
}

/** A group with more rows than this starts collapsed, so the Pages grid stays in view. */
const COLLAPSE_OVER = 5
/**
 * Rows per page before "Show all" for one kind. Grouped, every line is listed
 * (paging counts the rows of a collapsed group, which would push the second
 * group off the first page) and the body stops growing at about ten rows.
 */
const PAGE_SIZE = 10
const GROUPED_BODY = 10 * 44

/**
 * FR-20.4 and FR-20.5 as one list grid: tracked pages where AI Overviews cite
 * another own page instead ("Wrong page cited": Point it here, Merge), and own
 * pages they cite that are not tracked (Track, Ignore). Every action lives in
 * the row's ⋯ menu and keeps its Undo there. With both kinds the rows group by
 * kind; a long group starts collapsed. `kinds` with one kind shows that list
 * alone (the Citations screen).
 */
export function NeedsAttention({
  source,
  projectId,
  domain,
  review,
  markets,
  onChanged,
  kinds = ['wrong', 'untracked'],
  title = 'Needs attention',
  onCollapse
}: {
  source: AllPagesSource
  projectId: string
  domain: string
  review: CitationReview
  markets: ReadonlyMap<string, Market>
  onChanged: () => void
  kinds?: readonly AttentionKind[]
  title?: string
  /** Folds the list back into its one-line summary (All pages over a long grid). */
  onCollapse?: () => void
}): JSX.Element {
  const actions = useAttentionActions(source, projectId, onChanged)
  const rows = useMemo<AttentionRow[]>(
    () => [
      ...(kinds.includes('wrong')
        ? review.wrongPage.map((item) => ({
            kind: 'wrong' as const,
            key: `wrong:${item.id}`,
            item
          }))
        : []),
      ...(kinds.includes('untracked')
        ? review.untracked.map((item) => ({
            kind: 'untracked' as const,
            key: `untracked:${item.normalizedUrl}`,
            item
          }))
        : [])
    ],
    [review, kinds]
  )
  const wrongDrill = useMemo(
    () => wrongPageDrill(review.wrongPage, markets, domain),
    [review.wrongPage, markets, domain]
  )
  const grouped = kinds.length > 1
  const open = rows.filter((row) => row.kind !== 'untracked' || !actions.isIgnored(row.item))
  const wrongMeta = (
    <>
      <DrillNumber
        drill={wrongDrill}
        className="dg-drill"
        label={`${review.wrongPage.length} ${review.wrongPage.length === 1 ? 'case' : 'cases'}: show every wrong-page case`}
        suffix={review.wrongPage.length === 1 ? ' case' : ' cases'}
      />{' '}
      on {pluralize(review.wrongPagePages, 'tracked page')}, latest checks, all markets
    </>
  )
  const untrackedMeta = `On ${domain}, cited for your tracked pages’ questions. Track them to see their own scores.`
  const group: ListGroup<AttentionRow> | undefined = grouped
    ? {
        key: (row) => ({ key: row.kind, label: KIND_LABELS[row.kind] }),
        order: ['wrong', 'untracked'],
        meta: (_rows, key) => (key === 'wrong' ? wrongMeta : untrackedMeta),
        collapsed: (['wrong', 'untracked'] as const).filter(
          (kind) => rows.filter((row) => row.kind === kind).length > COLLAPSE_OVER
        )
      }
    : undefined
  const only = kinds[0] ?? 'wrong'
  // Grouped, each group header carries its own line: no description over them.
  const description: ReactNode = grouped ? null : only === 'wrong' ? wrongMeta : untrackedMeta

  return (
    <div className="ap-section ap-attention">
      <SectionHead
        title={title}
        count={open.length}
        description={description}
        actions={
          onCollapse ? (
            <IconButton
              icon="chevron-up"
              size="sm"
              label="Show less"
              data-tip="Show less"
              aria-expanded
              onClick={onCollapse}
            />
          ) : undefined
        }
      />
      <ListGrid<AttentionRow>
        label={title}
        noun={['item', 'items']}
        rows={rows}
        rowKey={(row) => row.key}
        rowLabel={rowLabel(markets)}
        narrowDrops={NARROW_DROPS}
        columns={columns(actions, markets, domain)}
        {...(group ? { group } : {})}
        rowMenu={(row) => rowMenu(row, actions)}
        pageSize={grouped ? 'all' : PAGE_SIZE}
        {...(grouped ? { maxBodyHeight: GROUPED_BODY } : {})}
        summary={() => summaryLine(rows, actions)}
        empty={
          <EmptyState
            icon="check"
            title="Nothing to review"
            body="No AI Overview cites a different page of yours, or a page you do not track."
          />
        }
      />
      <p className="sr-only" aria-live="polite">
        {actions.announcement}
      </p>
    </div>
  )
}

function rowLabel(markets: ReadonlyMap<string, Market>): (row: AttentionRow) => string {
  return (row) => {
    if (row.kind === 'untracked') return pathOf(row.item.url)
    const market = markets.get(row.item.marketId)
    return `${row.item.pageLabel}: “${row.item.promptLabel}”${market ? ` in ${marketLabel(market)}` : ''}`
  }
}

function summaryLine(rows: readonly AttentionRow[], actions: AttentionActions): string {
  const wrong = rows.filter((row) => row.kind === 'wrong').length
  const untracked = rows.filter((row) => row.kind === 'untracked')
  const ignored = untracked.filter((row) => row.kind === 'untracked' && actions.isIgnored(row.item))
  const parts: string[] = []
  if (wrong > 0) parts.push(pluralize(wrong, 'wrong-page case'))
  if (untracked.length > 0) parts.push(pluralize(untracked.length, 'page') + ' not tracked')
  if (ignored.length > 0) parts.push(`${ignored.length.toLocaleString('en-US')} ignored`)
  return parts.join(' · ')
}

function columns(
  actions: AttentionActions,
  markets: ReadonlyMap<string, Market>,
  domain: string
): ListColumn<AttentionRow>[] {
  return [
    {
      id: 'page',
      label: 'Page',
      width: 'fill',
      minWidth: 200,
      sort: (row) => (row.kind === 'wrong' ? row.item.pageLabel : pathOf(row.item.url)),
      render: (row) =>
        row.kind === 'wrong' ? (
          <a className="ap-att-title" href={pageHash(row.item.pageId)}>
            {row.item.pageLabel}
          </a>
        ) : (
          <UrlText
            url={row.item.url}
            label={pathOf(row.item.url)}
            className={actions.isIgnored(row.item) ? 'ap-att-off' : undefined}
          />
        )
    },
    {
      id: 'cited',
      label: 'Google cites',
      width: 220,
      render: (row) =>
        row.kind === 'wrong' ? (
          <CitedLink item={row.item} />
        ) : (
          <CitedCount item={row.item} markets={markets} domain={domain} />
        )
    },
    {
      id: 'prompt',
      label: 'Question',
      width: 200,
      render: (row) =>
        row.kind === 'wrong' ? <PromptLink item={row.item} markets={markets} /> : ''
    },
    {
      id: 'market',
      label: 'Market',
      width: 104,
      render: (row) => {
        if (row.kind === 'untracked') return <span className="faint">All markets</span>
        const market = markets.get(row.item.marketId)
        if (!market) return ''
        return (
          <a
            className="dg-link ap-att-clip"
            href={pageHash(row.item.pageId, 'results', {
              marketId: row.item.marketId,
              runId: row.item.runId
            })}
            aria-label={`${row.item.pageLabel} results in ${marketLabel(market)}`}
          >
            {marketLabel(market)}
          </a>
        )
      }
    },
    {
      id: 'status',
      label: 'Status',
      width: 180,
      render: (row) => <StatusText row={row} actions={actions} />
    }
  ]
}

function StatusText({
  row,
  actions
}: {
  row: AttentionRow
  actions: AttentionActions
}): JSX.Element | null {
  if (row.kind === 'wrong') {
    const state = actions.wrongDone(row.item)
    if (state) return <span className="ap-att-status">{state.message}</span>
    if (!row.item.citedPageReady) {
      return <span className="ap-att-status faint">Cited page needs its own questions</span>
    }
    return null
  }
  const state = actions.untrackedDone(row.item)
  if (state) return <span className="ap-att-status">{state.message}</span>
  if (actions.isIgnored(row.item)) return <span className="ap-att-status faint">Ignored</span>
  if (row.item.noise)
    return <span className="ap-att-status ap-noise">{noiseLabel(row.item.noise)}</span>
  return null
}

function rowMenu(row: AttentionRow, actions: AttentionActions): MenuItem[] {
  const busy = actions.isBusy(row.kind === 'wrong' ? row.item.id : row.item.normalizedUrl)
  const items: MenuItem[] = []
  if (row.kind === 'wrong') {
    const { item } = row
    const state = actions.wrongDone(item)
    if (state && state.kind !== 'blocked') {
      items.push({
        id: 'undo',
        label: 'Undo',
        icon: 'refresh',
        disabled: busy,
        onSelect: () => actions.undoWrong(item)
      })
    } else if (!state) {
      items.push(
        {
          id: 'point',
          label: 'Point it here',
          icon: 'arrow-right',
          disabled: busy || item.citedPageId === null,
          ...(item.citedPageReady ? {} : { hint: 'Set up first' }),
          onSelect: () => actions.pointHere(item)
        },
        {
          id: 'merge',
          label: 'Merge',
          icon: 'merge',
          disabled: busy,
          onSelect: () => actions.merge(item)
        }
      )
    }
    items.push({
      id: 'open',
      label: 'Open page',
      icon: 'eye',
      groupStart: items.length > 0,
      onSelect: () => openTarget({ kind: 'page', pageId: item.pageId })
    })
    return items
  }
  const { item } = row
  const state = actions.untrackedDone(item)
  if (state?.kind === 'tracked') {
    items.push({
      id: 'undo',
      label: 'Undo',
      icon: 'refresh',
      disabled: busy,
      onSelect: () => actions.undoTrack(item)
    })
  } else if (!state && actions.isIgnored(item)) {
    items.push({
      id: 'unignore',
      label: 'Undo ignore',
      icon: 'refresh',
      disabled: busy,
      onSelect: () => actions.ignore(item, false)
    })
  } else if (!state) {
    items.push(
      {
        id: 'track',
        label: 'Track',
        icon: 'plus',
        disabled: busy,
        onSelect: () => actions.track(item)
      },
      {
        id: 'ignore',
        label: 'Ignore',
        icon: 'x',
        disabled: busy,
        onSelect: () => actions.ignore(item, true)
      }
    )
  }
  items.push({
    id: 'open',
    label: 'Open in your browser',
    icon: 'external',
    groupStart: items.length > 0,
    onSelect: () => openTarget({ kind: 'url', url: item.url })
  })
  return items
}

/** The prompt that cites the other page: Prompt detail in that market and check. */
function PromptLink({
  item,
  markets
}: {
  item: WrongPageCase
  markets: ReadonlyMap<string, Market>
}): JSX.Element {
  const market = markets.get(item.marketId)
  return (
    <span className="ap-att-clip">
      <DrillLink
        className="dg-link"
        target={{
          kind: 'prompt',
          pageId: item.pageId,
          promptId: item.promptId,
          marketId: item.marketId,
          runId: item.runId
        }}
        label={`Open question “${item.promptLabel}”${market ? ` in ${marketLabel(market)}` : ''}`}
      >
        “{item.promptLabel}”
      </DrillLink>
      {item.position !== null ? (
        <span className="faint"> · position {Math.round(item.position)}</span>
      ) : null}
    </span>
  )
}

/** How often an untracked own page is cited: opens those citations. */
function CitedCount({
  item,
  markets,
  domain
}: {
  item: UntrackedCitation
  markets: ReadonlyMap<string, Market>
  domain: string
}): JSX.Element {
  const drill = untrackedDrill(item, markets, domain)
  return (
    <DrillButton
      drill={drill}
      className="dg-drill"
      label={`Cited ${item.citations} ${item.citations === 1 ? 'time' : 'times'} for ${item.citedFor} tracked ${item.citedFor === 1 ? 'page' : 'pages'}: show the questions`}
    >
      <DrillFigure drill={drill} className="num" />
      &nbsp;{item.citations === 1 ? 'time' : 'times'} for {item.citedFor} tracked{' '}
      {item.citedFor === 1 ? 'page' : 'pages'}
    </DrillButton>
  )
}

/**
 * The page Google cites instead: its results when it is a set-up project page,
 * otherwise the URL with copy and open.
 */
function CitedLink({ item }: { item: WrongPageCase }): JSX.Element {
  const path = pathOf(item.citedUrl)
  if (item.citedPageId !== null && item.citedPageReady) {
    return (
      <a
        className="mono dg-link ap-att-clip"
        href={pageHash(item.citedPageId)}
        aria-label={`Open ${path}`}
      >
        <SiteIcon domain={item.citedUrl} spaced />
        {path}
      </a>
    )
  }
  return <UrlText url={item.citedUrl} label={path} />
}
