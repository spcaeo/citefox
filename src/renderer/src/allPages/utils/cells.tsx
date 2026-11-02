import type { JSX, ReactNode } from 'react'
import type { GridMembership, Market } from '@shared/domain'
import type { AllPageRow } from '@shared/ipc'
import { NO_VALUE } from '../../grid'
import { Chip, UrlText, type ChipTone } from '../../ui'
import { pageHash, structureHash } from '../../shell/routes'
import { pageHref, setupHref } from './links'
import { marketLabel } from '../../shell/model'
import { rowName, statusText } from './text'
import { pathOf } from './format'
import { pageDrillId, type PageDrillKind } from './drills'

const STATUS_TONE: Record<AllPageRow['status'], ChipTone> = {
  tracked: 'ok',
  setting_up: 'warn',
  paused: 'neutral',
  not_tracked: 'neutral',
  removed: 'bad'
}

/**
 * The status chip. "Setting up" links to the step the page is on. Track for a
 * found page lives in the row's ⋯ menu and in the bulk bar (v2 list grid).
 */
export function StatusPill({ row }: { row: AllPageRow }): JSX.Element {
  const pill = (
    <Chip tone={STATUS_TONE[row.status]} size="sm" dot={row.status !== 'not_tracked'}>
      {statusText(row)}
    </Chip>
  )
  if (row.status === 'setting_up') {
    return (
      <a
        className="ap-pill-link"
        href={setupHref(row)}
        aria-label={`${statusText(row)}: finish setting up ${rowName(row)}`}
      >
        {pill}
      </a>
    )
  }
  return pill
}

export function ScoreCell({ score }: { score: number | null }): JSX.Element {
  if (score === null) return <span className="faint">{NO_VALUE}</span>
  return (
    <span className="ap-score">
      <span className="mono">{score}</span>
      <span className="ap-bar" aria-hidden="true">
        <span style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
      </span>
    </span>
  )
}

/** Each market chip opens the page's Results in that market. */
export function MarketChips({
  row,
  markets
}: {
  row: AllPageRow
  markets: ReadonlyMap<string, Market>
}): JSX.Element {
  if (row.marketIds.length === 0) return <span className="faint">No markets yet</span>
  const linked = row.status === 'tracked' || row.status === 'paused'
  return (
    <span className="ap-chips">
      {row.marketIds.map((id) => {
        const market = markets.get(id)
        const full = market ? marketLabel(market) : id
        const short = market ? full.replace(/ · [A-Z]{2}$/, '') : id
        return linked ? (
          <a
            key={id}
            className="ap-chip ap-chip-link"
            href={pageHash(row.id, 'results', { marketId: id })}
            aria-label={`${rowName(row)} results in ${full}`}
            title={full}
          >
            {short}
          </a>
        ) : (
          <span key={id} className="ap-chip" title={full}>
            {short}
          </span>
        )
      })}
    </span>
  )
}

/** Cluster or Group memberships, each linking to it in Site structure. */
export function MembershipLinks({
  items,
  kind
}: {
  items: readonly GridMembership[] | null
  kind: 'cluster' | 'group'
}): JSX.Element {
  if (!items || items.length === 0) return <span className="faint">{NO_VALUE}</span>
  return (
    <span className="ap-members">
      {items.map((item, index) => (
        <span key={item.id}>
          {index > 0 ? ', ' : null}
          <a
            className="dg-link"
            href={structureHash(item.id)}
            aria-label={`${kind === 'cluster' ? 'Cluster' : 'Group'} ${item.name} in Site structure`}
          >
            {item.name}
          </a>
        </span>
      ))}
    </span>
  )
}

export function PageCell({ row }: { row: AllPageRow }): JSX.Element {
  const target = pageHref(row)
  const name = rowName(row)
  return (
    <span className="ap-page">
      {target === null ? (
        <span className="page-title">{name}</span>
      ) : target.external ? (
        <a className="page-title" href={target.href} target="_blank" rel="noopener noreferrer">
          {name}
          <span className="sr-only"> (not tracked, opens in your browser)</span>
        </a>
      ) : (
        <a className="page-title" href={target.href}>
          {name}
        </a>
      )}
      <UrlText url={row.url} label={pathOf(row.url)} cut="end" />
    </span>
  )
}

/**
 * A number in a page row that opens the drawer of what it counts. The figure
 * is the count itself (`data-nfr-figure`); `rest` follows it, such as " of 8".
 */
export function PageNumber({
  row,
  kind,
  figure,
  rest,
  label,
  onOpen
}: {
  row: AllPageRow
  kind: PageDrillKind
  figure: number
  rest?: ReactNode
  label: string
  onOpen: (kind: PageDrillKind, row: AllPageRow) => void
}): JSX.Element {
  const id = pageDrillId(kind, row.id)
  return (
    <button
      type="button"
      className="dg-drill mono"
      aria-label={label}
      data-nfr-drill={id}
      onClick={() => onOpen(kind, row)}
    >
      <span data-nfr-figure={id}>{figure}</span>
      {rest}
    </button>
  )
}

/** The score as a button that opens the scored prompts of the check behind it. */
export function ScoreButton({
  row,
  onOpen
}: {
  row: AllPageRow
  onOpen: (kind: PageDrillKind, row: AllPageRow) => void
}): JSX.Element {
  if (row.score === null || !row.runId) return <ScoreCell score={row.score} />
  return (
    <button
      type="button"
      className="dg-drill ap-score-btn"
      aria-label={`Score ${row.score} for ${rowName(row)}: show the scored questions`}
      onClick={() => onOpen('score', row)}
    >
      <ScoreCell score={row.score} />
    </button>
  )
}
