import type { JSX } from 'react'
import { fixKindLabel, type FixKind } from '@shared/domain'
import { changeStatusLabel, type ChangeStatus } from '@shared/fix-loop'
import type { ChangeRow } from '@shared/ipc'
import { sponsorOf } from '@shared/sponsors'
import { pathOf } from '../fixes/model'
import { lostHash } from '../fixes/views'
import { SponsorLink } from '../sponsors'
import { Chip, UrlText, type ChipTone } from '../ui'
import { formatWhen } from '../utils/dates'
import {
  daysLabel,
  INDEX_LABELS,
  indexBucket,
  indexTitle,
  pageDateLine,
  pageName,
  type IndexBucket
} from './model'
import './changes.css'

/** Cells shared by the ledger, the next round and the backlink list. */

const STATUS_TONE: Record<ChangeStatus, ChipTone> = {
  cited: 'ok',
  not_cited: 'warn',
  too_new: 'info',
  lost: 'bad'
}

const KIND_TONE: Record<FixKind, ChipTone> = {
  new_page: 'info',
  rewrite: 'neutral',
  fix: 'neutral'
}

const INDEX_TONE: Record<IndexBucket, ChipTone> = {
  indexed: 'ok',
  not_indexed: 'bad',
  not_checked: 'neutral'
}

/**
 * The page's name over its path (copy and open on the path). With `withKind`, the
 * change's kind chip follows the name (the ledger has no Kind column of its own).
 */
export function PageCell({
  row,
  site,
  withKind = false
}: {
  row: ChangeRow
  site: string
  withKind?: boolean
}): JSX.Element {
  const path = pathOf(row.url)
  const kind = withKind ? <KindChip kind={row.kind} /> : null
  if (!row.title) {
    if (!kind) return <UrlText url={row.url} label={path} site={site} />
    return (
      <span className="chg-page-line">
        <UrlText url={row.url} label={path} site={site} />
        {kind}
      </span>
    )
  }
  return (
    <span className="chg-two">
      <span className="chg-page-line">
        <span className="chg-two-main chg-two-title" title={pageName(row)}>
          {pageName(row)}
        </span>
        {kind}
      </span>
      <span className="chg-two-sub">
        <UrlText url={row.url} label={path} site={site} />
      </span>
    </span>
  )
}

export function KindChip({ kind }: { kind: FixKind }): JSX.Element {
  return (
    <Chip size="sm" tone={KIND_TONE[kind]}>
      {fixKindLabel(kind)}
    </Chip>
  )
}

/** The status chip. Lost ground links to what happened. */
export function StatusChip({ row }: { row: ChangeRow }): JSX.Element {
  const chip = (
    <Chip size="sm" tone={STATUS_TONE[row.status]}>
      {changeStatusLabel(row.status)}
    </Chip>
  )
  if (row.status !== 'lost') return chip
  return (
    <a
      className="chg-chip-link"
      href={lostHash(row.pageId)}
      aria-label={`Lost ground: see what happened to ${pathOf(row.url)}`}
    >
      {chip}
    </a>
  )
}

/** The go-live date and days live, with the date the page states about itself under it. */
export function LiveSinceCell({ row }: { row: ChangeRow }): JSX.Element {
  const line = pageDateLine(row)
  return (
    <span className="chg-two">
      <span className="chg-two-main num">
        {formatWhen(row.liveSince, { year: false })} · {daysLabel(row.daysLive)}
      </span>
      {line ? <span className="chg-two-sub">{line}</span> : null}
    </span>
  )
}

/** Indexed, Not indexed or Not checked; its title says when or why. */
export function IndexPill({ row }: { row: ChangeRow }): JSX.Element {
  const bucket = indexBucket(row)
  return (
    <span className="chg-index" title={indexTitle(row)}>
      <Chip size="sm" tone={INDEX_TONE[bucket]} dot>
        {INDEX_LABELS[bucket]}
      </Chip>
    </span>
  )
}

/** The silver sponsor's link beside a page Google has not indexed. Opens in the browser. */
export function SendToGoogle({ path }: { path: string }): JSX.Element {
  const sponsor = sponsorOf('silver')
  return (
    <SponsorLink
      sponsor={sponsor}
      className="chg-sponsor"
      aria-label={`Send ${path} to Google with ${sponsor.name} (opens in your browser)`}
    >
      Send to Google with {sponsor.name}
    </SponsorLink>
  )
}

/** The index pill, and the sponsor link when Google has not indexed the page. */
export function IndexCell({ row }: { row: ChangeRow }): JSX.Element {
  if (indexBucket(row) !== 'not_indexed') return <IndexPill row={row} />
  return (
    <span className="chg-two">
      <span className="chg-two-main">
        <IndexPill row={row} />
      </span>
      <span className="chg-two-sub">
        <SendToGoogle path={pathOf(row.url)} />
      </span>
    </span>
  )
}
